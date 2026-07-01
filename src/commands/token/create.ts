/**
 * sentry token create
 *
 * Create a new org auth token. The full token value is printed to stdout
 * exactly once — it cannot be retrieved again after creation.
 *
 * Org auth tokens are scoped to `org:ci` and are intended for CI pipelines,
 * release management, and other automated workflows.
 */

import type { SentryContext } from "../../context.js";
import { createOrgAuthToken } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { success } from "../../lib/formatters/colors.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import type { OrgAuthToken } from "../../types/index.js";

/** Result shape for output rendering. */
type TokenCreateResult = {
  token: OrgAuthToken;
  orgSlug: string;
};

function formatTokenCreated(result: TokenCreateResult): string {
  const lines: string[] = [];
  lines.push(
    success(`Created token '${result.token.name}' in ${result.orgSlug}`)
  );
  lines.push("");
  if (result.token.token) {
    lines.push(`Token: ${result.token.token}`);
    lines.push("");
    lines.push("Save this token now — it will not be shown again.");
  }
  lines.push(`ID: ${result.token.id}`);
  lines.push(`Scopes: ${result.token.scopes.join(", ")}`);
  return lines.join("\n");
}

type CreateFlags = {
  readonly name?: string;
  readonly json: boolean;
  readonly fields?: string[];
};

export const createCommand = buildCommand({
  docs: {
    brief: "Create an org auth token",
    fullDescription:
      "Create a new organization auth token with org:ci scope.\n\n" +
      "The full token value is printed exactly once — save it immediately.\n" +
      "Subsequent requests only show the last 4 characters.\n\n" +
      "Examples:\n" +
      "  sentry token create my-org --name 'CI deploy token'\n" +
      "  sentry token create --name 'release-bot'    # auto-detect org\n" +
      "  sentry token create my-org --name ci --json",
  },
  output: {
    human: formatTokenCreated,
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
    flags: {
      name: {
        kind: "parsed",
        parse: String,
        brief: "Name for the new token",
        optional: true,
      },
    },
  },
  async *func(this: SentryContext, flags: CreateFlags, orgArg?: string) {
    const { cwd } = this;

    const resolved = await resolveOrg({ org: orgArg, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry token create <org> --name <name>",
        []
      );
    }
    const orgSlug = resolved.org;

    const name = flags.name;
    if (!name) {
      throw new ValidationError(
        "Token name is required. Use --name to specify a name.",
        "name"
      );
    }

    const token = await createOrgAuthToken(orgSlug, name);

    yield new CommandOutput({ token, orgSlug });
    return {
      hint: "Save the token value now — it cannot be retrieved later.",
    };
  },
});
