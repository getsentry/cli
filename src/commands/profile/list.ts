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
  findCommonPrefix,
  formatProfileListFooter,
  formatProfileListHeader,
  formatProfileListRow,
  formatProfileListTableHeader,
  profileListDividerWidth,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  resolveOrgAndProject,
  resolveProjectBySlug,
} from "../../lib/resolve-target.js";
import { buildProfilingSummaryUrl } from "../../lib/sentry-urls.js";
import { buildTransactionAliases } from "../../lib/transaction-alias.js";
import type { TransactionAliasEntry, Writer } from "../../types/index.js";
import { parsePeriod } from "./shared.js";

type ListFlags = {
  readonly period: string;
  readonly limit: number;
  readonly json: boolean;
  readonly web: boolean;
};

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry profile list <org>/<project>";

/** Resolved org and project for profile list */
type ResolvedListTarget = {
  org: string;
  project: string;
  detectedFrom?: string;
};

/**
 * Resolve org/project from parsed argument or auto-detection.
 *
 * @throws {ContextError} When target cannot be resolved
 */
async function resolveListTarget(
  target: string | undefined,
  cwd: string
): Promise<ResolvedListTarget> {
  const parsed = parseOrgProjectArg(target);

  switch (parsed.type) {
    case "org-all":
      throw new ContextError(
        "Project",
        "Profile listing requires a specific project.\n\n" +
          "Usage: sentry profile list <org>/<project>"
      );

    case "explicit": {
      const resolved = await resolveOrgAndProject({
        org: parsed.org,
        project: parsed.project,
        cwd,
        usageHint: USAGE_HINT,
      });
      if (!resolved) {
        throw new ContextError("Organization and project", USAGE_HINT);
      }
      return resolved;
    }

    case "project-search":
      return await resolveProjectBySlug(parsed.projectSlug, USAGE_HINT);

    case "auto-detect": {
      const resolved = await resolveOrgAndProject({
        cwd,
        usageHint: USAGE_HINT,
      });
      if (!resolved) {
        throw new ContextError("Organization and project", USAGE_HINT);
      }
      return resolved;
    }

    default: {
      const _exhaustiveCheck: never = parsed;
      throw new ContextError(
        `Unexpected target type: ${_exhaustiveCheck}`,
        USAGE_HINT
      );
    }
  }
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

    // Resolve org and project from positional arg or auto-detection
    const resolvedTarget = await resolveListTarget(target, cwd);

    // Set telemetry context
    setContext([resolvedTarget.org], [resolvedTarget.project]);

    // Get project to retrieve numeric ID (required for profile API and web URLs)
    const project = await getProject(
      resolvedTarget.org,
      resolvedTarget.project
    );

    // Open in browser if requested
    if (flags.web) {
      await openInBrowser(
        stdout,
        buildProfilingSummaryUrl(resolvedTarget.org, project.id),
        "profiling"
      );
      return;
    }

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

    // Compute common prefix for smarter transaction name display
    const transactionNames = response.data
      .map((r) => r.transaction)
      .filter((t): t is string => t !== null && t !== undefined);
    const commonPrefix = findCommonPrefix(transactionNames);

    stdout.write(`${formatProfileListHeader(orgProject, flags.period)}\n\n`);
    stdout.write(`${formatProfileListTableHeader(hasAliases)}\n`);
    stdout.write(`${divider(profileListDividerWidth(hasAliases))}\n`);

    for (const row of response.data) {
      const alias = row.transaction ? aliasMap.get(row.transaction) : undefined;
      stdout.write(`${formatProfileListRow(row, alias, commonPrefix)}\n`);
    }

    stdout.write(formatProfileListFooter(hasAliases, commonPrefix));

    if (resolvedTarget.detectedFrom) {
      stdout.write(`\n\nDetected from ${resolvedTarget.detectedFrom}\n`);
    }
  },
});
