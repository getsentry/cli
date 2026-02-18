/**
 * sentry trace list
 *
 * List recent traces from Sentry projects.
 */

import type { SentryContext } from "../../context.js";
import { listTransactions } from "../../lib/api-client.js";
import {
  formatTraceRow,
  formatTracesHeader,
} from "../../lib/formatters/index.js";
import {
  listCommand as buildListCommand,
  makeValidateLimit,
  resolveSingleTarget,
} from "../../lib/list-helpers.js";
import type { TransactionListItem } from "../../types/index.js";

type SortValue = "date" | "duration";

/** Accepted values for the --sort flag */
const VALID_SORT_VALUES: SortValue[] = ["date", "duration"];

/** Maximum allowed value for --limit flag */
const MAX_LIMIT = 1000;

/** Minimum allowed value for --limit flag */
const MIN_LIMIT = 1;

/** Default number of traces to show */
const DEFAULT_LIMIT = 20;

/**
 * Parse and validate sort flag value.
 *
 * @throws Error if value is not "date" or "duration"
 * @internal Exported for testing
 */
export function parseSort(value: string): SortValue {
  if (!VALID_SORT_VALUES.includes(value as SortValue)) {
    throw new Error(
      `Invalid sort value. Must be one of: ${VALID_SORT_VALUES.join(", ")}`
    );
  }
  return value as SortValue;
}

/**
 * Validate that --limit value is within allowed range.
 *
 * @throws Error if value is outside MIN_LIMIT..MAX_LIMIT range
 * @internal Exported for testing
 */
export const validateLimit = makeValidateLimit(MIN_LIMIT, MAX_LIMIT);

/**
 * Resolve org/project for trace commands.
 * Thin wrapper around the shared `resolveSingleTarget` helper.
 *
 * @internal Exported for testing
 */
export function resolveTraceTarget(
  target: string | undefined,
  cwd: string
): Promise<{ org: string; project: string }> {
  return resolveSingleTarget(target, cwd, "sentry trace list");
}

export const listCommand = buildListCommand<TransactionListItem>({
  docs: {
    brief: "List recent traces in a project",
    fullDescription:
      "List recent traces from Sentry projects.\n\n" +
      "Target specification:\n" +
      "  sentry trace list               # auto-detect from DSN or config\n" +
      "  sentry trace list <org>/<proj>  # explicit org and project\n" +
      "  sentry trace list <project>     # find project across all orgs\n\n" +
      "Examples:\n" +
      "  sentry trace list                     # List last 10 traces\n" +
      "  sentry trace list --limit 50          # Show more traces\n" +
      "  sentry trace list --sort duration     # Sort by slowest first\n" +
      '  sentry trace list -q "transaction:GET /api/users"  # Filter by transaction',
  },
  limit: { min: MIN_LIMIT, max: MAX_LIMIT, default: DEFAULT_LIMIT },
  features: { query: true, sort: VALID_SORT_VALUES },
  positional: {
    placeholder: "target",
    brief: "Target: <org>/<project> or <project>",
    optional: true,
  },
  emptyMessage: "No traces found.",
  footerTip: (result, flags) => {
    const count = result.items.length;
    const hasMore = count >= (flags.limit as number);
    const countText = `Showing ${count} trace${count === 1 ? "" : "s"}.`;
    const tip = hasMore ? " Use --limit to show more." : "";
    return `${countText}${tip} Use 'sentry trace view <TRACE_ID>' to view the full span tree.`;
  },
  async fetch(this: SentryContext, flags, target) {
    const { org, project } = await resolveSingleTarget(
      target,
      this.cwd,
      "sentry trace list"
    );
    this.setContext([org], [project]);

    const traces = await listTransactions(org, project, {
      query: flags.query,
      limit: flags.limit,
      sort: (flags.sort as SortValue) ?? "date",
    });

    return {
      items: traces,
      header: `Recent traces in ${org}/${project}:`,
    };
  },
  render(items, stdout) {
    stdout.write("\n");
    stdout.write(formatTracesHeader());
    for (const trace of items) {
      stdout.write(formatTraceRow(trace));
    }
  },
});
