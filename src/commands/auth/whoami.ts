/**
 * sentry auth whoami
 *
 * Display the currently authenticated user's identity by fetching live from
 * the /auth/ endpoint. Unlike `sentry auth status`, this command only shows
 * who you are — no token details, no defaults, no org verification.
 */

import type { SentryContext } from "../../context.js";
import { getCurrentUser } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { getAuthToken } from "../../lib/db/auth.js";
import { setUserInfo } from "../../lib/db/user.js";
import { ApiError, AuthError, CliError } from "../../lib/errors.js";
import { formatUserIdentity } from "../../lib/formatters/index.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { classifySentryToken } from "../../lib/token-type.js";

type WhoamiFlags = {
  readonly json: boolean;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/**
 * Translate an `ApiError` from `/auth/` into something actionable.
 *
 * The Sentry backend historically returned `400 Bad Request` (not 401/403)
 * from `GET /api/0/auth/` for valid Bearer tokens because
 * `AuthIndexEndpoint` excluded `UserAuthTokenAuthentication` from its
 * authenticators — tokens were silently ignored and the handler returned
 * 400 with an empty body. Fixed server-side by getsentry/sentry#112853,
 * but CLIs in the wild must still degrade gracefully while the fix rolls
 * out across SaaS tiers and self-hosted.
 *
 * We translate 400 into an `AuthError("invalid")` with `skipAutoAuth: true`
 * — a silent token refresh wouldn't help (the token is valid, the endpoint
 * is refusing to parse it), and triggering auto-login on the whoami
 * command itself would loop. Non-400 errors rethrow unchanged so existing
 * 401/403/5xx handling applies.
 */
function translateWhoamiApiError(error: unknown): never {
  if (error instanceof ApiError && error.status === 400) {
    throw new AuthError(
      "invalid",
      [
        "Sentry returned 400 Bad Request for whoami.",
        "",
        "This usually means the auth endpoint temporarily rejected the token.",
        "A known server-side fix is rolling out (getsentry/sentry#112853).",
        "",
        "Try:",
        "  sentry auth status   — verify your token via a different endpoint",
        "  sentry auth login    — refresh or re-authenticate",
      ].join("\n"),
      { skipAutoAuth: true }
    );
  }
  throw error;
}

export const whoamiCommand = buildCommand({
  docs: {
    brief: "Show the currently authenticated user",
    fullDescription:
      "Fetch and display the identity of the currently authenticated user.\n\n" +
      "This calls the Sentry API live (not cached) so the result always reflects " +
      "the current token. Works with all token types: OAuth, API tokens, and OAuth App tokens.",
  },
  output: {
    human: formatUserIdentity,
  },
  parameters: {
    flags: {
      fresh: FRESH_FLAG,
    },
    aliases: FRESH_ALIASES,
  },
  async *func(this: SentryContext, flags: WhoamiFlags) {
    applyFreshFlag(flags);

    // Org auth tokens (`sntrys_...`) are not user-scoped — there is no
    // single user to return for them. The backend `/auth/` endpoint also
    // rejects this prefix (`UserAuthTokenAuthentication.accepts_auth`
    // excludes it, and `OrgAuthTokenAuthentication` is not wired up to
    // this endpoint). Short-circuit with a clear message instead of
    // letting the request fail with a confusing 400.
    const token = getAuthToken();
    if (token && classifySentryToken(token) === "org-auth-token") {
      throw new CliError(
        [
          "Organization auth tokens (sntrys_...) are not tied to a user.",
          "",
          "The `whoami` command only works with user-scoped credentials",
          "(OAuth tokens from `sentry auth login` or personal access tokens).",
          "",
          "Try:",
          "  sentry auth status   — show which token is active and its scope",
          "  sentry org list      — list organizations this token can access",
        ].join("\n")
      );
    }

    let user: Awaited<ReturnType<typeof getCurrentUser>>;
    try {
      user = await getCurrentUser();
    } catch (error) {
      translateWhoamiApiError(error);
    }

    // Keep cached user info up to date. Non-fatal: display must succeed even
    // if the DB write fails (read-only filesystem, corrupted database, etc.).
    try {
      setUserInfo({
        userId: user.id,
        email: user.email ?? undefined,
        username: user.username ?? undefined,
        name: user.name ?? undefined,
      });
    } catch {
      // Cache update failure is non-essential — user identity was already fetched.
    }

    return yield new CommandOutput(user);
  },
});
