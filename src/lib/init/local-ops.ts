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
  getProject,
  listOrganizations,
  tryGetPrimaryDsn,
} from "../api-client.js";
import { ApiError } from "../errors.js";
import { resolveOrCreateTeam } from "../resolve-team.js";
import { buildProjectUrl } from "../sentry-urls.js";
import { slugify } from "../utils.js";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_FILE_BYTES,
  MAX_OUTPUT_BYTES,
} from "./constants.js";
import { resolveOrgPrefetched } from "./prefetch.js";
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

/** Matches a bare numeric org ID extracted from a DSN (e.g. "4507492088676352"). */
const NUMERIC_ORG_ID_RE = /^\d+$/;

/** Whitespace characters used for JSON indentation. */
const Indenter = {
  SPACE: " ",
  TAB: "\t",
} as const;

/** Describes the indentation style of a JSON file. */
type JsonIndent = {
  /** The whitespace character used for indentation. */
  replacer: (typeof Indenter)[keyof typeof Indenter];
  /** How many times the replacer is repeated per indent level. */
  length: number;
};

const DEFAULT_JSON_INDENT: JsonIndent = {
  replacer: Indenter.SPACE,
  length: 2,
};

/** Matches the first indented line in a string to detect whitespace style. */
const INDENT_PATTERN = /^(\s+)/m;

/**
 * Detect the indentation style of a JSON string by inspecting the first
 * indented line. Returns a default of 2 spaces if no indentation is found.
 */
function detectJsonIndent(content: string): JsonIndent {
  const match = content.match(INDENT_PATTERN);
  if (!match?.[1]) {
    return DEFAULT_JSON_INDENT;
  }
  const indent = match[1];
  if (indent.includes("\t")) {
    return { replacer: Indenter.TAB, length: indent.length };
  }
  return { replacer: Indenter.SPACE, length: indent.length };
}

/** Build the third argument for `JSON.stringify` from a `JsonIndent`. */
function jsonIndentArg(indent: JsonIndent): string {
  return indent.replacer.repeat(indent.length);
}

/**
 * Pretty-print a JSON string using the given indentation style.
 * Returns the original string if it cannot be parsed as valid JSON.
 */
function prettyPrintJson(content: string, indent: JsonIndent): string {
  try {
    return `${JSON.stringify(JSON.parse(content), null, jsonIndentArg(indent))}\n`;
  } catch {
    return content;
  }
}

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
    { pattern: "&", label: "background execution (&)" },
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

  // Layer 4: Block interactive Sentry setup CLIs. These require a TTY to
  // prompt the user and will always fail when run non-interactively.
  // `sentry init` is itself the replacement for @sentry/wizard — it should
  // never need to invoke the old wizard as a subprocess.
  const tokens = command.split(WHITESPACE_RE);
  if (tokens.some((t) => t.includes("@sentry/wizard"))) {
    return `Blocked command: "@sentry/wizard" is an interactive CLI that requires a TTY. Use a direct package manager install command instead (e.g. "npm install @sentry/nextjs") — "${command}"`;
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
      let content: string;
      if (stat.size > maxBytes) {
        // Read only up to maxBytes
        const buffer = Buffer.alloc(maxBytes);
        const fd = fs.openSync(absPath, "r");
        try {
          fs.readSync(fd, buffer, 0, maxBytes, 0);
        } finally {
          fs.closeSync(fd);
        }
        content = buffer.toString("utf-8");
      } else {
        content = fs.readFileSync(absPath, "utf-8");
      }

      // Minify JSON files by stripping whitespace/formatting
      if (filePath.endsWith(".json")) {
        try {
          content = JSON.stringify(JSON.parse(content));
        } catch {
          // Not valid JSON (truncated, JSONC, etc.) — send as-is
        }
      }

      files[filePath] = content;
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

/**
 * Resolve the final file content for a patch, pretty-printing JSON files
 * to preserve readable formatting. For `modify` actions, the existing file's
 * indentation style is detected and preserved. For `create` actions, a default
 * of 2-space indentation is used.
 */
function resolvePatchContent(
  absPath: string,
  patch: ApplyPatchsetPayload["params"]["patches"][number]
): string {
  if (!patch.path.endsWith(".json")) {
    return patch.patch;
  }
  if (patch.action === "modify") {
    const existing = fs.readFileSync(absPath, "utf-8");
    return prettyPrintJson(patch.patch, detectJsonIndent(existing));
  }
  return prettyPrintJson(patch.patch, DEFAULT_JSON_INDENT);
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
        const content = resolvePatchContent(absPath, patch);
        fs.writeFileSync(absPath, content, "utf-8");
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
        const content = resolvePatchContent(absPath, patch);
        fs.writeFileSync(absPath, content, "utf-8");
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
 *
 * DSN scanning uses the prefetch-aware helper from `./prefetch.ts` — if
 * {@link warmOrgDetection} was called earlier (by `init.ts`), the result is
 * already cached and returns near-instantly.
 *
 * `listOrganizations()` uses SQLite caching for near-instant warm lookups
 * (populated after `sentry login` or the first API call), so it does not
 * need background prefetching.
 *
 * @returns The org slug on success, or a {@link LocalOpResult} error to return early.
 */
async function resolveOrgSlug(
  cwd: string,
  yes: boolean
): Promise<string | LocalOpResult> {
  const resolved = await resolveOrgPrefetched(cwd);
  if (resolved) {
    // If the detected org is a raw numeric ID (extracted from a DSN), try to
    // resolve it to a real slug. Numeric IDs can fail for write operations like
    // project/team creation, and may belong to a different Sentry account.
    if (NUMERIC_ORG_ID_RE.test(resolved.org)) {
      const { getOrgByNumericId } = await import("../db/regions.js");
      const match = getOrgByNumericId(resolved.org);
      if (match) {
        return match.slug;
      }
      // Cache miss — fall through to listOrganizations() for proper selection
    } else {
      return resolved.org;
    }
  }

  // Fallback: list user's organizations (SQLite-cached after login/first call)
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

/**
 * Try to fetch an existing project by org + slug. Returns a successful
 * LocalOpResult if the project exists, or null if it doesn't (404).
 * Other errors are left to propagate.
 */
async function tryGetExistingProject(
  orgSlug: string,
  projectSlug: string
): Promise<LocalOpResult | null> {
  try {
    const project = await getProject(orgSlug, projectSlug);
    const dsn = await tryGetPrimaryDsn(orgSlug, project.slug);
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
    // 404 means project doesn't exist — fall through to creation
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Detect an existing Sentry project by looking for a DSN in the project.
 *
 * Returns org and project slugs when the DSN's project can be resolved —
 * either from the local cache or via API (when the org is accessible).
 * Returns null when no DSN is found or the org belongs to a different account.
 */
async function detectExistingProject(cwd: string): Promise<{
  orgSlug: string;
  projectSlug: string;
} | null> {
  const { detectDsn } = await import("../dsn/index.js");
  const dsn = await detectDsn(cwd);
  if (!dsn?.publicKey) {
    return null;
  }

  try {
    const { resolveDsnByPublicKey } = await import("../resolve-target.js");
    const resolved = await resolveDsnByPublicKey(dsn);
    if (resolved) {
      return { orgSlug: resolved.org, projectSlug: resolved.project };
    }
  } catch {
    // Auth error or network error — org inaccessible, fall through to creation
  }
  return null;
}

/**
 * When no explicit org/project is provided, check for an existing Sentry setup
 * and either auto-select it (--yes) or prompt the user interactively.
 *
 * Returns a LocalOpResult to return early, or null to proceed with creation.
 */
async function promptForExistingProject(
  cwd: string,
  yes: boolean
): Promise<LocalOpResult | null> {
  const existing = await detectExistingProject(cwd);
  if (!existing) {
    return null;
  }

  if (yes) {
    return tryGetExistingProject(existing.orgSlug, existing.projectSlug);
  }

  const choice = await select({
    message: "Found an existing Sentry project in this codebase.",
    options: [
      {
        value: "existing" as const,
        label: `Use existing project (${existing.orgSlug}/${existing.projectSlug})`,
        hint: "Sentry is already configured here",
      },
      {
        value: "create" as const,
        label: "Create a new Sentry project",
      },
    ],
  });
  if (isCancel(choice)) {
    return { ok: false, error: "Cancelled." };
  }
  if (choice === "existing") {
    const result = await tryGetExistingProject(
      existing.orgSlug,
      existing.projectSlug
    );
    if (result) {
      return result;
    }
    // Project deleted or inaccessible — fall through to creation
  }
  return null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: wizard orchestration requires sequential branching
async function createSentryProject(
  payload: CreateSentryProjectPayload,
  options: WizardOptions
): Promise<LocalOpResult> {
  // Use CLI-provided project name if available, otherwise use wizard-detected name
  const name = options.project ?? payload.params.name;
  const { platform } = payload.params;
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
        orgSlug: options.org ?? "(dry-run)",
        projectSlug: slug,
        projectId: "(dry-run)",
        dsn: "(dry-run)",
        url: "(dry-run)",
      },
    };
  }

  try {
    // 1. When no explicit org/project provided, check if Sentry is already set up
    if (!(options.org || options.project)) {
      const result = await promptForExistingProject(payload.cwd, options.yes);
      if (result) {
        return result;
      }
    }

    // 2. Resolve org — skip interactive resolution if explicitly provided via CLI arg
    let orgSlug: string;
    if (options.org) {
      orgSlug = options.org;
    } else {
      const orgResult = await resolveOrgSlug(payload.cwd, options.yes);
      if (typeof orgResult !== "string") {
        return orgResult;
      }
      orgSlug = orgResult;
    }

    // 2.5 Bare slug → project name: check if it already exists in the resolved org.
    //     When a bare slug was passed (options.project set, options.org unset),
    //     org was auto-resolved above. Verify the project doesn't already exist
    //     and prompt the user if it does.
    if (options.project && !options.org) {
      const existing = await tryGetExistingProject(orgSlug, slug);
      if (existing) {
        if (options.yes) {
          return existing;
        }
        const choice = await select({
          message: `Found existing project '${slug}' in ${orgSlug}.`,
          options: [
            {
              value: "existing" as const,
              label: `Use existing (${orgSlug}/${slug})`,
              hint: "Already configured",
            },
            {
              value: "create" as const,
              label: "Create a new project with this name",
            },
          ],
        });
        if (isCancel(choice)) {
          return { ok: false, error: "Cancelled." };
        }
        if (choice === "existing") {
          return existing;
        }
        // Fall through to create a new project
      }
    }

    // 3. If both org and project were provided explicitly, check if the project
    //    already exists. This avoids a 409 Conflict from the create API when
    //    re-running init on an existing Sentry project.
    if (options.org && options.project) {
      const existing = await tryGetExistingProject(orgSlug, slug);
      if (existing) {
        return existing;
      }
    }

    // 4. Resolve or create team
    const team = await resolveOrCreateTeam(orgSlug, {
      team: options.team,
      autoCreateSlug: slug,
      usageHint: "sentry init",
    });

    // 5. Create project
    const project = await createProject(orgSlug, team.slug, {
      name,
      platform,
    });

    // 6. Get DSN (best-effort)
    const dsn = await tryGetPrimaryDsn(orgSlug, project.slug);

    // 7. Build URL
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
    return { ok: false, error: formatLocalOpError(error) };
  }
}

/** Format an error from a local-op into a user-facing message string. */
function formatLocalOpError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.format();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
