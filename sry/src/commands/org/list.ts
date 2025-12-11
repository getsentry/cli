import { buildCommand, numberParser } from "@stricli/core";
import type { SryContext } from "../../context.js";
import { listOrganizations } from "../../lib/api-client.js";
import type { SentryOrganization } from "../../types/index.js";

type ListFlags = {
  readonly limit: number;
  readonly json: boolean;
};

function formatOrg(org: SentryOrganization, maxSlugLen: number): string {
  const slug = org.slug.padEnd(maxSlugLen);
  const name = org.name;
  return `${slug}  ${name}`;
}

export const listCommand = buildCommand({
  docs: {
    brief: "List organizations",
    fullDescription:
      "List organizations that you have access to.\n\n" +
      "Examples:\n" +
      "  sry org list\n" +
      "  sry org list --limit 10\n" +
      "  sry org list --json",
  },
  parameters: {
    flags: {
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of organizations to list",
        default: 30,
      },
      json: {
        kind: "boolean",
        brief: "Output JSON",
        default: false,
      },
    },
  },
  async func(this: SryContext, flags: ListFlags): Promise<void> {
    const { process } = this;

    try {
      const orgs = await listOrganizations();
      const limitedOrgs = orgs.slice(0, flags.limit);

      if (flags.json) {
        process.stdout.write(`${JSON.stringify(limitedOrgs, null, 2)}\n`);
        return;
      }

      if (limitedOrgs.length === 0) {
        process.stdout.write("No organizations found.\n");
        return;
      }

      // Calculate max slug length for alignment
      const maxSlugLen = Math.max(...limitedOrgs.map((o) => o.slug.length));

      // Print header
      process.stdout.write(`${"SLUG".padEnd(maxSlugLen)}  NAME\n`);

      // Print organizations
      for (const org of limitedOrgs) {
        process.stdout.write(`${formatOrg(org, maxSlugLen)}\n`);
      }

      if (orgs.length > flags.limit) {
        process.stdout.write(
          `\nShowing ${flags.limit} of ${orgs.length} organizations\n`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error listing organizations: ${message}\n`);
      process.exitCode = 1;
    }
  },
});
