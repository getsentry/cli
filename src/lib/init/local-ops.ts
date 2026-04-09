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
  createProjectWithDsn,
  getProject,
  listOrganizations,
  tryGetPrimaryDsn,
} from "../api-client.js";
import { ApiError } from "../errors.js";
import { resolveOrCreateTeam } from "../resolve-team.js";
import { buildProjectUrl } from "../sentry-urls.js";
import { slugify } from "../utils.js";
import { WizardCancelledError } from "./clack-utils.js";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_FILE_BYTES,
  MAX_OUTPUT_BYTES,
} from "./constants.js";
import { resolveOrgPrefetched } from "./prefetch.js";
import { replace } from "./replacers.js";
import type {
  ApplyPatchsetPatch,
  ApplyPatchsetPayload,
  CreateSentryProjectPayload,
  DetectSentryPayload,
  DirEntry,
  FileExistsBatchPayload,
  ListDirPayload,
  LocalOpPayload,
  LocalOpResult,
  ReadFilesPayload,
  RunCommandsPayload,
  WizardOptions,
} from "./types.js";

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
 * Patterns that indicate shell injection. Commands run via `spawn` (no shell),
 * so these have no runtime effect — they are defense-in-depth against command
 * chaining, piping, redirection, and command substitution.
 *
 * Characters that are harmless without a shell — quotes, braces, globs,
 * parentheses, backslashes, bare `$`, `#` — are intentionally NOT blocked.
 * They appear in legitimate package specifiers like
 * `pip install sentry-sdk[django]` or version ranges with `*`.
 *
 * Ordering: multi-char operators (`&&`, `||`) before single-char prefixes
 * (`&`, `|`) so the reported label describes what the user actually wrote.
 */
const SHELL_METACHARACTER_PATTERNS: Array<{ pattern: string; label: string }> =
  [
    { pattern: ";", label: "command chaining (;)" },
    { pattern: "&&", label: "command chaining (&&)" },
    { pattern: "||", label: "command chaining (||)" },
    { pattern: "|", label: "piping (|)" },
    { pattern: "&", label: "background execution (&)" },
    { pattern: "`", label: "command substitution (`)" },
    { pattern: "$(", label: "command substitution ($()" },
    { pattern: "\n", label: "newline" },
    { pattern: "\r", label: "carriage return" },
    { pattern: ">", label: "redirection (>)" },
    { pattern: "<", label: "redirection (<)" },
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
export async function precomputeDirListing(
  directory: string
): Promise<DirEntry[]> {
  const result = await listDir({
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
        return await applyPatchset(payload, options.dryRun, options.authToken);
      case "create-sentry-project":
        return await createSentryProject(payload, options);
      case "detect-sentry":
        return await detectSentry(payload);
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

async function listDir(payload: ListDirPayload): Promise<LocalOpResult> {
  const { cwd, params } = payload;
  const targetPath = safePath(cwd, params.path);
  const maxDepth = params.maxDepth ?? 3;
  const maxEntries = params.maxEntries ?? 500;
  const recursive = params.recursive ?? false;

  const entries: DirEntry[] = [];

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: recursive directory walk is inherently complex but straightforward
  async function walk(dir: string, depth: number): Promise<void> {
    if (entries.length >= maxEntries || depth > maxDepth) {
      return;
    }

    let dirEntries: fs.Dirent[];
    try {
      dirEntries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      if (entries.length >= maxEntries) {
        return;
      }

      const relPath = path.relative(cwd, path.join(dir, entry.name));

      // Skip symlinks that escape the project directory
      if (entry.isSymbolicLink()) {
        try {
          safePath(cwd, relPath);
        } catch {
          continue;
        }
      }

      const type = entry.isDirectory() ? "directory" : "file";
      entries.push({ name: entry.name, path: relPath, type });

      if (
        recursive &&
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      ) {
        await walk(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  await walk(targetPath, 0);
  return { ok: true, data: { entries } };
}

async function readSingleFile(
  cwd: string,
  filePath: string,
  maxBytes: number
): Promise<string | null> {
  try {
    const absPath = safePath(cwd, filePath);
    const stat = await fs.promises.stat(absPath);
    let content: string;
    if (stat.size > maxBytes) {
      const fh = await fs.promises.open(absPath, "r");
      try {
        const buffer = Buffer.alloc(maxBytes);
        await fh.read(buffer, 0, maxBytes, 0);
        content = buffer.toString("utf-8");
      } finally {
        await fh.close();
      }
    } else {
      content = await fs.promises.readFile(absPath, "utf-8");
    }

    // Minify JSON files by stripping whitespace/formatting
    if (filePath.endsWith(".json")) {
      try {
        content = JSON.stringify(JSON.parse(content));
      } catch {
        // Not valid JSON (truncated, JSONC, etc.) — send as-is
      }
    }

    return content;
  } catch {
    return null;
  }
}

async function readFiles(payload: ReadFilesPayload): Promise<LocalOpResult> {
  const { cwd, params } = payload;
  const maxBytes = params.maxBytes ?? MAX_FILE_BYTES;

  const results = await Promise.all(
    params.paths.map(async (filePath) => {
      const content = await readSingleFile(cwd, filePath, maxBytes);
      return [filePath, content] as const;
    })
  );

  const files: Record<string, string | null> = {};
  for (const [filePath, content] of results) {
    files[filePath] = content;
  }

  return { ok: true, data: { files } };
}

async function fileExistsBatch(
  payload: FileExistsBatchPayload
): Promise<LocalOpResult> {
  const { cwd, params } = payload;

  const results = await Promise.all(
    params.paths.map(async (filePath) => {
      try {
        const absPath = safePath(cwd, filePath);
        await fs.promises.access(absPath);
        return [filePath, true] as const;
      } catch {
        return [filePath, false] as const;
      }
    })
  );

  const exists: Record<string, boolean> = {};
  for (const [filePath, found] of results) {
    exists[filePath] = found;
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

// Runs the executable directly (no shell) to eliminate shell injection as an
// attack vector. The command string is split on whitespace into [exe, ...args].
// validateCommand() still blocks metacharacters as defense-in-depth.
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
    const [executable = "", ...args] = command.trim().split(WHITESPACE_RE);
    const child = spawn(executable, args, {
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

/** Pattern matching empty or placeholder SENTRY_AUTH_TOKEN values in env files.
 *  Uses [ \t] (horizontal whitespace) instead of \s to avoid consuming newlines. */
const EMPTY_AUTH_TOKEN_RE =
  /^(SENTRY_AUTH_TOKEN[ \t]*=[ \t]*)(?:['"]?[ \t]*['"]?)?[ \t]*$/m;

/**
 * Resolve the final file content for a full-content patch (create only),
 * pretty-printing JSON files to preserve readable formatting, and injecting
 * the auth token into env files when the server left it empty.
 */
function resolvePatchContent(
  patch: { path: string; patch: string },
  authToken?: string
): string {
  let content = patch.path.endsWith(".json")
    ? prettyPrintJson(patch.patch, DEFAULT_JSON_INDENT)
    : patch.patch;

  // Inject the auth token into env files when the AI left the value empty.
  // The server never has access to the user's token, so it generates
  // SENTRY_AUTH_TOKEN= (empty). We fill it in client-side.
  if (authToken && isEnvFile(patch.path) && EMPTY_AUTH_TOKEN_RE.test(content)) {
    content = content.replace(EMPTY_AUTH_TOKEN_RE, `$1${authToken}`);
  }

  return content;
}

/** Returns true if the file path looks like a .env file. */
function isEnvFile(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? "";
  return name === ".env" || name.startsWith(".env.");
}

const VALID_PATCH_ACTIONS = new Set(["create", "modify", "delete"]);

/**
 * Apply edits (oldString/newString pairs) to a file using fuzzy matching.
 * Edits are applied sequentially — each edit operates on the result of the
 * previous one. Returns the final file content.
 */
async function applyEdits(
  absPath: string,
  filePath: string,
  edits: Array<{ oldString: string; newString: string }>
): Promise<string> {
  let content = await fs.promises.readFile(absPath, "utf-8");

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i] as (typeof edits)[number];
    try {
      content = replace(content, edit.oldString, edit.newString);
    } catch (err) {
      throw new Error(
        `Edit #${i + 1} failed on "${filePath}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return content;
}

async function applySinglePatch(
  absPath: string,
  patch: ApplyPatchsetPatch,
  authToken?: string
): Promise<void> {
  switch (patch.action) {
    case "create": {
      await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
      const content = resolvePatchContent(
        patch as ApplyPatchsetPatch & { patch: string },
        authToken
      );
      await fs.promises.writeFile(absPath, content, "utf-8");
      break;
    }
    case "modify": {
      const content = await applyEdits(absPath, patch.path, patch.edits);
      await fs.promises.writeFile(absPath, content, "utf-8");
      break;
    }
    case "delete": {
      try {
        await fs.promises.unlink(absPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }
      break;
    }
    default:
      break;
  }
}

async function applyPatchset(
  payload: ApplyPatchsetPayload,
  dryRun?: boolean,
  authToken?: string
): Promise<LocalOpResult> {
  if (dryRun) {
    return applyPatchsetDryRun(payload);
  }

  const { cwd, params } = payload;

  // Phase 1: Validate all paths and actions before writing anything
  for (const patch of params.patches) {
    safePath(cwd, patch.path);
    if (!VALID_PATCH_ACTIONS.has(patch.action)) {
      return {
        ok: false,
        error: `Unknown patch action: "${patch.action}" for path "${patch.path}"`,
      };
    }
  }

  // Phase 2: Apply patches (sequential — later patches may depend on earlier creates)
  const applied: Array<{ path: string; action: string }> = [];

  for (const patch of params.patches) {
    const absPath = safePath(cwd, patch.path);

    if (patch.action === "modify") {
      try {
        await fs.promises.access(absPath);
      } catch {
        return {
          ok: false,
          error: `Cannot modify "${patch.path}": file does not exist`,
          data: { applied },
        };
      }
    }

    await applySinglePatch(absPath, patch, authToken);
    applied.push({ path: patch.path, action: patch.action });
  }

  return { ok: true, data: { applied } };
}

/** Matches a bare numeric org ID extracted from a DSN (e.g. "4507492088676352"). */
const NUMERIC_ORG_ID_RE = /^\d+$/;

/**
 * Resolve the org slug using the shared offline-first resolver, falling back
 * to interactive selection when multiple orgs are available.
 *
 * Uses the prefetch-aware helper from `./prefetch.ts` — if
 * {@link warmOrgDetection} was called earlier (by `init.ts`), the result is
 * already cached and returns near-instantly.
 *
 * Resolution priority (via `resolveOrg`):
 * 1. CLI `--org` flag
 * 2. `SENTRY_ORG` / `SENTRY_PROJECT` env vars
 * 3. Config defaults (SQLite)
 * 4. DSN auto-detection (with numeric ID normalization)
 *
 * If none of the above resolve, lists the user's organizations (SQLite-cached
 * after `sentry login`) and prompts for selection.
 *
 * @returns The org slug on success, or a {@link LocalOpResult} error to return early.
 */
export async function resolveOrgSlug(
  cwd: string,
  yes: boolean
): Promise<string | LocalOpResult> {
  // normalizeNumericOrg inside resolveOrg may return a raw numeric ID when
  // the cache is cold and the API refresh fails. Numeric IDs break write
  // operations (project/team creation), so fall through to the org picker.
  const resolved = await resolveOrgPrefetched(cwd);
  if (resolved && !NUMERIC_ORG_ID_RE.test(resolved.org)) {
    return resolved.org;
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
    throw new WizardCancelledError();
  }
  return selected;
}

/**
 * Try to fetch an existing project by org + slug. Returns a successful
 * LocalOpResult if the project exists, or null if it doesn't (404).
 * Other errors are left to propagate.
 */
export async function tryGetExistingProject(
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
export async function detectExistingProject(cwd: string): Promise<{
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

async function detectSentry(
  payload: DetectSentryPayload
): Promise<LocalOpResult> {
  const { detectDsn } = await import("../dsn/index.js");
  const dsn = await detectDsn(payload.cwd);

  if (!dsn) {
    return { ok: true, data: { status: "none", signals: [] } };
  }

  const signals = [
    `dsn: ${dsn.source}${dsn.sourcePath ? ` (${dsn.sourcePath})` : ""}`,
  ];

  return {
    ok: true,
    data: { status: "installed", signals, dsn: dsn.raw },
  };
}

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
        dsn: "https://key@o0.ingest.sentry.io/0",
        url: "https://sentry.io/dry-run",
      },
    };
  }

  // org is always set by resolvePreSpinnerOptions before this runs
  if (!options.org) {
    return {
      ok: false,
      error: "Internal error: org not resolved before createSentryProject.",
    };
  }

  try {
    const orgSlug = options.org;

    // If both org and project are set, check if the project already exists.
    // This avoids a 409 Conflict when re-running init on an existing project
    // (e.g. `sentry init acme/my-app` run twice).
    if (options.org && options.project) {
      const existing = await tryGetExistingProject(orgSlug, slug);
      if (existing) {
        return {
          ...existing,
          message: `Using existing project "${slug}" in ${orgSlug}`,
        };
      }
    }

    // 4. Resolve or create team
    const team = await resolveOrCreateTeam(orgSlug, {
      team: options.team,
      autoCreateSlug: slug,
      usageHint: "sentry init",
    });

    // 5. Create project, fetch DSN, and build URL
    const { project, dsn, url } = await createProjectWithDsn(
      orgSlug,
      team.slug,
      { name, platform }
    );

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
