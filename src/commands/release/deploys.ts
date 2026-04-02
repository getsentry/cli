/**
 * sentry release deploys
 *
 * List deploys for a release.
 */

import type { DeployResponse } from "@sentry/api";
import type { SentryContext } from "../../context.js";
import { listReleaseDeploys } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { type Column, formatTable } from "../../lib/formatters/table.js";
import { formatRelativeTime } from "../../lib/formatters/time-utils.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { parseReleaseArg } from "./parse.js";

const DEPLOY_COLUMNS: Column<DeployResponse>[] = [
  { header: "ENVIRONMENT", value: (d) => d.environment },
  { header: "NAME", value: (d) => d.name || "—" },
  {
    header: "FINISHED",
    value: (d) => (d.dateFinished ? formatRelativeTime(d.dateFinished) : "—"),
  },
];

function formatDeployList(deploys: DeployResponse[]): string {
  if (deploys.length === 0) {
    return "No deploys found for this release.";
  }
  return formatTable(deploys, DEPLOY_COLUMNS);
}

export const deploysCommand = buildCommand({
  docs: {
    brief: "List deploys for a release",
    fullDescription:
      "List all deploys recorded for a specific release.\n\n" +
      "Examples:\n" +
      "  sentry release deploys 1.0.0\n" +
      "  sentry release deploys my-org/1.0.0\n" +
      "  sentry release deploys 1.0.0 --json",
  },
  output: {
    human: formatDeployList,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/version",
        brief: "[<org>/]<version> - Release version",
        parse: String,
      },
    },
  },
  async *func(
    this: SentryContext,
    _flags: { readonly json: boolean; readonly fields?: string[] },
    ...args: string[]
  ) {
    const { cwd } = this;

    const joined = args.join(" ").trim();
    if (!joined) {
      throw new ContextError(
        "Release version",
        "sentry release deploys [<org>/]<version>",
        []
      );
    }

    const { version, orgSlug } = parseReleaseArg(
      joined,
      "sentry release deploys [<org>/]<version>"
    );
    const resolved = await resolveOrg({ org: orgSlug, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry release deploys [<org>/]<version>"
      );
    }

    const deploys = await listReleaseDeploys(resolved.org, version);
    yield new CommandOutput(deploys);
  },
});
