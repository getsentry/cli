/**
 * sentry token delete
 *
 * Delete (deactivate) an org auth token by ID.
 *
 * Uses `buildDeleteCommand` for standard --yes/--force/--dry-run flags
 * and non-interactive safety guards.
 */

import type { SentryContext } from "../../context.js";
import { deleteOrgAuthToken, listOrgAuthTokens } from "../../lib/api-client.js";
import { ContextError, ResolutionError } from "../../lib/errors.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import {
  buildDeleteCommand,
  confirmByTyping,
  isConfirmationBypassed,
} from "../../lib/mutate-command.js";
import { resolveOrg } from "../../lib/resolve-target.js";

const log = logger.withTag("token.delete");

/** Result shape for output rendering. */
type TokenDeleteResult = {
  tokenId: string;
  tokenName: string;
  orgSlug: string;
  dryRun?: boolean;
};

function formatTokenDeleted(result: TokenDeleteResult): string {
  if (result.dryRun) {
    return `Would delete token '${result.tokenName}' (ID: ${result.tokenId}) from ${result.orgSlug}`;
  }
  return `Deleted token '${result.tokenName}' (ID: ${result.tokenId}) from ${result.orgSlug}`;
}

type DeleteFlags = {
  readonly yes: boolean;
  readonly force: boolean;
  readonly "dry-run": boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

/**
 * Resolve a token by ID or name within an org's token list.
 *
 * Accepts either a numeric ID or a token name. When matching by name,
 * requires an exact match (case-sensitive).
 */
async function resolveToken(
  orgSlug: string,
  tokenRef: string
): Promise<{ id: string; name: string }> {
  const tokens = await listOrgAuthTokens(orgSlug);

  const byId = tokens.find((t) => t.id === tokenRef);
  if (byId) {
    return { id: byId.id, name: byId.name };
  }

  const byName = tokens.filter((t) => t.name === tokenRef);
  if (byName.length === 1 && byName[0]) {
    return { id: byName[0].id, name: byName[0].name };
  }
  if (byName.length > 1) {
    throw new ResolutionError(
      `Token name '${tokenRef}'`,
      `matches ${byName.length} tokens`,
      "sentry token delete <org> <token-id>",
      byName.map(
        (t) => `ID ${t.id}: ${t.name} (…${t.tokenLastCharacters ?? ""})`
      )
    );
  }

  const hints =
    tokens.length > 0
      ? tokens.slice(0, 5).map((t) => `${t.id}: ${t.name}`)
      : ["No tokens found in this organization"];
  throw new ResolutionError(
    `Token '${tokenRef}'`,
    `not found in ${orgSlug}`,
    `sentry token list ${orgSlug}`,
    hints
  );
}

export const deleteCommand = buildDeleteCommand({
  docs: {
    brief: "Delete an org auth token",
    fullDescription:
      "Delete (deactivate) an organization auth token by ID or name.\n\n" +
      "The token immediately stops working for API authentication.\n\n" +
      "Examples:\n" +
      "  sentry token delete my-org 12345\n" +
      "  sentry token delete my-org 'CI deploy token'\n" +
      "  sentry token delete my-org 12345 --yes\n" +
      "  sentry token delete my-org 12345 --dry-run",
  },
  output: {
    human: formatTokenDeleted,
    jsonTransform: (result: TokenDeleteResult) => ({
      deleted: !result.dryRun,
      dryRun: result.dryRun ?? false,
      tokenId: result.tokenId,
      tokenName: result.tokenName,
      org: result.orgSlug,
    }),
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org",
          brief: "Organization slug",
          parse: String,
        },
        {
          placeholder: "token-id",
          brief: "Token ID or name",
          parse: String,
        },
      ],
    },
  },
  async *func(
    this: SentryContext,
    flags: DeleteFlags,
    orgArg: string,
    tokenRef: string
  ) {
    const { cwd } = this;

    const resolved = await resolveOrg({ org: orgArg, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry token delete <org> <token-id>",
        []
      );
    }
    const orgSlug = resolved.org;

    const token = await resolveToken(orgSlug, tokenRef);

    if (flags["dry-run"]) {
      yield new CommandOutput({
        tokenId: token.id,
        tokenName: token.name,
        orgSlug,
        dryRun: true,
      });
      return;
    }

    if (!isConfirmationBypassed(flags)) {
      const confirmed = await confirmByTyping(
        token.name,
        `Type '${token.name}' to delete token (ID: ${token.id}):`
      );
      if (!confirmed) {
        log.info("Cancelled.");
        return;
      }
    }

    await deleteOrgAuthToken(orgSlug, token.id);

    yield new CommandOutput({
      tokenId: token.id,
      tokenName: token.name,
      orgSlug,
    });
  },
});
