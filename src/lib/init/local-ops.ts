/**
 * Local Operations Dispatcher
 *
 * Handles filesystem and shell operations requested by the remote workflow.
 * All operations are sandboxed to the workflow's cwd directory.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_FILE_BYTES,
  MAX_STDOUT_BYTES,
} from "./constants.js";
import type {
  ApplyPatchsetPayload,
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
 */
const SHELL_METACHARACTER_PATTERNS: Array<{ pattern: string; label: string }> = [
  { pattern: ";", label: "command chaining (;)" },
  // Check multi-char operators before single `|` so labels are accurate
  { pattern: "&&", label: "command chaining (&&)" },
  { pattern: "||", label: "command chaining (||)" },
  { pattern: "|", label: "piping (|)" },
  { pattern: "`", label: "command substitution (`)" },
  { pattern: "$(", label: "command substitution ($()" },
  { pattern: "\n", label: "newline" },
  { pattern: "\r", label: "carriage return" },
];

/**
 * Executables that should never appear in a package install command.
 */
const BLOCKED_EXECUTABLES = new Set([
  // Destructive
  "rm", "rmdir", "del",
  // Network/exfil
  "curl", "wget", "nc", "ncat", "netcat", "socat", "telnet", "ftp",
  // Privilege escalation
  "sudo", "su", "doas",
  // Permissions
  "chmod", "chown", "chgrp",
  // Process/system
  "kill", "killall", "pkill", "shutdown", "reboot", "halt", "poweroff",
  // Disk
  "dd", "mkfs", "fdisk", "mount", "umount",
  // Remote access
  "ssh", "scp", "sftp",
  // Shells
  "bash", "sh", "zsh", "fish", "csh", "dash",
  // Misc dangerous
  "eval", "exec", "env", "xargs",
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

  // Layer 2: Block dangerous executables
  const firstToken = command.trimStart().split(/\s+/)[0];
  if (!firstToken) {
    return `Blocked command: empty command`;
  }
  const executable = path.basename(firstToken);
  if (BLOCKED_EXECUTABLES.has(executable)) {
    return `Blocked command: disallowed executable "${executable}" — "${command}"`;
  }

  return undefined;
}

/**
 * Resolve a path relative to cwd and verify it's inside cwd.
 * Rejects path traversal attempts.
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
  return resolved;
}

export async function handleLocalOp(
  payload: LocalOpPayload,
  options: WizardOptions
): Promise<LocalOpResult> {
  try {
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

  const entries: Array<{
    name: string;
    path: string;
    type: "file" | "directory";
  }> = [];

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
        fs.readSync(fd, buffer, 0, maxBytes, 0);
        fs.closeSync(fd);
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

    const validationError = validateCommand(command);
    if (validationError) {
      return { ok: false, error: validationError };
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
    const child = spawn("sh", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutLen < MAX_STDOUT_BYTES) {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrLen < MAX_STDOUT_BYTES) {
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
        .slice(0, MAX_STDOUT_BYTES);
      const stderr = Buffer.concat(stderrChunks)
        .toString("utf-8")
        .slice(0, MAX_STDOUT_BYTES);
      resolve({ command, exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function applyPatchsetDryRun(payload: ApplyPatchsetPayload): LocalOpResult {
  const { cwd, params } = payload;
  const applied: Array<{ path: string; action: string }> = [];

  for (const patch of params.patches) {
    safePath(cwd, patch.path);
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
        break;
    }
  }

  return { ok: true, data: { applied } };
}
