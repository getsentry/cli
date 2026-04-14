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
  GlobPayload,
  GrepPayload,
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

/**
 * Common config file names that are frequently requested by multiple workflow
 * steps (discover-context, detect-platform, plan-codemods). Pre-reading them
 * eliminates 1-3 suspend/resume round-trips.
 */
const COMMON_CONFIG_FILES = [
  // ── Manifests (all ecosystems) ──
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "setup.py",
  "setup.cfg",
  "Pipfile",
  "Gemfile",
  "Gemfile.lock",
  "go.mod",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "pom.xml",
  "Cargo.toml",
  "pubspec.yaml",
  "mix.exs",
  "composer.json",
  "Podfile",
  "CMakeLists.txt",

  // ── JavaScript/TypeScript framework configs ──
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "nuxt.config.ts",
  "nuxt.config.js",
  "angular.json",
  "astro.config.mjs",
  "astro.config.ts",
  "svelte.config.js",
  "remix.config.js",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "metro.config.js",
  "app.json",
  "electron-builder.yml",
  "wrangler.toml",
  "wrangler.jsonc",
  "serverless.yml",
  "serverless.ts",
  "bunfig.toml",

  // ── Python entry points / framework markers ──
  "manage.py",
  "app.py",
  "main.py",

  // ── PHP framework markers ──
  "artisan",
  "symfony.lock",
  "wp-config.php",
  "config/packages/sentry.yaml",

  // ── .NET ──
  "appsettings.json",
  "Program.cs",
  "Startup.cs",

  // ── Java / Android ──
  "app/build.gradle",
  "app/build.gradle.kts",
  "src/main/resources/application.properties",
  "src/main/resources/application.yml",

  // ── Ruby (Rails) ──
  "config/application.rb",

  // ── Go entry point ──
  "main.go",

  // ── Sentry configs (all ecosystems) ──
  "sentry.client.config.ts",
  "sentry.client.config.js",
  "sentry.server.config.ts",
  "sentry.server.config.js",
  "sentry.edge.config.ts",
  "sentry.edge.config.js",
  "sentry.properties",
  "instrumentation.ts",
  "instrumentation.js",
];

const MAX_PREREAD_TOTAL_BYTES = 512 * 1024;

/**
 * Pre-read common config files that exist in the directory listing.
 * Returns a fileCache map (path -> content or null) that the server
 * can use to skip read-files suspend/resume round-trips.
 */
export async function preReadCommonFiles(
  directory: string,
  dirListing: DirEntry[]
): Promise<Record<string, string | null>> {
  const listingPaths = new Set(
    dirListing.map((e) => e.path.replaceAll("\\", "/"))
  );
  const toRead = COMMON_CONFIG_FILES.filter((f) => listingPaths.has(f));

  const cache: Record<string, string | null> = {};
  let totalBytes = 0;

  for (const filePath of toRead) {
    if (totalBytes >= MAX_PREREAD_TOTAL_BYTES) {
      break;
    }
    try {
      const absPath = path.join(directory, filePath);
      const stat = await fs.promises.stat(absPath);
      if (stat.size > MAX_FILE_BYTES) {
        continue;
      }
      const content = await fs.promises.readFile(absPath, "utf-8");
      if (totalBytes + content.length <= MAX_PREREAD_TOTAL_BYTES) {
        cache[filePath] = content;
        totalBytes += content.length;
      }
    } catch {
      cache[filePath] = null;
    }
  }

  return cache;
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
      case "grep":
        return await grep(payload);
      case "glob":
        return await glob(payload);
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
    content = content.replace(
      EMPTY_AUTH_TOKEN_RE,
      (_, prefix) => `${prefix}${authToken}`
    );
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

// ── Grep & Glob ─────────────────────────────────────────────────────

const MAX_GREP_RESULTS_PER_SEARCH = 100;
const MAX_GREP_LINE_LENGTH = 2000;
const MAX_GLOB_RESULTS = 100;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
]);

type GrepMatch = { path: string; lineNum: number; line: string };

// ── Ripgrep implementations (preferred when rg is on PATH) ──────────

/**
 * Spawn a command, collect stdout + stderr, reject on spawn errors (ENOENT).
 * Drains both streams to prevent pipe buffer deadlocks.
 */
function spawnCollect(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });

    const outChunks: Buffer[] = [];
    let outLen = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      if (outLen < MAX_OUTPUT_BYTES) {
        outChunks.push(chunk);
        outLen += chunk.length;
      }
    });

    const errChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => {
      if (errChunks.length < 64) {
        errChunks.push(chunk);
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`Process killed by ${signal} (timeout)`));
        return;
      }
      resolve({
        stdout: Buffer.concat(outChunks).toString("utf-8"),
        stderr: Buffer.concat(errChunks).toString("utf-8"),
        exitCode: code ?? 1,
      });
    });
  });
}

/**
 * Parse ripgrep output using `|` as field separator (set via
 * `--field-match-separator=|`) to avoid ambiguity with `:` in
 * Windows drive-letter paths.
 * Format: filepath|linenum|matched text
 */
function parseRgGrepOutput(
  cwd: string,
  stdout: string,
  maxResults: number
): { matches: GrepMatch[]; truncated: boolean } {
  const lines = stdout.split("\n").filter(Boolean);
  const truncated = lines.length > maxResults;
  const matches: GrepMatch[] = [];

  for (const line of lines.slice(0, maxResults)) {
    const firstSep = line.indexOf("|");
    if (firstSep === -1) {
      continue;
    }
    const filePart = line.substring(0, firstSep);
    const rest = line.substring(firstSep + 1);
    const secondSep = rest.indexOf("|");
    if (secondSep === -1) {
      continue;
    }
    const lineNum = Number.parseInt(rest.substring(0, secondSep), 10);
    let text = rest.substring(secondSep + 1);
    if (text.length > MAX_GREP_LINE_LENGTH) {
      text = `${text.substring(0, MAX_GREP_LINE_LENGTH)}…`;
    }
    matches.push({ path: path.relative(cwd, filePart), lineNum, line: text });
  }

  return { matches, truncated };
}

async function rgGrepSearch(opts: {
  cwd: string;
  pattern: string;
  target: string;
  include: string | undefined;
  maxResults: number;
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const { cwd, pattern, target, include, maxResults } = opts;
  const args = [
    "-nH",
    "--no-messages",
    "--hidden",
    "--field-match-separator=|",
    "--regexp",
    pattern,
  ];
  if (include) {
    args.push("--glob", include);
  }
  args.push(target);

  const { stdout, exitCode } = await spawnCollect("rg", args, cwd);

  if (exitCode === 1 || (exitCode === 2 && !stdout.trim())) {
    return { matches: [], truncated: false };
  }
  if (exitCode !== 0 && exitCode !== 2) {
    throw new Error(`ripgrep failed with exit code ${exitCode}`);
  }

  return parseRgGrepOutput(cwd, stdout, maxResults);
}

async function rgGlobSearch(opts: {
  cwd: string;
  pattern: string;
  target: string;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const { cwd, pattern, target, maxResults } = opts;
  const args = ["--files", "--hidden", "--glob", pattern, target];

  const { stdout, exitCode } = await spawnCollect("rg", args, cwd);

  if (exitCode === 1 || (exitCode === 2 && !stdout.trim())) {
    return { files: [], truncated: false };
  }
  if (exitCode !== 0 && exitCode !== 2) {
    throw new Error(`ripgrep failed with exit code ${exitCode}`);
  }

  const lines = stdout.split("\n").filter(Boolean);
  const truncated = lines.length > maxResults;
  const files = lines.slice(0, maxResults).map((f) => path.relative(cwd, f));
  return { files, truncated };
}

// ── Node.js fallback (when rg is not installed) ─────────────────────

/**
 * Recursively walk a directory, yielding relative file paths.
 * Skips common non-source directories and respects an optional glob filter.
 */
async function* walkFiles(
  root: string,
  base: string,
  globPattern: string | undefined
): AsyncGenerator<string> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(base, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      yield* walkFiles(root, full, globPattern);
    } else if (entry.isFile()) {
      const matchTarget = globPattern?.includes("/") ? rel : entry.name;
      if (!globPattern || matchGlob(matchTarget, globPattern)) {
        yield rel;
      }
    }
  }
}

/** Minimal glob matcher — supports `*`, `**`, and `?` wildcards. */
function matchGlob(name: string, pattern: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(name);
}

/**
 * Search files for a regex pattern using Node.js fs. Fallback for when
 * ripgrep is not available.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: file-walking search with early exits
async function fsGrepSearch(opts: {
  cwd: string;
  pattern: string;
  searchPath: string | undefined;
  include: string | undefined;
  maxResults: number;
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const { cwd, pattern, searchPath, include, maxResults } = opts;
  const target = searchPath ? safePath(cwd, searchPath) : cwd;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return { matches: [], truncated: false };
  }
  const matches: GrepMatch[] = [];

  for await (const rel of walkFiles(cwd, target, include)) {
    if (matches.length > maxResults) {
      break;
    }
    const absPath = path.join(cwd, rel);
    let content: string;
    try {
      const stat = await fs.promises.stat(absPath);
      if (stat.size > MAX_FILE_BYTES) {
        continue;
      }
      content = await fs.promises.readFile(absPath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (regex.test(line)) {
        let text = line;
        if (text.length > MAX_GREP_LINE_LENGTH) {
          text = `${text.substring(0, MAX_GREP_LINE_LENGTH)}…`;
        }
        matches.push({ path: rel, lineNum: i + 1, line: text });
        if (matches.length > maxResults) {
          break;
        }
      }
    }
  }

  const truncated = matches.length > maxResults;
  if (truncated) {
    matches.length = maxResults;
  }
  return { matches, truncated };
}

async function fsGlobSearch(opts: {
  cwd: string;
  pattern: string;
  searchPath: string | undefined;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const { cwd, pattern, searchPath, maxResults } = opts;
  const target = searchPath ? safePath(cwd, searchPath) : cwd;
  const files: string[] = [];

  for await (const rel of walkFiles(cwd, target, pattern)) {
    files.push(rel);
    if (files.length > maxResults) {
      break;
    }
  }

  const truncated = files.length > maxResults;
  if (truncated) {
    files.length = maxResults;
  }
  return { files, truncated };
}

// ── git grep / git ls-files (middle fallback tier) ──────────────────

const GREP_LINE_RE = /^(.+?):(\d+):(.*)$/;

function parseGrepOutput(
  stdout: string,
  maxResults: number,
  pathPrefix?: string
): { matches: GrepMatch[]; truncated: boolean } {
  const lines = stdout.split("\n").filter(Boolean);
  const matches: GrepMatch[] = [];

  for (const line of lines) {
    const m = line.match(GREP_LINE_RE);
    if (!(m?.[1] && m[2] && m[3] !== null && m[3] !== undefined)) {
      continue;
    }
    const lineNum = Number.parseInt(m[2], 10);
    let text: string = m[3];
    if (text.length > MAX_GREP_LINE_LENGTH) {
      text = `${text.substring(0, MAX_GREP_LINE_LENGTH)}…`;
    }
    const filePath = pathPrefix ? path.join(pathPrefix, m[1]) : m[1];
    matches.push({ path: filePath, lineNum, line: text });
    if (matches.length > maxResults) {
      break;
    }
  }

  const truncated = matches.length > maxResults;
  if (truncated) {
    matches.length = maxResults;
  }
  return { matches, truncated };
}

async function gitGrepSearch(opts: {
  cwd: string;
  pattern: string;
  target: string;
  include: string | undefined;
  maxResults: number;
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const { cwd, pattern, target, include, maxResults } = opts;
  const args = ["grep", "--untracked", "-n", "-E", pattern];
  if (include) {
    args.push("--", include);
  }

  const { stdout, exitCode } = await spawnCollect("git", args, target);

  if (exitCode === 1) {
    return { matches: [], truncated: false };
  }
  if (exitCode !== 0) {
    throw new Error(`git grep failed with exit code ${exitCode}`);
  }

  const prefix = path.relative(cwd, target);
  return parseGrepOutput(stdout, maxResults, prefix || undefined);
}

async function gitLsFiles(opts: {
  cwd: string;
  pattern: string;
  target: string;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const { cwd, pattern, target, maxResults } = opts;
  const args = [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    pattern,
  ];

  const { stdout, exitCode } = await spawnCollect("git", args, target);

  if (exitCode !== 0) {
    throw new Error(`git ls-files failed with exit code ${exitCode}`);
  }

  const lines = stdout.split("\n").filter(Boolean);
  const truncated = lines.length > maxResults;
  const files = lines
    .slice(0, maxResults)
    .map((f) => path.relative(cwd, path.resolve(target, f)));
  return { files, truncated };
}

// ── Dispatch: rg → git → Node.js ────────────────────────────────────

function isGitRepo(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, ".git")).isDirectory();
  } catch {
    return false;
  }
}

async function grepSearch(opts: {
  cwd: string;
  pattern: string;
  searchPath: string | undefined;
  include: string | undefined;
  maxResults: number;
}): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const target = opts.searchPath
    ? safePath(opts.cwd, opts.searchPath)
    : opts.cwd;
  const resolvedOpts = { ...opts, target };
  try {
    return await rgGrepSearch(resolvedOpts);
  } catch {
    if (isGitRepo(opts.cwd)) {
      try {
        return await gitGrepSearch(resolvedOpts);
      } catch {
        // fall through to fs
      }
    }
    return await fsGrepSearch(opts);
  }
}

async function globSearchImpl(opts: {
  cwd: string;
  pattern: string;
  searchPath: string | undefined;
  maxResults: number;
}): Promise<{ files: string[]; truncated: boolean }> {
  const target = opts.searchPath
    ? safePath(opts.cwd, opts.searchPath)
    : opts.cwd;
  const resolvedOpts = { ...opts, target };
  try {
    return await rgGlobSearch(resolvedOpts);
  } catch {
    if (isGitRepo(opts.cwd)) {
      try {
        return await gitLsFiles(resolvedOpts);
      } catch {
        // fall through to fs
      }
    }
    return await fsGlobSearch(opts);
  }
}

async function grep(payload: GrepPayload): Promise<LocalOpResult> {
  const { cwd, params } = payload;
  const maxResults = params.maxResultsPerSearch ?? MAX_GREP_RESULTS_PER_SEARCH;

  const results = await Promise.all(
    params.searches.map(async (search) => {
      const { matches, truncated } = await grepSearch({
        cwd,
        pattern: search.pattern,
        searchPath: search.path,
        include: search.include,
        maxResults,
      });
      return { pattern: search.pattern, matches, truncated };
    })
  );

  return { ok: true, data: { results } };
}

async function glob(payload: GlobPayload): Promise<LocalOpResult> {
  const { cwd, params } = payload;
  const maxResults = params.maxResults ?? MAX_GLOB_RESULTS;

  const results = await Promise.all(
    params.patterns.map(async (pattern) => {
      const { files, truncated } = await globSearchImpl({
        cwd,
        pattern,
        searchPath: params.path,
        maxResults,
      });
      return { pattern, files, truncated };
    })
  );

  return { ok: true, data: { results } };
}

// ── Sentry project + DSN ────────────────────────────────────────────

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
