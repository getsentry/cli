import path from "node:path";
import type { ReadableStream } from "node:stream/web";
import { MAX_OUTPUT_BYTES } from "../constants.js";

/** Characters treated as command token separators. */
const WHITESPACE_CHAR_RE = /\s/u;
const WINDOWS_EXECUTABLE_EXTENSION_RE = /\.(?:cmd|exe|bat|ps1)$/u;
const PATH_SEPARATOR_RE = /\\/g;
const PACKAGE_RUNNER_SUBCOMMANDS = new Set(["exec", "dlx"]);
const PACKAGE_RUNNER_VALUE_OPTIONS = new Set([
  "allow-build",
  "cache",
  "cafile",
  "call",
  "cert",
  "changed-files-ignore-pattern",
  "config",
  "dir",
  "filter",
  "filter-prod",
  "globalconfig",
  "https-proxy",
  "key",
  "lockfile-dir",
  "loglevel",
  "noproxy",
  "node-options",
  "package",
  "prefix",
  "proxy",
  "registry",
  "reporter",
  "resume-from",
  "script-shell",
  "shell",
  "store-dir",
  "test-pattern",
  "use-node-version",
  "userconfig",
  "virtual-store-dir",
  "workspace",
  "workspace-concurrency",
]);
const PACKAGE_RUNNER_VALUE_SHORT_OPTIONS = new Set(["-p", "-w", "-C", "-c"]);

/**
 * Patterns that indicate shell injection. Windows package-manager shims require
 * shell execution, so workflow commands must reject shell syntax before spawn.
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

const WINDOWS_SHELL_METACHARACTER_PATTERNS: Array<{
  pattern: string;
  label: string;
}> = [
    { pattern: "%", label: "Windows environment variable expansion (%)" },
    { pattern: "!", label: "Windows delayed environment expansion (!)" },
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
  "cd",
  "pushd",
  "popd",
  "cmd",
  "powershell",
  "pwsh",
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

type SpawnOutputStream =
  | NodeJS.ReadableStream
  | ReadableStream<Uint8Array>
  | null
  | undefined;

export type ParsedCommand = {
  original: string;
  executable: string;
  args: string[];
};

function normalizeExecutableName(executable: string): string {
  return path.posix
    .basename(executable.replace(PATH_SEPARATOR_RE, "/"))
    .toLowerCase()
    .replace(WINDOWS_EXECUTABLE_EXTENSION_RE, "");
}

function hasInitArgAfter(tokens: string[], index: number): boolean {
  return tokens.slice(index + 1).some((arg) => arg.toLowerCase() === "init");
}

function isSentryCliPackageSpec(token: string): boolean {
  const lower = token.toLowerCase();
  return lower === "@sentry/cli" || lower.startsWith("@sentry/cli@");
}

function isSentryWizardPackageSpec(token: string): boolean {
  const lower = token.toLowerCase();
  return lower === "@sentry/wizard" || lower.startsWith("@sentry/wizard@");
}

function isExecutablePackageSpec(executable: string, name: string): boolean {
  return executable === name || executable.startsWith(`${name}@`);
}

function isPackageRunnerSubcommand(token: string): boolean {
  return PACKAGE_RUNNER_SUBCOMMANDS.has(normalizeExecutableName(token));
}

function getLongPackageRunnerOptionName(token: string): string | undefined {
  if (!token.startsWith("--") || token === "--" || token.startsWith("--no-")) {
    return;
  }

  const [name = ""] = token.slice(2).split("=", 1);
  return name.toLowerCase();
}

function packageRunnerPackageOptionConsumesValue(token: string): boolean {
  return token === "-p" || token === "--package";
}

function packageRunnerOptionConsumesValue(
  token: string,
  nextToken: string | undefined
): boolean {
  if (!nextToken || nextToken === "--") {
    return false;
  }
  if (token.startsWith("--") && token.includes("=")) {
    return false;
  }
  if (packageRunnerPackageOptionConsumesValue(token)) {
    return true;
  }
  if (
    PACKAGE_RUNNER_VALUE_SHORT_OPTIONS.has(token) ||
    PACKAGE_RUNNER_VALUE_OPTIONS.has(getLongPackageRunnerOptionName(token) ?? "")
  ) {
    return !nextToken.startsWith("-") && !isPackageRunnerSubcommand(nextToken);
  }
  return false;
}

function getInlinePackageRunnerPackageOptionValue(
  token: string
): string | undefined {
  if (token.startsWith("-p=")) {
    return token.slice("-p=".length);
  }
  if (token.startsWith("--package=")) {
    return token.slice("--package=".length);
  }
  return;
}

function isInlinePackageRunnerOption(token: string): boolean {
  if (token.startsWith("--")) {
    return token.includes("=");
  }
  return PACKAGE_RUNNER_VALUE_SHORT_OPTIONS.has(token.slice(0, 2))
    ? token.startsWith(`${token.slice(0, 2)}=`)
    : false;
}

function findPackageRunnerCommandIndex(
  tokens: string[],
  startIndex: number
): number | undefined {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token === "--") {
      return index + 1 < tokens.length ? index + 1 : undefined;
    }
    if (packageRunnerOptionConsumesValue(token, tokens[index + 1])) {
      index += 1;
      continue;
    }
    if (isInlinePackageRunnerOption(token)) {
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    return index;
  }

  return;
}

function findPackageRunnerPackageOptionValues(
  tokens: string[],
  startIndex: number,
  endIndex = tokens.length
): Array<{ token: string; index: number }> {
  const values: Array<{ token: string; index: number }> = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token === "--") {
      break;
    }
    if (packageRunnerPackageOptionConsumesValue(token)) {
      const value = tokens[index + 1];
      if (value) {
        values.push({ token: value, index: index + 1 });
      }
      index += 1;
      continue;
    }

    const inlineValue = getInlinePackageRunnerPackageOptionValue(token);
    if (inlineValue) {
      values.push({ token: inlineValue, index });
    }
  }

  return values;
}

function findPackageExecutionTokenIndex(tokens: string[]): number | undefined {
  const firstExecutable = normalizeExecutableName(tokens[0] ?? "");
  if (
    isExecutablePackageSpec(firstExecutable, "npx") ||
    isExecutablePackageSpec(firstExecutable, "bunx")
  ) {
    return findPackageRunnerCommandIndex(tokens, 1);
  }

  const subcommandIndex = findPackageRunnerCommandIndex(tokens, 1);
  if (subcommandIndex === undefined) {
    return;
  }

  const subcommand = normalizeExecutableName(tokens[subcommandIndex] ?? "");
  if (!PACKAGE_RUNNER_SUBCOMMANDS.has(subcommand)) {
    return;
  }

  return findPackageRunnerCommandIndex(tokens, subcommandIndex + 1);
}

function findPackageExecutionPackageOptionValues(
  tokens: string[]
): Array<{ token: string; index: number }> {
  const firstExecutable = normalizeExecutableName(tokens[0] ?? "");
  if (
    isExecutablePackageSpec(firstExecutable, "npx") ||
    isExecutablePackageSpec(firstExecutable, "bunx")
  ) {
    const commandIndex = findPackageRunnerCommandIndex(tokens, 1);
    return findPackageRunnerPackageOptionValues(
      tokens,
      1,
      commandIndex ?? tokens.length
    );
  }

  const subcommandIndex = findPackageRunnerCommandIndex(tokens, 1);
  if (subcommandIndex === undefined) {
    return [];
  }

  const subcommand = normalizeExecutableName(tokens[subcommandIndex] ?? "");
  if (!PACKAGE_RUNNER_SUBCOMMANDS.has(subcommand)) {
    return [];
  }

  const commandIndex = findPackageRunnerCommandIndex(
    tokens,
    subcommandIndex + 1
  );

  return [
    ...findPackageRunnerPackageOptionValues(tokens, 1, subcommandIndex),
    ...findPackageRunnerPackageOptionValues(
      tokens,
      subcommandIndex + 1,
      commandIndex ?? tokens.length
    ),
  ];
}

function canExecuteToken(tokens: string[], index: number): boolean {
  return index === 0 || index === findPackageExecutionTokenIndex(tokens);
}

function isRecursiveSentrySetupToken(
  token: string,
  tokens: string[],
  index: number
): boolean {
  const executable = normalizeExecutableName(token);
  if (
    isSentryWizardPackageSpec(token) ||
    isExecutablePackageSpec(executable, "sentry-wizard")
  ) {
    return true;
  }
  if (isSentryCliPackageSpec(token)) {
    return hasInitArgAfter(tokens, index);
  }
  if (
    !(
      isExecutablePackageSpec(executable, "sentry") ||
      isExecutablePackageSpec(executable, "sentry-cli")
    )
  ) {
    return false;
  }
  return hasInitArgAfter(tokens, index);
}

function isRecursiveSentrySetup(tokens: string[]): boolean {
  const packageOptionInvokesSentry = findPackageExecutionPackageOptionValues(
    tokens
  ).some(({ token, index }) =>
    isRecursiveSentrySetupToken(token, tokens, index)
  );
  if (packageOptionInvokesSentry) {
    return true;
  }

  return tokens.some((token, index) => {
    if (!canExecuteToken(tokens, index)) {
      return false;
    }

    return isRecursiveSentrySetupToken(token, tokens, index);
  });
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

  if (process.platform === "win32") {
    for (const { pattern, label } of WINDOWS_SHELL_METACHARACTER_PATTERNS) {
      if (command.includes(pattern)) {
        return `Blocked command: contains ${label} — "${command}"`;
      }
    }
  }

  let tokens: string[];
  try {
    tokens = tokenizeCommand(command);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  const [firstToken = ""] = tokens;
  if (!firstToken) {
    return "Blocked command: empty command";
  }

  if (firstToken.includes("=")) {
    return `Blocked command: contains environment variable assignment — "${command}"`;
  }

  if (isRecursiveSentrySetup(tokens)) {
    return `Blocked command: invokes Sentry setup recursively — "${command}"`;
  }

  const executable = normalizeExecutableName(firstToken);
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
      if (!value || totalBytes >= MAX_OUTPUT_BYTES) {
        continue;
      }

      const buffer = Buffer.from(value);
      const remaining = MAX_OUTPUT_BYTES - totalBytes;
      chunks.push(buffer.subarray(0, remaining));
      totalBytes += Math.min(buffer.length, remaining);
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
export async function readSpawnOutput(
  stream: SpawnOutputStream
): Promise<string> {
  if (!stream) {
    return "";
  }

  if (typeof (stream as ReadableStream<Uint8Array>).getReader === "function") {
    return await readWebStream(stream as ReadableStream<Uint8Array>);
  }

  return await readNodeStream(stream as NodeJS.ReadableStream);
}
