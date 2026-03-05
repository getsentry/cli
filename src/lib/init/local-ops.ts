/**
 * Local Operations Dispatcher
 *
 * Handles filesystem and shell operations requested by the remote workflow.
 * All operations are sandboxed to the workflow's cwd directory.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isCancel, select } from "@clack/prompts";
import {
  createProject,
  listOrganizations,
  tryGetPrimaryDsn,
} from "../api-client.js";
import { resolveOrg } from "../resolve-target.js";
import { resolveOrCreateTeam } from "../resolve-team.js";
import { buildProjectUrl } from "../sentry-urls.js";
import { slugify } from "../utils.js";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_FILE_BYTES,
  MAX_OUTPUT_BYTES,
} from "./constants.js";
import type {
  ApplyPatchsetPayload,
  CreateSentryProjectPayload,
  DirEntry,
  FileExistsBatchPayload,
  ListDirPayload,
  LocalOpPayload,
  LocalOpResult,
  ReadFilesPayload,
  RunCommandsPayload,
  WizardOptions,
} from "./types.js";

/**
 * Shell metacharacters that enable chaining, piping, substitution, or redirection.
 * All legitimate install commands are simple single commands that don't need these.
 *
 * Ordering matters for error-message accuracy (not correctness): multi-character
 * operators like `&&` and `||` are checked before their single-character prefixes
 * (`&`, `|`) so the reported label describes the actual construct the user wrote.
 */
const SHELL_METACHARACTER_PATTERNS: Array<{ pattern: string; label: string }> =
  [
    { pattern: ";", label: "command chaining (;)" },
    // Check multi-char operators before single `|` / `&` so labels are accurate
    { pattern: "&&", label: "command chaining (&&)" },
    { pattern: "||", label: "command chaining (||)" },
    { pattern: "|", label: "piping (|)" },
    { pattern: "`", label: "command substitution (`)" },
    { pattern: "$(", label: "command substitution ($()" },
    { pattern: "(", label: "subshell/grouping (()" },
    { pattern: ")", label: "subshell/grouping ())" },
    { pattern: "$", label: "variable/command expansion ($)" },
    { pattern: "'", label: "single quote (')" },
    { pattern: '"', label: 'double quote (")' },
    { pattern: "\\", label: "backslash escape (\\)" },
    { pattern: "\n", label: "newline" },
    { pattern: "\r", label: "carriage return" },
    { pattern: ">", label: "redirection (>)" },
    { pattern: "<", label: "redirection (<)" },
    { pattern: "&", label: "background execution (&)" },
    // Glob and brace expansion — brace expansion is the real risk
    // (e.g. `npm install {evil,@sentry/node}`)
    { pattern: "{", label: "brace expansion ({)" },
    { pattern: "}", label: "brace expansion (})" },
    { pattern: "*", label: "glob expansion (*)" },
    { pattern: "?", label: "glob expansion (?)" },
    { pattern: "#", label: "shell comment (#)" },
  ];

const WHITESPACE_RE = /\s+/;

/**
 * Executables that should never appear in a package install command.
 */
const BLOCKED_EXECUTABLES = new Set([
  // Destructive
  "rm",
  "rmdir",
  "del",
  // Network/exfil
  "curl",
  "wget",
  "nc",
  "ncat",
  "netcat",
  "socat",
  "telnet",
  "ftp",
  // Privilege escalation
  "sudo",
  "su",
  "doas",
  // Permissions
  "chmod",
  "chown",
  "chgrp",
  // Process/system
  "kill",
  "killall",
  "pkill",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  // Disk
  "dd",
  "mkfs",
  "fdisk",
  "mount",
  "umount",
  // Remote access
  "ssh",
  "scp",
  "sftp",
  // Shells
  "bash",
  "sh",
  "zsh",
  "fish",
  "csh",
  "dash",
  // Misc dangerous
  "eval",
  "exec",
  "env",
  "xargs",
]);

/**
 * Validate a command before execution.
 * Returns an error message if the command is unsafe, or undefined if it's OK.
 */
export function validateCommand(command: string): string | undefined {
  // Layer 1: Block shell metacharacters
  for (const { pattern, label } of SHELL_METACHARACTER_PATTERNS) {
    if (command.includes(pattern)) {
      return `Blocked command: contains ${label} — "${command}"`;
    }
  }

  // Layer 2: Block environment variable injection (VAR=value cmd)
  const firstToken = command.trimStart().split(WHITESPACE_RE)[0];
  if (!firstToken) {
    return "Blocked command: empty command";
  }
  if (firstToken.includes("=")) {
    return `Blocked command: contains environment variable assignment — "${command}"`;
  }

  // Layer 3: Block dangerous executables (first token only).
  // NOTE: This only checks the primary executable (e.g. "npm"), not
  // subcommands. A command like "npm exec -- rm -rf /" passes because
  // "npm" is the first token. Comprehensive subcommand parsing across
  // package managers is not implemented — commands originate from the
  // Sentry API server, and Layer 1 already blocks most injection patterns.
  const executable = path.basename(firstToken);
  if (BLOCKED_EXECUTABLES.has(executable)) {
    return `Blocked command: disallowed executable "${executable}" — "${command}"`;
  }

  return;
}

/**
 * Resolve a path relative to cwd and verify it's inside cwd.
 * Rejects path traversal attempts and symlinks that escape the project directory.
 */
function safePath(cwd: string, relative: string): string {
  const resolved = path.resolve(cwd, relative);
  const normalizedCwd = path.resolve(cwd);
  if (
    !resolved.startsWith(normalizedCwd + path.sep) &&
    resolved !== normalizedCwd
  ) {
    throw new Error(`Path "${relative}" resolves outside project directory`);
  }

  // Follow symlinks: verify the real path also stays within bounds.
  // Resolve cwd through realpathSync too (e.g. macOS /tmp -> /private/tmp).
  let realCwd: string;
  try {
    realCwd = fs.realpathSync(normalizedCwd);
  } catch {
    // cwd doesn't exist yet — no symlinks to follow
    return resolved;
  }

  // For paths that don't exist yet (create ops), walk up to the nearest
  // existing ancestor and check that instead.
  let checkPath = resolved;
  for (;;) {
    try {
      const real = fs.realpathSync(checkPath);
      if (!real.startsWith(realCwd + path.sep) && real !== realCwd) {
        throw new Error(
          `Path "${relative}" resolves outside project directory via symlink`
        );
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      const parent = path.dirname(checkPath);
      if (parent === checkPath) {
        break; // filesystem root
      }
      checkPath = parent;
    }
  }

  return resolved;
}

/**
 * Pre-compute directory listing before the first API call.
 * Uses the same parameters the server's discover-context step would request.
 */
export function precomputeDirListing(directory: string): DirEntry[] {
  const result = listDir({
    type: "local-op",
    operation: "list-dir",
    cwd: directory,
    params: { path: ".", recursive: true, maxDepth: 3, maxEntries: 500 },
  });
  return (result.data as { entries?: DirEntry[] })?.entries ?? [];
}

export async function handleLocalOp(
  payload: LocalOpPayload,
  options: WizardOptions
): Promise<LocalOpResult> {
  try {
    // Validate that the remote-supplied cwd is within the user's project directory
    const normalizedCwd = path.resolve(payload.cwd);
    const normalizedDir = path.resolve(options.directory);
    if (
      normalizedCwd !== normalizedDir &&
      !normalizedCwd.startsWith(normalizedDir + path.sep)
    ) {
      return {
        ok: false,
        error: `Blocked: cwd "${payload.cwd}" is outside project directory "${options.directory}"`,
      };
    }

    switch (payload.operation) {
      case "list-dir":
        return await listDir(payload);
      case "read-files":
        return await readFiles(payload);
      case "file-exists-batch":
        return await fileExistsBatch(payload);
      case "run-commands":
        return await runCommands(payload, options.dryRun);
      case "apply-patchset":
        return await applyPatchset(payload, options.dryRun);
      case "create-sentry-project":
        return await createSentryProject(payload, options);
      default:
        return {
          ok: false,
          error: `Unknown operation: ${
            // biome-ignore lint/suspicious/noExplicitAny: payload is of type LocalOpPayload
            (payload as any).operation
          }`,
        };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function listDir(payload: ListDirPayload): LocalOpResult {
  const { cwd, params } = payload;
  const targetPath = safePath(cwd, params.path);
  const maxDepth = params.maxDepth ?? 3;
  const maxEntries = params.maxEntries ?? 500;
  const recursive = params.recursive ?? false;

  const entries: DirEntry[] = [];

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: walking the directory tree is a complex operation
  function walk(dir: string, depth: number): void {
    if (entries.length >= maxEntries || depth > maxDepth) {
      return;
    }

    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      if (entries.length >= maxEntries) {
        return;
      }

      const relPath = path.relative(cwd, path.join(dir, entry.name));
      const type = entry.isDirectory() ? "directory" : "file";
      entries.push({ name: entry.name, path: relPath, type });

      if (
        recursive &&
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      ) {
        walk(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  walk(targetPath, 0);
  return { ok: true, data: { entries } };
}

function readFiles(payload: ReadFilesPayload): LocalOpResult {
  const { cwd, params } = payload;
  const maxBytes = params.maxBytes ?? MAX_FILE_BYTES;
  const files: Record<string, string | null> = {};

  for (const filePath of params.paths) {
    try {
      const absPath = safePath(cwd, filePath);
      const stat = fs.statSync(absPath);
      if (stat.size > maxBytes) {
        // Read only up to maxBytes
        const buffer = Buffer.alloc(maxBytes);
        const fd = fs.openSync(absPath, "r");
        try {
          fs.readSync(fd, buffer, 0, maxBytes, 0);
        } finally {
          fs.closeSync(fd);
        }
        files[filePath] = buffer.toString("utf-8");
      } else {
        files[filePath] = fs.readFileSync(absPath, "utf-8");
      }
    } catch {
      files[filePath] = null;
    }
  }

  return { ok: true, data: { files } };
}

function fileExistsBatch(payload: FileExistsBatchPayload): LocalOpResult {
  const { cwd, params } = payload;
  const exists: Record<string, boolean> = {};

  for (const filePath of params.paths) {
    try {
      const absPath = safePath(cwd, filePath);
      exists[filePath] = fs.existsSync(absPath);
    } catch {
      exists[filePath] = false;
    }
  }

  return { ok: true, data: { exists } };
}

async function runCommands(
  payload: RunCommandsPayload,
  dryRun?: boolean
): Promise<LocalOpResult> {
  const { cwd, params } = payload;
  const timeoutMs = params.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  // Phase 1: Validate ALL commands upfront (including dry-run)
  for (const command of params.commands) {
    const validationError = validateCommand(command);
    if (validationError) {
      return { ok: false, error: validationError };
    }
  }

  // Phase 2: Execute (skip in dry-run)
  const results: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }> = [];

  for (const command of params.commands) {
    if (dryRun) {
      results.push({
        command,
        exitCode: 0,
        stdout: "(dry-run: skipped)",
        stderr: "",
      });
      continue;
    }

    const result = await runSingleCommand(command, cwd, timeoutMs);
    results.push(result);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: `Command "${command}" failed with exit code ${result.exitCode}: ${result.stderr}`,
        data: { results },
      };
    }
  }

  return { ok: true, data: { results } };
}

// Note: shell: true targets Unix shells. Windows cmd.exe metacharacters
// (%, ^) are not blocked; the CLI assumes a Unix Node.js environment.
function runSingleCommand(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<{
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      shell: true,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutLen < MAX_OUTPUT_BYTES) {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrLen < MAX_OUTPUT_BYTES) {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
      }
    });

    child.on("error", (err) => {
      resolve({
        command,
        exitCode: 1,
        stdout: "",
        stderr: err.message,
      });
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks)
        .toString("utf-8")
        .slice(0, MAX_OUTPUT_BYTES);
      const stderr = Buffer.concat(stderrChunks)
        .toString("utf-8")
        .slice(0, MAX_OUTPUT_BYTES);
      resolve({ command, exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function applyPatchsetDryRun(payload: ApplyPatchsetPayload): LocalOpResult {
  const { cwd, params } = payload;
  const applied: Array<{ path: string; action: string }> = [];

  for (const patch of params.patches) {
    safePath(cwd, patch.path);
    if (!["create", "modify", "delete"].includes(patch.action)) {
      return {
        ok: false,
        error: `Unknown patch action: "${patch.action}" for path "${patch.path}"`,
      };
    }
    applied.push({ path: patch.path, action: patch.action });
  }

  return { ok: true, data: { applied } };
}

function applyPatchset(
  payload: ApplyPatchsetPayload,
  dryRun?: boolean
): LocalOpResult {
  if (dryRun) {
    return applyPatchsetDryRun(payload);
  }

  const { cwd, params } = payload;

  // Phase 1: Validate all paths and actions before writing anything
  for (const patch of params.patches) {
    safePath(cwd, patch.path);
    if (!["create", "modify", "delete"].includes(patch.action)) {
      return {
        ok: false,
        error: `Unknown patch action: "${patch.action}" for path "${patch.path}"`,
      };
    }
  }

  // Phase 2: Apply patches
  const applied: Array<{ path: string; action: string }> = [];

  for (const patch of params.patches) {
    const absPath = safePath(cwd, patch.path);

    switch (patch.action) {
      case "create": {
        const dir = path.dirname(absPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(absPath, patch.patch, "utf-8");
        applied.push({ path: patch.path, action: "create" });
        break;
      }
      case "modify": {
        if (!fs.existsSync(absPath)) {
          return {
            ok: false,
            error: `Cannot modify "${patch.path}": file does not exist`,
            data: { applied },
          };
        }
        fs.writeFileSync(absPath, patch.patch, "utf-8");
        applied.push({ path: patch.path, action: "modify" });
        break;
      }
      case "delete": {
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath);
        }
        applied.push({ path: patch.path, action: "delete" });
        break;
      }
      default:
        return {
          ok: false,
          error: `Unknown patch action: "${patch.action}" for path "${patch.path}"`,
          data: { applied },
        };
    }
  }

  return { ok: true, data: { applied } };
}

/**
 * Resolve the org slug from local config, env vars, or by listing the user's
 * organizations from the API as a fallback.
 * Returns the slug on success, or a LocalOpResult error to return early.
 */
async function resolveOrgSlug(
  cwd: string,
  yes: boolean
): Promise<string | LocalOpResult> {
  const resolved = await resolveOrg({ cwd });
  if (resolved) {
    return resolved.org;
  }

  // Fallback: list user's organizations from API
  const orgs = await listOrganizations();
  if (orgs.length === 0) {
    return {
      ok: false,
      error: "Not authenticated. Run 'sentry login' first.",
    };
  }
  if (orgs.length === 1 && orgs[0]) {
    return orgs[0].slug;
  }

  // Multiple orgs — interactive selection
  if (yes) {
    const slugs = orgs.map((o) => o.slug).join(", ");
    return {
      ok: false,
      error: `Multiple organizations found (${slugs}). Set SENTRY_ORG to specify which one.`,
    };
  }
  const selected = await select({
    message: "Which organization should the project be created in?",
    options: orgs.map((o) => ({
      value: o.slug,
      label: o.name,
      hint: o.slug,
    })),
  });
  if (isCancel(selected)) {
    return { ok: false, error: "Organization selection cancelled." };
  }
  return selected;
}

async function createSentryProject(
  payload: CreateSentryProjectPayload,
  options: WizardOptions
): Promise<LocalOpResult> {
  const { name, platform } = payload.params;
  const slug = slugify(name);
  if (!slug) {
    return {
      ok: false,
      error: `Invalid project name: "${name}" produces an empty slug.`,
    };
  }

  // In dry-run mode, skip all API calls and return placeholder data
  if (options.dryRun) {
    return {
      ok: true,
      data: {
        orgSlug: "(dry-run)",
        projectSlug: slug,
        projectId: "(dry-run)",
        dsn: "(dry-run)",
        url: "(dry-run)",
      },
    };
  }

  try {
    // 1. Resolve org
    const orgResult = await resolveOrgSlug(payload.cwd, options.yes);
    if (typeof orgResult !== "string") {
      return orgResult;
    }
    const orgSlug = orgResult;

    // 2. Resolve or create team
    const team = await resolveOrCreateTeam(orgSlug, {
      autoCreateSlug: slug,
      usageHint: "sentry init",
    });

    // 3. Create project
    const project = await createProject(orgSlug, team.slug, {
      name,
      platform,
    });

    // 4. Get DSN (best-effort)
    const dsn = await tryGetPrimaryDsn(orgSlug, project.slug);

    // 5. Build URL
    const url = buildProjectUrl(orgSlug, project.slug);

    return {
      ok: true,
      data: {
        orgSlug,
        projectSlug: project.slug,
        projectId: project.id,
        dsn: dsn ?? "",
        url,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
