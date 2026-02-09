/**
 * sentry profile view
 *
 * View CPU profiling analysis for a specific transaction.
 * Displays hot paths, performance percentiles, and recommendations.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import {
  findProjectsBySlug,
  getFlamegraph,
  getProject,
} from "../../lib/api-client.js";
import {
  ProjectSpecificationType,
  parseOrgProjectArg,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { ContextError } from "../../lib/errors.js";
import {
  formatProfileAnalysis,
  muted,
  writeJson,
} from "../../lib/formatters/index.js";
import {
  analyzeFlamegraph,
  hasProfileData,
} from "../../lib/profile/analyzer.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import { resolveTransaction } from "../../lib/resolve-transaction.js";
import { buildProfileUrl } from "../../lib/sentry-urls.js";

type ViewFlags = {
  readonly period: string;
  readonly limit: number;
  readonly allFrames: boolean;
  readonly json: boolean;
  readonly web: boolean;
};

/** Valid period values */
const VALID_PERIODS = ["1h", "24h", "7d", "14d", "30d"];

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry profile view <org>/<project> <transaction>";

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
 * Parse positional arguments for profile view.
 * Handles: `<transaction>` or `<target> <transaction>`
 *
 * @returns Parsed transaction and optional target arg
 */
export function parsePositionalArgs(args: string[]): {
  transactionRef: string;
  targetArg: string | undefined;
} {
  if (args.length === 0) {
    throw new ContextError("Transaction name or alias", USAGE_HINT);
  }

  const first = args[0];
  if (first === undefined) {
    throw new ContextError("Transaction name or alias", USAGE_HINT);
  }

  if (args.length === 1) {
    // Single arg - must be transaction reference
    return { transactionRef: first, targetArg: undefined };
  }

  const second = args[1];
  if (second === undefined) {
    // Should not happen given length check, but TypeScript needs this
    return { transactionRef: first, targetArg: undefined };
  }

  // Two or more args - first is target, second is transaction
  return { transactionRef: second, targetArg: first };
}

/** Resolved target type for internal use */
type ResolvedProfileTarget = {
  org: string;
  project: string;
  orgDisplay: string;
  projectDisplay: string;
  detectedFrom?: string;
};

/**
 * Resolve target from a project search result.
 */
export async function resolveFromProjectSearch(
  projectSlug: string,
  transactionRef: string
): Promise<ResolvedProfileTarget> {
  const found = await findProjectsBySlug(projectSlug);
  if (found.length === 0) {
    throw new ContextError(`Project "${projectSlug}"`, USAGE_HINT, [
      "Check that you have access to a project with this slug",
    ]);
  }
  if (found.length > 1) {
    const alternatives = found.map(
      (p) => `${p.organization?.slug ?? "unknown"}/${p.slug}`
    );
    throw new ContextError(
      `Project "${projectSlug}" exists in multiple organizations`,
      `sentry profile view <org>/${projectSlug} ${transactionRef}`,
      alternatives
    );
  }
  const foundProject = found[0];
  if (!foundProject) {
    throw new ContextError(`Project "${projectSlug}" not found`, USAGE_HINT);
  }
  const orgSlug = foundProject.organization?.slug;
  if (!orgSlug) {
    throw new ContextError(
      `Could not determine organization for project "${projectSlug}"`,
      USAGE_HINT
    );
  }
  return {
    org: orgSlug,
    project: foundProject.slug,
    orgDisplay: orgSlug,
    projectDisplay: foundProject.slug,
  };
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View CPU profiling analysis for a transaction",
    fullDescription:
      "Analyze CPU profiling data for a specific transaction.\n\n" +
      "Displays:\n" +
      "  - Performance percentiles (p75, p95, p99)\n" +
      "  - Hot paths (functions consuming the most CPU time)\n" +
      "  - Recommendations for optimization\n\n" +
      "By default, only user application code is shown. Use --all-frames to include library code.\n\n" +
      "Target specification:\n" +
      "  sentry profile view <transaction>                  # auto-detect from DSN or config\n" +
      "  sentry profile view <org>/<proj> <transaction>     # explicit org and project\n" +
      "  sentry profile view <project> <transaction>        # find project across all orgs",
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "args",
        brief:
          '[<org>/<project>] <transaction> - Target (optional) and transaction (required). Transaction can be index (1), alias (i), or full name ("/api/users")',
        parse: String,
      },
    },
    flags: {
      period: {
        kind: "parsed",
        parse: parsePeriod,
        brief: "Stats period: 1h, 24h, 7d, 14d, 30d",
        default: "24h",
      },
      limit: {
        kind: "parsed",
        parse: numberParser,
        brief: "Number of hot paths to show (max 20)",
        default: "10",
      },
      allFrames: {
        kind: "boolean",
        brief: "Include library/system frames (default: user code only)",
        default: false,
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
    aliases: { w: "web", n: "limit" },
  },
  async func(
    this: SentryContext,
    flags: ViewFlags,
    ...args: string[]
  ): Promise<void> {
    const { stdout, cwd, setContext } = this;

    // Parse positional args
    const { transactionRef, targetArg } = parsePositionalArgs(args);
    const parsed = parseOrgProjectArg(targetArg);

    let target: ResolvedProfileTarget | null = null;

    switch (parsed.type) {
      case ProjectSpecificationType.Explicit:
        target = {
          org: parsed.org,
          project: parsed.project,
          orgDisplay: parsed.org,
          projectDisplay: parsed.project,
        };
        break;

      case ProjectSpecificationType.ProjectSearch:
        target = await resolveFromProjectSearch(
          parsed.projectSlug,
          transactionRef
        );
        break;

      case ProjectSpecificationType.OrgAll:
        throw new ContextError(
          "A specific project is required for profile view",
          USAGE_HINT
        );

      case ProjectSpecificationType.AutoDetect:
        target = await resolveOrgAndProject({ cwd, usageHint: USAGE_HINT });
        break;

      default:
        // Exhaustive check - should never reach here
        throw new ContextError("Invalid target specification", USAGE_HINT);
    }

    if (!target) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    // Resolve transaction reference (alias, index, or full name)
    // This may throw ContextError if alias is stale or not found
    const resolved = resolveTransaction(transactionRef, {
      org: target.org,
      project: target.project,
      period: flags.period,
    });

    // Use resolved transaction name for the rest of the command
    const transactionName = resolved.transaction;

    // Set telemetry context
    setContext([target.org], [target.project]);

    // Open in browser if requested
    if (flags.web) {
      await openInBrowser(
        stdout,
        buildProfileUrl(target.org, target.project, transactionName),
        "profile"
      );
      return;
    }

    // Get project to retrieve numeric ID
    const project = await getProject(target.org, target.project);

    // Fetch flamegraph data
    const flamegraph = await getFlamegraph(
      target.org,
      project.id,
      transactionName,
      flags.period
    );

    // Check if we have profile data
    if (!hasProfileData(flamegraph)) {
      stdout.write(
        `No profiling data found for transaction "${transactionName}".\n\n`
      );
      stdout.write(
        "Make sure:\n" +
          "  1. Profiling is enabled for your project\n" +
          "  2. The transaction name is correct\n" +
          "  3. Profile data has been collected in the specified period\n"
      );
      return;
    }

    // Clamp limit to valid range
    const limit = Math.min(Math.max(flags.limit, 1), 20);

    // Analyze the flamegraph
    const analysis = analyzeFlamegraph(flamegraph, {
      transactionName,
      period: flags.period,
      limit,
      userCodeOnly: !flags.allFrames,
    });

    // JSON output
    if (flags.json) {
      writeJson(stdout, analysis);
      return;
    }

    // Human-readable output
    const lines = formatProfileAnalysis(analysis);
    stdout.write(`${lines.join("\n")}\n`);

    if (target.detectedFrom) {
      stdout.write(`\n${muted(`Detected from ${target.detectedFrom}`)}\n`);
    }
  },
});
