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
import { isAuthenticated } from "../../lib/db/auth.js";
import { setUserInfo } from "../../lib/db/user.js";
import { AuthError } from "../../lib/errors.js";
import { formatUserIdentity } from "../../lib/formatters/index.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";

type WhoamiFlags = {
  readonly json: boolean;
  readonly fresh: boolean;
  readonly fields?: string[];
};

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

    if (!(await isAuthenticated())) {
      throw new AuthError("not_authenticated");
    }

    const user = await getCurrentUser();

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
