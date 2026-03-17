/**
 * Shared dashboard resolution utilities
 *
 * Provides org resolution from parsed target arguments and dashboard
 * ID resolution from numeric IDs or title strings.
 */

import { listDashboards } from "../../lib/api-client.js";
import type { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { isAllDigits } from "../../lib/utils.js";

/**
 * Resolve org slug from a parsed org/project target argument.
 *
 * Dashboard commands only need the org (dashboards are org-scoped), so
 * explicit, org-all, project-search, and auto-detect all resolve to just
 * the org slug.
 *
 * @param parsed - Parsed org/project argument
 * @param cwd - Current working directory for auto-detection
 * @param usageHint - Usage example for error messages
 * @returns Organization slug
 */
export async function resolveOrgFromTarget(
  parsed: ReturnType<typeof parseOrgProjectArg>,
  cwd: string,
  usageHint: string
): Promise<string> {
  switch (parsed.type) {
    case "explicit":
    case "org-all":
      return parsed.org;
    case "project-search":
    case "auto-detect": {
      const resolved = await resolveOrg({ cwd });
      if (!resolved) {
        throw new ContextError("Organization", usageHint);
      }
      return resolved.org;
    }
    default: {
      const _exhaustive: never = parsed;
      throw new Error(
        `Unexpected parsed type: ${(_exhaustive as { type: string }).type}`
      );
    }
  }
}

/**
 * Parse a dashboard reference and optional target from array positional args.
 *
 * Handles:
 * - `<id-or-title>` — single arg (auto-detect org)
 * - `<target> <id-or-title>` — explicit target + dashboard ref
 *
 * @param args - Raw positional arguments
 * @param usageHint - Error message label (e.g. "Dashboard ID or title")
 * @returns Dashboard reference string and optional target arg
 */
export function parseDashboardPositionalArgs(args: string[]): {
  dashboardRef: string;
  targetArg: string | undefined;
} {
  if (args.length === 0) {
    throw new ValidationError(
      "Dashboard ID or title is required.",
      "dashboard"
    );
  }
  if (args.length === 1) {
    return {
      dashboardRef: args[0] as string,
      targetArg: undefined,
    };
  }
  return {
    dashboardRef: args[1] as string,
    targetArg: args[0] as string,
  };
}

/**
 * Resolve a dashboard reference (numeric ID or title) to a numeric ID string.
 *
 * If the reference is all digits, returns it directly. Otherwise, lists
 * dashboards in the org and finds a case-insensitive title match.
 *
 * @param orgSlug - Organization slug
 * @param ref - Dashboard reference (numeric ID or title)
 * @returns Numeric dashboard ID as a string
 */
export async function resolveDashboardId(
  orgSlug: string,
  ref: string
): Promise<string> {
  if (isAllDigits(ref)) {
    return ref;
  }

  const dashboards = await listDashboards(orgSlug);
  const lowerRef = ref.toLowerCase();
  const match = dashboards.find((d) => d.title.toLowerCase() === lowerRef);

  if (!match) {
    const available = dashboards
      .slice(0, 5)
      .map((d) => `  ${d.id}  ${d.title}`)
      .join("\n");
    const suffix =
      dashboards.length > 5 ? `\n  ... and ${dashboards.length - 5} more` : "";
    throw new ValidationError(
      `No dashboard with title '${ref}' found in '${orgSlug}'.\n\n` +
        `Available dashboards:\n${available}${suffix}`
    );
  }

  return match.id;
}
