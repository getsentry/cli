/**
 * sentry org list
 *
 * List organizations the user has access to.
 */

import type { SentryContext } from "../../context.js";
import { listOrganizations } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import { DEFAULT_SENTRY_HOST } from "../../lib/constants.js";
import { getAllOrgRegions } from "../../lib/db/regions.js";
import { writeFooter, writeJson } from "../../lib/formatters/index.js";
import { type Column, writeTable } from "../../lib/formatters/table.js";
import { buildListLimitFlag, LIST_JSON_FLAG } from "../../lib/list-command.js";

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
      limit: buildListLimitFlag("organizations"),
      json: LIST_JSON_FLAG,
    },
    // Only -n for --limit; no -c since org list has no --cursor flag
    aliases: { n: "limit" },
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

    // Build columns — include REGION when orgs span multiple regions
    type OrgRow = { slug: string; name: string; region?: string };
    const rows: OrgRow[] = limitedOrgs.map((org) => ({
      slug: org.slug,
      name: org.name,
      region: showRegion
        ? getRegionDisplayName(orgRegions.get(org.slug) ?? "")
        : undefined,
    }));

    const columns: Column<OrgRow>[] = [
      { header: "SLUG", value: (r) => r.slug },
      ...(showRegion
        ? [{ header: "REGION", value: (r: OrgRow) => r.region ?? "" }]
        : []),
      { header: "NAME", value: (r) => r.name },
    ];

    writeTable(stdout, rows, columns);

    if (orgs.length > flags.limit) {
      stdout.write(
        `\nShowing ${flags.limit} of ${orgs.length} organizations\n`
      );
    }

    writeFooter(stdout, "Tip: Use 'sentry org view <slug>' for details");
  },
});
