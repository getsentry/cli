import type { ReadableStream } from "node:stream/web";
import fs from "node:fs";
import path from "node:path";
import { ApiError } from "../../errors.js";
import {
  MAX_FILE_BYTES,
  MAX_OUTPUT_BYTES,
} from "../constants.js";
import type { ToolPayload, ToolResult } from "../types.js";

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

/** Characters treated as command token separators. */
const WHITESPACE_CHAR_RE = /\s/u;

/**
 * Patterns that indicate shell injection. Commands run via `Bun.spawn`
 * without a shell, so these patterns are defense-in-depth for chaining,
 * piping, redirection, and command substitution.
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

/**
 * Executables that should never appear in a workflow-provided command.
 */
const BLOCKED_EXECUTABLES = new Set([
  "rm",
  "rmdir",
  "del",
  "curl",
  "wget",
  "nc",
  "ncat",
  "netcat",
  "socat",
  "telnet",
  "ftp",
  "sudo",
  "su",
  "doas",
  "chmod",
  "chown",
  "chgrp",
  "kill",
  "killall",
  "pkill",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "dd",
  "mkfs",
  "fdisk",
  "mount",
  "umount",
  "ssh",
  "scp",
  "sftp",
  "bash",
  "sh",
  "zsh",
  "fish",
  "csh",
  "dash",
  "eval",
  "exec",
  "env",
  "xargs",
]);

type CommandQuote = '"' | "'";

type TokenizeState = {
  tokens: string[];
  current: string;
  tokenStarted: boolean;
  quote?: CommandQuote;
};

export type ParsedCommand = {
  original: string;
  executable: string;
  args: string[];
};

type SpawnOutputStream =
  | NodeJS.ReadableStream
  | ReadableStream<Uint8Array>
  | null
  | undefined;

function jsonIndentArg(indent: JsonIndent): string {
  return indent.replacer.repeat(indent.length);
}

function isCommandWhitespace(char: string): boolean {
  return WHITESPACE_CHAR_RE.test(char);
}

function pushCurrentToken(state: TokenizeState): void {
  if (!state.tokenStarted) {
    return;
  }
  state.tokens.push(state.current);
  state.current = "";
  state.tokenStarted = false;
}

function appendEscapedUnquotedChar(
  state: TokenizeState,
  command: string,
  index: number
): number | undefined {
  const next = command[index + 1];
  if (
    next &&
    (isCommandWhitespace(next) || next === "'" || next === '"' || next === "\\")
  ) {
    state.current += next;
    state.tokenStarted = true;
    return index + 1;
  }
  return;
}

function handleUnquotedChar(
  state: TokenizeState,
  command: string,
  index: number
): number {
  const char = command[index];
  if (!char) {
    return index;
  }
  if (isCommandWhitespace(char)) {
    pushCurrentToken(state);
    return index;
  }
  if (char === "'" || char === '"') {
    state.quote = char;
    state.tokenStarted = true;
    return index;
  }
  if (char === "\\") {
    const escapedIndex = appendEscapedUnquotedChar(state, command, index);
    if (escapedIndex !== undefined) {
      return escapedIndex;
    }
  }
  state.current += char;
  state.tokenStarted = true;
  return index;
}

function handleSingleQuotedChar(state: TokenizeState, char: string): void {
  if (char === "'") {
    state.quote = undefined;
    return;
  }
  state.current += char;
}

function handleDoubleQuotedChar(
  state: TokenizeState,
  command: string,
  index: number
): number {
  const char = command[index];
  if (!char) {
    return index;
  }
  if (char === '"') {
    state.quote = undefined;
    return index;
  }
  if (char === "\\") {
    const next = command[index + 1];
    if (next && (next === '"' || next === "\\" || next === "$")) {
      state.current += next;
      return index + 1;
    }
  }
  state.current += char;
  return index;
}

/**
 * Resolve a path relative to cwd and verify it stays inside the project root.
 */
export function safePath(cwd: string, relative: string): string {
  const resolved = path.resolve(cwd, relative);
  const normalizedCwd = path.resolve(cwd);
  if (
    !resolved.startsWith(normalizedCwd + path.sep) &&
    resolved !== normalizedCwd
  ) {
    throw new Error(`Path "${relative}" resolves outside project directory`);
  }

  let realCwd: string;
  try {
    realCwd = fs.realpathSync(normalizedCwd);
  } catch {
    return resolved;
  }

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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(checkPath);
      if (parent === checkPath) {
        break;
      }
      checkPath = parent;
    }
  }

  return resolved;
}

/**
 * Reject tool executions whose requested cwd escapes the selected project root.
 */
export function validateToolSandbox(
  payload: Pick<ToolPayload, "cwd">,
  directory: string
): ToolResult | undefined {
  const normalizedCwd = path.resolve(payload.cwd);
  const normalizedDir = path.resolve(directory);
  if (
    normalizedCwd !== normalizedDir &&
    !normalizedCwd.startsWith(normalizedDir + path.sep)
  ) {
    return {
      ok: false,
      error: `Blocked: cwd "${payload.cwd}" is outside project directory "${directory}"`,
    };
  }
  return;
}

/**
 * Format thrown tool errors into user-facing strings.
 */
export function formatToolError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.format();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Pretty-print a JSON string using the detected indentation style.
 */
export function prettyPrintJson(content: string): string {
  try {
    return `${JSON.stringify(JSON.parse(content), null, jsonIndentArg(DEFAULT_JSON_INDENT))}\n`;
  } catch {
    return content;
  }
}

/**
 * Returns true if the file path looks like a .env file.
 */
export function isEnvFile(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? "";
  return name === ".env" || name.startsWith(".env.");
}

/**
 * Read a single file up to the configured byte limit.
 */
export async function readSingleFile(
  cwd: string,
  filePath: string,
  maxBytes = MAX_FILE_BYTES
): Promise<string | null> {
  try {
    const absPath = safePath(cwd, filePath);
    const stat = await fs.promises.stat(absPath);
    let content: string;
    if (stat.size > maxBytes) {
      const handle = await fs.promises.open(absPath, "r");
      try {
        const buffer = Buffer.alloc(maxBytes);
        await handle.read(buffer, 0, maxBytes, 0);
        content = buffer.toString("utf-8");
      } finally {
        await handle.close();
      }
    } else {
      content = await fs.promises.readFile(absPath, "utf-8");
    }
    return content;
  } catch {
    return null;
  }
}

/**
 * Tokenize a command string into an argv-compatible array without invoking a shell.
 */
export function tokenizeCommand(command: string): string[] {
  const state: TokenizeState = {
    tokens: [],
    current: "",
    tokenStarted: false,
  };

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (!char) {
      continue;
    }

    if (!state.quote) {
      i = handleUnquotedChar(state, command, i);
      continue;
    }

    if (state.quote === "'") {
      handleSingleQuotedChar(state, char);
      continue;
    }

    i = handleDoubleQuotedChar(state, command, i);
  }

  if (state.quote) {
    throw new Error(
      `Invalid command: unterminated ${state.quote === '"' ? "double" : "single"} quote — "${command}"`
    );
  }

  pushCurrentToken(state);
  return state.tokens;
}

/**
 * Parse a command string into an executable plus argv-style arguments.
 */
export function parseCommand(command: string): ParsedCommand {
  const [executable = "", ...args] = tokenizeCommand(command);
  return {
    original: command,
    executable,
    args,
  };
}

/**
 * Validate a command before execution.
 */
export function validateCommand(command: string): string | undefined {
  for (const { pattern, label } of SHELL_METACHARACTER_PATTERNS) {
    if (command.includes(pattern)) {
      return `Blocked command: contains ${label} — "${command}"`;
    }
  }

  let firstToken: string;
  try {
    [firstToken = ""] = tokenizeCommand(command);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  if (!firstToken) {
    return "Blocked command: empty command";
  }

  if (firstToken.includes("=")) {
    return `Blocked command: contains environment variable assignment — "${command}"`;
  }

  const executable = path.basename(firstToken);
  if (BLOCKED_EXECUTABLES.has(executable)) {
    return `Blocked command: disallowed executable "${executable}" — "${command}"`;
  }

  return;
}

async function readWebStream(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      if (totalBytes < MAX_OUTPUT_BYTES) {
        const buffer = Buffer.from(value);
        const remaining = MAX_OUTPUT_BYTES - totalBytes;
        chunks.push(buffer.subarray(0, remaining));
        totalBytes += Math.min(buffer.length, remaining);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString("utf-8");
}

async function readNodeStream(stream: NodeJS.ReadableStream): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    stream.on("data", (chunk: Buffer | string) => {
      if (totalBytes >= MAX_OUTPUT_BYTES) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_OUTPUT_BYTES - totalBytes;
      chunks.push(buffer.subarray(0, remaining));
      totalBytes += Math.min(buffer.length, remaining);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    stream.on("error", reject);
  });
}

/**
 * Drain a spawned stdout/stderr stream while enforcing output truncation.
 */
export async function readSpawnOutput(stream: SpawnOutputStream): Promise<string> {
  if (!stream) {
    return "";
  }
  if (typeof (stream as ReadableStream<Uint8Array>).getReader === "function") {
    return await readWebStream(stream as ReadableStream<Uint8Array>);
  }
  return await readNodeStream(stream as NodeJS.ReadableStream);
}

