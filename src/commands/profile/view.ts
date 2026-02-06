/**
 * sentry profile view
 *
 * View CPU profiling analysis for a specific transaction.
 * Displays hot paths, performance percentiles, and recommendations.
 */

import { buildCommand, numberParser } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getFlamegraph, getProject } from "../../lib/api-client.js";
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
  readonly org?: string;
  readonly project?: string;
  readonly period: string;
  readonly limit: number;
  readonly allFrames: boolean;
  readonly json: boolean;
  readonly web: boolean;
};

/** Valid period values */
const VALID_PERIODS = ["1h", "24h", "7d", "14d", "30d"];

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
      "The organization and project are resolved from:\n" +
      "  1. --org and --project flags\n" +
      "  2. Config defaults\n" +
      "  3. SENTRY_DSN environment variable or source code detection",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "transaction",
          brief:
            'Transaction: index (1), alias (i), or full name ("/api/users")',
          parse: String,
        },
      ],
    },
    flags: {
      org: {
        kind: "parsed",
        parse: String,
        brief: "Organization slug",
        optional: true,
      },
      project: {
        kind: "parsed",
        parse: String,
        brief: "Project slug",
        optional: true,
      },
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
    transactionRef: string
  ): Promise<void> {
    const { stdout, cwd, setContext } = this;

    // Resolve org and project from flags or detection
    const target = await resolveOrgAndProject({
      org: flags.org,
      project: flags.project,
      cwd,
      usageHint: `sentry profile view "${transactionRef}" --org <org> --project <project>`,
    });

    if (!target) {
      throw new ContextError(
        "Organization and project",
        `sentry profile view "${transactionRef}" --org <org-slug> --project <project-slug>`
      );
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
