/**
 * sentry auth token
 *
 * Print the stored authentication token (unmasked).
 * Useful for piping to other commands or scripts.
 */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { getAuthToken } from "../../lib/db/auth.js";
import { AuthError } from "../../lib/errors.js";

export const tokenCommand = buildCommand({
  docs: {
    brief: "Print the stored authentication token",
    fullDescription:
      "Print the stored authentication token to stdout.\n\n" +
      "This outputs the raw token without any formatting, making it suitable for " +
      "piping to other commands or scripts. The token is printed without a trailing newline " +
      "when stdout is not a TTY (e.g., when piped).",
  },
  parameters: {},
  func(this: SentryContext): void {
    const { stdout } = this;

    const token = getAuthToken();
    if (!token) {
      throw new AuthError("not_authenticated");
    }

    // Add newline only if stdout is a TTY (interactive terminal)
    // When piped, omit newline for cleaner output
    const suffix = process.stdout.isTTY ? "\n" : "";
    stdout.write(`${token}${suffix}`);
  },
});
