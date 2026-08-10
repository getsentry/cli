import { isatty } from "node:tty";
import { getCurrentAuthScopes } from "./api/auth.js";
import { assertAutoLoginHostTrusted } from "./auto-auth.js";
import { type AuthSource, getAuthConfig } from "./db/auth.js";
import { ApiError, AuthError } from "./errors.js";
import type { LoginResult } from "./interactive-login.js";
import { interactivePromptsAllowed } from "./interactive-prompts.js";
import { OAUTH_SCOPES } from "./oauth.js";

type InteractiveLogin = () => Promise<LoginResult | null>;

type OAuthScopeState =
  | { kind: "current" }
  | { kind: "invalid" }
  | { kind: "missing"; scopes: string[] };

export type ScopeRecoveryRuntime = {
  assertTrustedHost: () => void;
  getAuthScopes: () => Promise<readonly string[] | null>;
  getAuthSource: () => AuthSource | undefined;
  inputIsTty: () => boolean;
  promptsAllowed: () => boolean;
  write: (message: string) => void;
};

const defaultRuntime: ScopeRecoveryRuntime = {
  assertTrustedHost: assertAutoLoginHostTrusted,
  getAuthScopes: getCurrentAuthScopes,
  getAuthSource: () => getAuthConfig()?.source,
  inputIsTty: () => isatty(0),
  promptsAllowed: interactivePromptsAllowed,
  write: (message) => process.stderr.write(message),
};

function disablesInteractiveRecovery(argv: string[]): boolean {
  return argv.some(
    (arg) =>
      arg === "--yes" ||
      arg === "-y" ||
      arg.startsWith("--yes=") ||
      arg === "--dry-run" ||
      arg.startsWith("--dry-run=")
  );
}

async function inspectOAuthScopes(
  runtime: ScopeRecoveryRuntime,
  startedWithOAuth = false
): Promise<OAuthScopeState | undefined> {
  try {
    const source = runtime.getAuthSource();
    if (source !== "oauth") {
      if (startedWithOAuth) {
        return { kind: "invalid" };
      }
      return;
    }
    const granted = await runtime.getAuthScopes();
    if (!granted) {
      return { kind: "invalid" };
    }
    const grantedSet = new Set(granted);
    const missing = OAUTH_SCOPES.filter((scope) => !grantedSet.has(scope));
    return missing.length > 0
      ? { kind: "missing", scopes: missing }
      : { kind: "current" };
  } catch (error) {
    if (
      (error instanceof ApiError && error.status === 401) ||
      (error instanceof AuthError &&
        (error.reason === "expired" || error.reason === "not_authenticated"))
    ) {
      return { kind: "invalid" };
    }
    return;
  }
}

/** Whether the active stored OAuth token is invalid or lacks a current CLI scope. */
export async function currentOAuthGrantNeedsRefresh(
  runtime: ScopeRecoveryRuntime = defaultRuntime
): Promise<boolean> {
  const state = await inspectOAuthScopes(runtime);
  return Boolean(state && state.kind !== "current");
}

async function refreshOAuthScopes(
  state: Exclude<OAuthScopeState, { kind: "current" }>,
  runInteractiveLogin: InteractiveLogin,
  runtime: ScopeRecoveryRuntime
): Promise<boolean> {
  if (!(runtime.inputIsTty() && runtime.promptsAllowed())) {
    return false;
  }

  runtime.assertTrustedHost();
  if (state.kind === "missing") {
    runtime.write(
      `Your CLI authorization is missing ${state.scopes.join(", ")}. Starting authorization...\n\n`
    );
  } else {
    runtime.write(
      "Your CLI authorization is no longer valid. Starting authorization...\n\n"
    );
  }
  return Boolean(await runInteractiveLogin());
}

/** Refresh a stored OAuth grant when it lacks any scope requested by this CLI. */
export async function ensureCurrentOAuthScopes(
  runInteractiveLogin: InteractiveLogin,
  runtime: ScopeRecoveryRuntime = defaultRuntime
): Promise<boolean> {
  const state = await inspectOAuthScopes(runtime);
  if (!state || state.kind === "current") {
    return false;
  }
  return await refreshOAuthScopes(state, runInteractiveLogin, runtime);
}

/** Check an OAuth token after a 401/403, re-authorize if needed, and retry once. */
export async function runWithScopeRecovery(
  proceed: (commandArgs: string[]) => Promise<void>,
  argv: string[],
  runInteractiveLogin: InteractiveLogin,
  runtime: ScopeRecoveryRuntime = defaultRuntime
): Promise<void> {
  let startedWithOAuth = false;
  try {
    startedWithOAuth = runtime.getAuthSource() === "oauth";
  } catch {
    // The original command remains authoritative if the credential store fails.
  }
  try {
    await proceed(argv);
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      (error.status !== 401 && error.status !== 403)
    ) {
      throw error;
    }

    const state = await inspectOAuthScopes(runtime, startedWithOAuth);
    if (
      !state ||
      state.kind === "current" ||
      disablesInteractiveRecovery(argv) ||
      !(await refreshOAuthScopes(state, runInteractiveLogin, runtime))
    ) {
      throw error;
    }

    runtime.write("\nRetrying command...\n\n");
    await proceed(argv);
  }
}
