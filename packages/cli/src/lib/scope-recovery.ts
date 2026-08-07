/**
 * One-time recovery for stored OAuth grants that predate the CLI's current
 * standard scope set.
 */

import { isatty } from "node:tty";
import { extractRequiredScopes } from "./api-scope.js";
import { assertAutoLoginHostTrusted } from "./auto-auth.js";
import { type AuthSource, getAuthConfig } from "./db/auth.js";
import { ApiError } from "./errors.js";
import type {
  InteractiveLoginOptions,
  LoginResult,
} from "./interactive-login.js";
import { interactivePromptsAllowed } from "./interactive-prompts.js";
import { logger } from "./logger.js";
import { OAUTH_SCOPES, resolveOAuthScopeString } from "./oauth.js";

type InteractiveLogin = (
  options?: InteractiveLoginOptions
) => Promise<LoginResult | null>;

export type ScopeRecoveryRuntime = {
  assertTrustedHost: () => void;
  confirm: (message: string) => Promise<unknown>;
  getAuthSource: () => AuthSource | undefined;
  inputIsTty: () => boolean;
  promptsAllowed: () => boolean;
  write: (message: string) => void;
};

const defaultRuntime: ScopeRecoveryRuntime = {
  assertTrustedHost: assertAutoLoginHostTrusted,
  confirm: (message) =>
    logger.withTag("auth").prompt(message, {
      type: "confirm",
      initial: true,
    }),
  getAuthSource: () => getAuthConfig()?.source,
  inputIsTty: () => isatty(0),
  promptsAllowed: interactivePromptsAllowed,
  write: (message) => {
    process.stderr.write(message);
  },
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

function recoverableScopes(
  error: unknown,
  argv: string[],
  runtime: ScopeRecoveryRuntime
): string[] | null {
  let authSource: AuthSource | undefined;
  try {
    authSource = runtime.getAuthSource();
  } catch {
    // Recovery must never replace the command's original 403 with a local
    // credential-store read failure.
    return null;
  }

  if (
    !(runtime.inputIsTty() && runtime.promptsAllowed()) ||
    disablesInteractiveRecovery(argv) ||
    authSource !== "oauth" ||
    !(error instanceof ApiError) ||
    error.status !== 403
  ) {
    return null;
  }

  const scopes = extractRequiredScopes(error.detail);
  return scopes.length > 0 ? scopes : null;
}

/**
 * Run a command once and, for an old interactive OAuth grant, refresh it with
 * the current standard scopes before retrying the command exactly once.
 */
export async function runWithScopeRecovery(
  proceed: (commandArgs: string[]) => Promise<void>,
  argv: string[],
  runInteractiveLogin: InteractiveLogin,
  runtime: ScopeRecoveryRuntime = defaultRuntime
): Promise<void> {
  try {
    await proceed(argv);
  } catch (error) {
    const scopes = recoverableScopes(error, argv, runtime);
    if (!scopes) {
      throw error;
    }

    runtime.assertTrustedHost();
    const scopeList = scopes.map((scopeName) => `'${scopeName}'`).join(", ");
    const confirmed = await runtime.confirm(
      `Your existing CLI authorization is missing standard scope(s) ${scopeList}. Refresh it with the current defaults?`
    );
    if (confirmed !== true) {
      throw error;
    }

    runtime.write("\n");
    const merged = [...new Set([...OAUTH_SCOPES, ...scopes])];
    const requestedScope = resolveOAuthScopeString({ scopes: merged });
    const loginResult = await runInteractiveLogin({ scope: requestedScope });
    if (!loginResult) {
      throw error;
    }

    runtime.write("\nRetrying command...\n\n");
    await proceed(argv);
  }
}
