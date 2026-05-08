/**
 * Shared replay target parsing helpers.
 *
 * Keeps `replay view` and replay subcommands aligned on accepted target forms:
 * bare replay IDs, `<org>/<replay-id>`, `<org>/<project>/<replay-id>`,
 * `<target> <replay-id>`, and Sentry replay URLs.
 */

import {
  detectSwappedViewArgs,
  parseSlashSeparatedArg,
} from "../../lib/arg-parsing.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { tryNormalizeHexId } from "../../lib/hex-id.js";
import {
  applySentryUrlContext,
  parseSentryUrl,
} from "../../lib/sentry-url-parser.js";

export type ParsedReplayTargetArgs = {
  replayId: string;
  targetArg: string | undefined;
  warning?: string;
};

export const REPLAY_TARGET_USAGE =
  "sentry replay <command> [<org>/<project>/]<replay-id> | <replay-url>";

/**
 * Parse a single positional argument as a replay target.
 *
 * The single-slash case (`org/id`) needs special handling because 32-char hex
 * replay IDs look valid to the generic slash parser's ID extraction.
 */
function parseSingleReplayTargetArg(
  arg: string,
  usageHint: string
): ParsedReplayTargetArgs {
  const trimmed = arg.trim();
  if (!trimmed) {
    throw new ContextError("Replay ID", usageHint, []);
  }

  const slashIdx = trimmed.indexOf("/");
  if (slashIdx !== -1 && trimmed.indexOf("/", slashIdx + 1) === -1) {
    const org = trimmed.slice(0, slashIdx);
    const replaySegment = trimmed.slice(slashIdx + 1);
    const normalizedReplayId =
      replaySegment && tryNormalizeHexId(replaySegment);
    if (!normalizedReplayId) {
      throw new ContextError("Replay ID", usageHint, []);
    }
    return { replayId: normalizedReplayId, targetArg: `${org}/` };
  }

  const { id: replayId, targetArg } = parseSlashSeparatedArg(
    trimmed,
    "Replay ID",
    usageHint
  );
  return { replayId, targetArg };
}

/**
 * Parse replay command positional arguments.
 */
export function parseReplayTargetArgs(
  args: string[],
  usageHint = REPLAY_TARGET_USAGE
): ParsedReplayTargetArgs {
  if (args.length === 0) {
    throw new ContextError("Replay ID", usageHint, []);
  }
  if (args.length > 2) {
    throw new ValidationError(
      `Too many positional arguments (got ${args.length}, expected at most 2).\n\nUsage: ${usageHint}`,
      "positional"
    );
  }

  const first = args[0];
  if (!first) {
    throw new ContextError("Replay ID", usageHint, []);
  }

  const urlParsed = parseSentryUrl(first);
  if (urlParsed) {
    applySentryUrlContext(urlParsed.baseUrl);
    if (urlParsed.replayId && urlParsed.org) {
      return { replayId: urlParsed.replayId, targetArg: `${urlParsed.org}/` };
    }
    throw new ContextError("Replay ID", usageHint, [
      "Pass a replay URL: https://sentry.io/organizations/{org}/explore/replays/{replayId}/",
    ]);
  }

  if (args.length === 1) {
    return parseSingleReplayTargetArg(first, usageHint);
  }

  const second = args[1];
  if (!second) {
    throw new ContextError("Replay ID", usageHint, []);
  }

  const warning =
    args.length === 2 ? detectSwappedViewArgs(first, second) : null;
  if (warning) {
    const normalizedReplayId = tryNormalizeHexId(first) ?? first;
    return {
      replayId: normalizedReplayId,
      targetArg: second,
      warning,
    };
  }

  return { replayId: second, targetArg: first };
}
