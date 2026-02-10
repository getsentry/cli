/**
 * sentry org list
 *
 * List organizations the user has access to.
 */

import type { SentryContext } from "../../context.js";
import { listOrganizations } from "../../lib/api-client.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { DEFAULT_SENTRY_HOST } from "../../lib/constants.js";
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
 * Strips the .sentry.io suffix and maps known regions to display names.
 *
 * @example "https://sentry.io" -> "US" (default)
 * @example "https://us.sentry.io" -> "US"
 * @example "https://de.sentry.io" -> "EU"
 * @example "https://east-1.us.sentry.io" -> "EAST-1.US"
 */
function getRegionDisplayName(regionUrl: string): string {
  try {
    const url = new URL(regionUrl);
    const { hostname } = url;

    // Strip .sentry.io suffix to get the region identifier
    const suffix = `.${DEFAULT_SENTRY_HOST}`;
    let regionPart: string;
    if (hostname === DEFAULT_SENTRY_HOST) {
      regionPart = "sentry"; // sentry.io -> sentry (US default)
    } else if (hostname.endsWith(suffix)) {
      regionPart = hostname.slice(0, -suffix.length); // us.sentry.io -> us
    } else {
      regionPart = hostname; // Non-sentry domain, use as-is
    }

    const regionMap: Record<string, string> = {
      us: "US",
      de: "EU",
      sentry: "US", // sentry.io defaults to US
    };
    return regionMap[regionPart] ?? regionPart.toUpperCase();
  } catch {
    return "?";
  }
}

export const listCommand = buildCommand({
  docs: {
    brief: "List organizations (test auto-commit)",
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
      stdout.write("No organizations found.\n");
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
