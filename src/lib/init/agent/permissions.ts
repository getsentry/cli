/**
 * Permission gate for the local init agent (the SDK `canUseTool` callback).
 *
 * Mirrors PostHog's wizard guardrails: block direct reads/writes of `.env`
 * files (Sentry auth tokens and real secrets must stay out of the agent
 * context) and restrict Bash to a safe allowlist of package-manager, build,
 * lint, typecheck, and test commands. Everything else - the built-in
 * Read/Write/Edit/Glob/Grep tools and the in-process Sentry MCP tools - is
 * allowed.
 */

export type PermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

const ENV_FILE_RE = /(^|[/\\])\.env(?:\.|$)/;
const DANGEROUS_BASH_RE =
  /(?:^|\s)(?:rm\s+-rf|git\s+reset|git\s+checkout|sudo|chmod\s+-R|chown\s+-R)(?:\s|$)/i;
const SAFE_REDIRECT_RE = /\s+2>\/dev\/null\s*$/u;
const SHELL_OPERATOR_RE = /[;&`$()]/;

const SAFE_BASH_PREFIXES = [
  "npm install",
  "npm i",
  "npm run",
  "npm test",
  "npm exec",
  "npx ",
  "pnpm install",
  "pnpm add",
  "pnpm run",
  "pnpm test",
  "pnpm exec",
  "pnpm dlx",
  "yarn install",
  "yarn add",
  "yarn run",
  "yarn test",
  "bun install",
  "bun add",
  "bun run",
  "bun test",
  "pip install",
  "pip3 install",
  "python -m pip install",
  "poetry add",
  "poetry install",
  "uv add",
  "uv pip install",
  "bundle install",
  "bundle add",
  "cargo add",
  "cargo build",
  "cargo test",
  "go get",
  "go mod tidy",
  "go test",
  "dotnet add",
  "dotnet restore",
  "dotnet build",
  "dotnet test",
];

const RECURSIVE_WIZARD_RE = /(@sentry\/wizard|sentry-wizard|sentry\s+init)\b/i;

function allow(input: Record<string, unknown>): PermissionResult {
  return { behavior: "allow", updatedInput: input };
}

function deny(message: string): PermissionResult {
  return { behavior: "deny", message };
}

function isEnvPath(value: unknown): boolean {
  return typeof value === "string" && ENV_FILE_RE.test(value);
}

function inputPath(input: Record<string, unknown>): string | undefined {
  const value = input.file_path ?? input.path;
  return typeof value === "string" ? value : undefined;
}

function commandWithoutSafeRedirection(command: string): string {
  return command.replace(SAFE_REDIRECT_RE, "").trim();
}

function isAllowedBash(command: string): boolean {
  const normalized = commandWithoutSafeRedirection(command);
  if (!normalized) {
    return false;
  }
  if (
    DANGEROUS_BASH_RE.test(normalized) ||
    SHELL_OPERATOR_RE.test(normalized)
  ) {
    return false;
  }
  return SAFE_BASH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function canUseInitAgentTool(
  toolName: string,
  input: Record<string, unknown>
): PermissionResult {
  if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
    if (isEnvPath(inputPath(input))) {
      return deny(
        "Do not directly read or write .env files. Sentry auth tokens and real secrets must stay out of the agent context. Reference env vars by name instead."
      );
    }
    return allow(input);
  }

  if (toolName === "Grep") {
    if (
      isEnvPath(input.path) ||
      isEnvPath(input.glob) ||
      isEnvPath(input.include)
    ) {
      return deny("Do not grep .env files.");
    }
    return allow(input);
  }

  if (toolName === "Bash") {
    const command = String(input.command ?? "");
    if (RECURSIVE_WIZARD_RE.test(command)) {
      return deny(
        "Do not run the Sentry wizard or `sentry init` recursively. Install the SDK package directly with the project's package manager."
      );
    }
    if (!isAllowedBash(command)) {
      return deny(
        "Only safe package-manager, build, lint, typecheck, and test commands are allowed during sentry init."
      );
    }
    return allow(input);
  }

  return allow(input);
}
