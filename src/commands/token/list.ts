/**
 * sentry token list
 *
 * List active org auth tokens for an organization.
 * Tokens are sorted by last-used date (most recent first).
 */

import type { SentryContext } from "../../context.js";
import { listOrgAuthTokens } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import { escapeMarkdownCell } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { type Column, formatTable } from "../../lib/formatters/table.js";
import { formatRelativeTime } from "../../lib/formatters/time-utils.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import type { OrgAuthToken } from "../../types/index.js";

/** Column definitions for the token table. */
const TOKEN_COLUMNS: Column<OrgAuthToken>[] = [
  { header: "ID", value: (t) => t.id },
  { header: "NAME", value: (t) => escapeMarkdownCell(t.name) },
  {
    header: "SCOPES",
    value: (t) => t.scopes.join(", "),
  },
  {
    header: "LAST 4",
    value: (t) => t.tokenLastCharacters ?? "",
  },
  {
    header: "LAST USED",
    value: (t) =>
      t.dateLastUsed ? formatRelativeTime(t.dateLastUsed) : "never",
  },
];

/** Token list result for output rendering. */
type TokenListResult = {
  tokens: OrgAuthToken[];
  orgSlug: string;
};

function formatTokenList(result: TokenListResult): string {
  if (result.tokens.length === 0) {
    return `No active tokens found for ${result.orgSlug}.`;
  }
  const header = `${result.tokens.length} token${result.tokens.length === 1 ? "" : "s"} in ${result.orgSlug}`;
  return `${header}\n\n${formatTable(result.tokens, TOKEN_COLUMNS)}`;
}

type ListFlags = {
  readonly json: boolean;
  readonly fields?: string[];
};

export const listCommand = buildCommand({
  docs: {
    brief: "List org auth tokens",
    fullDescription:
      "List active organization auth tokens.\n\n" +
      "Shows token ID, name, scopes, last 4 characters, and last-used date.\n\n" +
      "Examples:\n" +
      "  sentry token list my-org\n" +
      "  sentry token list              # auto-detect org\n" +
      "  sentry token list --json",
  },
  output: {
    human: formatTokenList,
    jsonTransform: (result: TokenListResult) => result.tokens,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org",
          brief: "Organization slug",
          parse: String,
          optional: true,
        },
      ],
    },
  },
  async *func(this: SentryContext, _flags: ListFlags, orgArg?: string) {
    const { cwd } = this;

    const resolved = await resolveOrg({ org: orgArg, cwd });
    if (!resolved) {
      throw new ContextError("Organization", "sentry token list <org>", []);
    }
    const orgSlug = resolved.org;

    const tokens = await listOrgAuthTokens(orgSlug);

    yield new CommandOutput({ tokens, orgSlug });
  },
});
