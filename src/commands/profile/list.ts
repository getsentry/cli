/**
 * sentry profile list
 *
 * List transactions with profiling data from Sentry.
 * Uses the Explore Events API with the profile_functions dataset.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getProject, listProfiledTransactions } from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import {
  buildTransactionFingerprint,
  setTransactionAliases,
} from "../../lib/db/transaction-aliases.js";
import { ContextError } from "../../lib/errors.js";
import {
  divider,
  formatProfileListFooter,
  formatProfileListHeader,
  formatProfileListRow,
  formatProfileListTableHeader,
  writeJson,
} from "../../lib/formatters/index.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import { buildProfilingSummaryUrl } from "../../lib/sentry-urls.js";
import { buildTransactionAliases } from "../../lib/transaction-alias.js";
import type { TransactionAliasEntry, Writer } from "../../types/index.js";

type ListFlags = {
  readonly period: string;
  readonly limit: number;
  readonly json: boolean;
  readonly web: boolean;
};

/** Valid period values */
const VALID_PERIODS = ["1h", "24h", "7d", "14d", "30d"];

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry profile list <org>/<project>";

/**
 * Parse and validate the stats period.
 */
function parsePeriod(value: string): string {
  if (!VALID_PERIODS.includes(value)) {
    throw new Error(
      `Invalid period. Must be one of: ${VALID_PERIODS.join(", ")}`
    );
  }
  return value;
}

/**
 * Write empty state message when no profiles are found.
 */
function writeEmptyState(stdout: Writer, orgProject: string): void {
  stdout.write(`No profiling data found for ${orgProject}.\n`);
  stdout.write(
    "\nMake sure profiling is enabled for your project and that profile data has been collected.\n"
  );
}

export const listCommand = buildCommand({
  docs: {
    brief: "List transactions with profiling data",
    fullDescription:
      "List transactions that have CPU profiling data in Sentry.\n\n" +
      "Target specification:\n" +
      "  sentry profile list               # auto-detect from DSN or config\n" +
      "  sentry profile list <org>/<proj>  # explicit org and project\n" +
      "  sentry profile list <project>     # find project across all orgs\n\n" +
      "The command shows transactions with profile counts and p75 timing data.",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "target",
          brief: "Target: <org>/<project> or <project>",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      period: {
        kind: "parsed",
        parse: parsePeriod,
        brief: "Time period: 1h, 24h, 7d, 14d, 30d",
        default: "24h",
      },
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Maximum number of transactions to return",
        default: "20",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
    },
    aliases: { n: "limit", w: "web" },
  },
  async func(
    this: SentryContext,
    flags: ListFlags,
    target?: string
  ): Promise<void> {
    const { stdout, cwd, setContext } = this;

    // Parse positional argument to determine resolution strategy
    const parsed = parseOrgProjectArg(target);

    // For profile list, we need both org and project
    // We don't support org-wide profile listing (too expensive)
    if (parsed.type === "org-all") {
      throw new ContextError(
        "Project",
        "Profile listing requires a specific project.\n\n" +
          "Usage: sentry profile list <org>/<project>"
      );
    }

    // Determine project slug based on parsed type
    let projectSlug: string | undefined;
    if (parsed.type === "explicit") {
      projectSlug = parsed.project;
    } else if (parsed.type === "project-search") {
      projectSlug = parsed.projectSlug;
    }

    // Resolve org and project
    const resolvedTarget = await resolveOrgAndProject({
      org: parsed.type === "explicit" ? parsed.org : undefined,
      project: projectSlug,
      cwd,
      usageHint: USAGE_HINT,
    });

    if (!resolvedTarget) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    // Set telemetry context
    setContext([resolvedTarget.org], [resolvedTarget.project]);

    // Open in browser if requested
    if (flags.web) {
      await openInBrowser(
        stdout,
        buildProfilingSummaryUrl(resolvedTarget.org, resolvedTarget.project),
        "profiling"
      );
      return;
    }

    // Get project to retrieve numeric ID (required for profile API)
    const project = await getProject(
      resolvedTarget.org,
      resolvedTarget.project
    );

    // Fetch profiled transactions
    const response = await listProfiledTransactions(
      resolvedTarget.org,
      project.id,
      {
        statsPeriod: flags.period,
        limit: flags.limit,
      }
    );

    const orgProject = `${resolvedTarget.org}/${resolvedTarget.project}`;

    // Build and store transaction aliases for later use with profile view
    const transactionInputs = response.data
      .filter((row) => row.transaction)
      .map((row) => ({
        transaction: row.transaction as string,
        orgSlug: resolvedTarget.org,
        projectSlug: resolvedTarget.project,
      }));

    const aliases = buildTransactionAliases(transactionInputs);

    // Store aliases with fingerprint for cache validation
    const fingerprint = buildTransactionFingerprint(
      resolvedTarget.org,
      resolvedTarget.project,
      flags.period
    );
    setTransactionAliases(aliases, fingerprint);

    // Build alias lookup map for formatting
    const aliasMap = new Map<string, TransactionAliasEntry>();
    for (const alias of aliases) {
      aliasMap.set(alias.transaction, alias);
    }

    // JSON output
    if (flags.json) {
      writeJson(stdout, response.data);
      return;
    }

    // Empty state
    if (response.data.length === 0) {
      writeEmptyState(stdout, orgProject);
      return;
    }

    // Human-readable output with aliases
    const hasAliases = aliases.length > 0;
    stdout.write(`${formatProfileListHeader(orgProject, flags.period)}\n\n`);
    stdout.write(`${formatProfileListTableHeader(hasAliases)}\n`);
    stdout.write(`${divider(82)}\n`);

    for (const row of response.data) {
      const alias = row.transaction ? aliasMap.get(row.transaction) : undefined;
      stdout.write(`${formatProfileListRow(row, alias)}\n`);
    }

    stdout.write(formatProfileListFooter(hasAliases));

    if (resolvedTarget.detectedFrom) {
      stdout.write(`\n\nDetected from ${resolvedTarget.detectedFrom}\n`);
    }
  },
});
