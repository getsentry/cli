/**
 * sentry auth token
 *
 * Print the stored authentication token (unmasked).
 * Useful for piping to other commands or scripts.
 */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { getAuthToken } from "../../lib/db/auth.js";
import { CommandOutput } from "../../lib/formatters/output.js";

export const tokenCommand = buildCommand({
  docs: {
    brief: "Print the stored authentication token",
    fullDescription:
      "Print the stored authentication token to stdout.\n\n" +
      "This outputs the raw token without any formatting, making it suitable for " +
      "piping to other commands or scripts.",
  },
  parameters: {},
  output: { human: (token: string) => token },
  // biome-ignore lint/suspicious/useAwait: sync body but async generator required by buildCommand
  async *func(this: SentryContext) {
    // biome-ignore lint/style/noNonNullAssertion: auth guard in buildCommand ensures token exists
    return yield new CommandOutput(getAuthToken()!);
  },
});
