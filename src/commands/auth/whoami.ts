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
import { formatUserIdentity, writeJson } from "../../lib/formatters/index.js";

type WhoamiFlags = {
  readonly json: boolean;
};

export const whoamiCommand = buildCommand({
  docs: {
    brief: "Show the currently authenticated user",
    fullDescription:
      "Fetch and display the identity of the currently authenticated user.\n\n" +
      "This calls the Sentry API live (not cached) so the result always reflects " +
      "the current token. Works with all token types: OAuth, API tokens, and OAuth App tokens.",
  },
  parameters: {
    flags: {
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: SentryContext, flags: WhoamiFlags): Promise<void> {
    const { stdout } = this;

    if (!(await isAuthenticated())) {
      throw new AuthError("not_authenticated");
    }

    const user = await getCurrentUser();

    // Keep cached user info up to date. Non-fatal: display must succeed even
    // if the DB write fails (read-only filesystem, corrupted database, etc.).
    try {
      setUserInfo({
        userId: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
      });
    } catch {
      // Cache update failure is non-essential — user identity was already fetched.
    }

    if (flags.json) {
      writeJson(stdout, {
        id: user.id,
        name: user.name ?? null,
        username: user.username ?? null,
        email: user.email ?? null,
      });
      return;
    }

    stdout.write(`${formatUserIdentity(user)}\n`);
  },
});
