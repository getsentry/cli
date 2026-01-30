/**
 * sentry org list
 *
 * List organizations the user has access to.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { listOrganizations } from "../../lib/api-client.js";
import { getAllOrgRegions } from "../../lib/db/regions.js";
import {
  calculateOrgSlugWidth,
  formatOrgRow,
  writeFooter,
  writeJson,
} from "../../lib/formatters/index.js";

type ListFlags = {
  readonly limit: number;
  readonly json: boolean;
};

/**
 * Extract a human-readable region name from a region URL.
 * e.g., "https://us.sentry.io" -> "US", "https://de.sentry.io" -> "EU"
 */
function getRegionDisplayName(regionUrl: string): string {
  try {
    const url = new URL(regionUrl);
    const subdomain = url.hostname.split(".")[0] ?? "";
    // Map known subdomains to display names
    const regionMap: Record<string, string> = {
      us: "US",
      de: "EU",
      sentry: "US", // sentry.io defaults to US
    };
    return regionMap[subdomain] ?? subdomain.toUpperCase();
  } catch {
    return "?";
  }
}

export const listCommand = buildCommand({
  docs: {
    brief: "List organizations",
    fullDescription:
      "List organizations that you have access to.\n\n" +
      "Examples:\n" +
      "  sentry org list\n" +
      "  sentry org list --limit 10\n" +
      "  sentry org list --json",
  },
  parameters: {
    flags: {
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of organizations to list",
        // Stricli requires string defaults (raw CLI input); numberParser converts to number
        default: "30",
      },
      json: {
        kind: "boolean",
        brief: "Output JSON",
        default: false,
      },
    },
  },
  async func(this: SentryContext, flags: ListFlags): Promise<void> {
    const { stdout } = this;

    const orgs = await listOrganizations();
    const limitedOrgs = orgs.slice(0, flags.limit);

    if (flags.json) {
      writeJson(stdout, limitedOrgs);
      return;
    }

    if (limitedOrgs.length === 0) {
      stdout.write("No organizations found.\n\n");
      stdout.write("This could mean:\n");
      stdout.write("  - You haven't been added to any organizations yet\n");
      stdout.write("  - Your organization may be in a different region\n");
      stdout.write("  - There may be a network or permissions issue\n\n");
      stdout.write("Try 'sentry auth status' to verify your authentication.\n");
      return;
    }

    // Check if user has orgs in multiple regions
    const orgRegions = await getAllOrgRegions();
    const uniqueRegions = new Set(orgRegions.values());
    const showRegion = uniqueRegions.size > 1;

    const slugWidth = calculateOrgSlugWidth(limitedOrgs);

    // Header
    if (showRegion) {
      stdout.write(
        `${"SLUG".padEnd(slugWidth)}  ${"REGION".padEnd(6)}  NAME\n`
      );
    } else {
      stdout.write(`${"SLUG".padEnd(slugWidth)}  NAME\n`);
    }

    // Rows
    for (const org of limitedOrgs) {
      if (showRegion) {
        const regionUrl = orgRegions.get(org.slug) ?? "";
        const regionName = getRegionDisplayName(regionUrl);
        stdout.write(
          `${org.slug.padEnd(slugWidth)}  ${regionName.padEnd(6)}  ${org.name}\n`
        );
      } else {
        stdout.write(`${formatOrgRow(org, slugWidth)}\n`);
      }
    }

    if (orgs.length > flags.limit) {
      stdout.write(
        `\nShowing ${flags.limit} of ${orgs.length} organizations\n`
      );
    }

    writeFooter(stdout, "Tip: Use 'sentry org view <slug>' for details");
  },
});
