/**
 * Bare `sentry auth` dispatcher.
 *
 * Routes to login when logged out (or when login-only flags are present),
 * and to status when already authenticated.
 */

import type { SentryContext } from "../../context.js";
import {
  buildCommand,
  FIELDS_FLAG,
  JSON_FLAG,
  numberParser,
} from "../../lib/command.js";
import { isAuthenticated } from "../../lib/db/auth.js";
import { FRESH_ALIASES, FRESH_FLAG } from "../../lib/list-command.js";
import { loginCommand, parseLoginUrl } from "./login.js";
import { statusCommand } from "./status.js";

type AuthDefaultFlags = {
  readonly token?: string;
  readonly timeout: number;
  readonly force: boolean;
  readonly url?: string;
  readonly "read-only": boolean;
  readonly scope?: readonly string[];
  readonly "show-token": boolean;
  readonly fresh: boolean;
  readonly json?: boolean;
  readonly fields?: string[];
};

/** Login-only flags that force the bare command into the login path. */
const LOGIN_ONLY_FLAGS = [
  "token",
  "force",
  "url",
  "read-only",
  "scope",
] as const;

/**
 * Choose login vs status for bare `sentry auth`.
 *
 * - Login-only flags always select login (even when already authenticated).
 * - Otherwise: logged out → login, logged in → status.
 */
export function resolveAuthDefaultTarget(
  flags: Readonly<Partial<AuthDefaultFlags>>,
  authenticated = isAuthenticated()
): "login" | "status" {
  for (const name of LOGIN_ONLY_FLAGS) {
    const value = flags[name];
    if (value === undefined || value === false) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    return "login";
  }
  return authenticated ? "status" : "login";
}

async function invokeCommand(
  command: typeof loginCommand | typeof statusCommand,
  context: SentryContext,
  flags: Record<string, unknown>
): Promise<void> {
  const loaded = await command.loader();
  const func = typeof loaded === "function" ? loaded : loaded.default;
  await func.call(context, flags);
}

/**
 * Hidden default for bare `sentry auth`.
 *
 * Accepts the union of login and status flags so either path works without
 * an explicit subcommand. Rendering is delegated to the selected command.
 */
export const authDefaultCommand = buildCommand({
  auth: false,
  skipRcUrlCheck: true,
  docs: {
    brief: "Authenticate with Sentry or show auth status",
    fullDescription:
      "When not authenticated, starts the login flow. When already authenticated, shows auth status. " +
      "Equivalent to `sentry auth login` or `sentry auth status` depending on current credentials. " +
      "Login-only flags (e.g. --token, --url) force the login path.",
  },
  parameters: {
    flags: {
      token: {
        kind: "parsed",
        parse: String,
        brief: "Authenticate using an API token instead of OAuth",
        optional: true,
      },
      timeout: {
        kind: "parsed",
        parse: numberParser,
        brief: "Timeout for OAuth flow in seconds (default: 900)",
        default: "900",
      },
      force: {
        kind: "boolean",
        brief: "Re-authenticate without prompting",
        default: false,
      },
      url: {
        kind: "parsed",
        parse: parseLoginUrl,
        brief:
          "Sentry instance URL to authenticate against (e.g. https://sentry.example.com). " +
          "Required for self-hosted; defaults to SaaS (https://sentry.io).",
        optional: true,
      },
      "read-only": {
        kind: "boolean",
        brief:
          "Request only read-only OAuth scopes (project:read, org:read, event:read, member:read, team:read). " +
          "Useful for handing tokens to AI agents or CI jobs that should not be able to mutate Sentry state.",
        default: false,
      },
      scope: {
        kind: "parsed",
        parse: String,
        brief:
          "Request specific OAuth scopes (repeatable, comma-separated). " +
          "E.g. --scope project:read --scope org:read. Overrides the default scope set.",
        variadic: true,
        optional: true,
      },
      "show-token": {
        kind: "boolean",
        brief: "Show the stored token (masked by default)",
        default: false,
      },
      fresh: FRESH_FLAG,
      // Declared explicitly because this dispatcher has no output config of
      // its own — login/status own rendering, but bare `sentry auth --json`
      // still needs to parse these flags.
      json: JSON_FLAG,
      fields: FIELDS_FLAG,
    },
    aliases: { s: "scope", ...FRESH_ALIASES },
  },
  // No output config: the selected login/status command owns rendering.
  // biome-ignore lint/correctness/useYield: dispatcher awaits nested command handlers
  async *func(this: SentryContext, flags: AuthDefaultFlags) {
    const target = resolveAuthDefaultTarget(flags);
    const command = target === "login" ? loginCommand : statusCommand;
    await invokeCommand(
      command,
      this,
      flags as unknown as Record<string, unknown>
    );
  },
});
