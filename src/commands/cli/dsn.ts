/**
 * sentry cli dsn
 *
 * Inspect DSN discovery results for the current directory.
 * Shows what the CLI detects: project root, DSNs found, their sources,
 * and resolution status. Useful for debugging when auto-detection
 * doesn't work as expected.
 */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import type { DetectedDsn, DsnDetectionResult } from "../../lib/dsn/index.js";
import {
  detectAllDsns,
  findProjectRoot,
  getDsnSourceDescription,
  resolveProject,
} from "../../lib/dsn/index.js";
import { isAuthenticated } from "../../lib/db/auth.js";
import {
  colorTag,
  escapeMarkdownInline,
  mdKvTable,
  renderMarkdown,
  safeCodeSpan,
} from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";

type DsnFlags = {
  readonly fresh: boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

/**
 * Structured data for the DSN discovery command output.
 */
type DsnDiscoveryData = {
  /** Current working directory */
  cwd: string;
  /** Detected project root */
  projectRoot: {
    path: string;
    reason: string;
  };
  /** Scan details */
  scan: {
    /** Directories searched for DSNs (relative to project root) */
    dirs: string[];
    /** Number of source files checked */
    files: number;
  };
  /** SENTRY_DSN environment variable value (if set) */
  envVar: string | null;
  /** Number of DSNs found */
  count: number;
  /** All detected DSNs */
  dsns: Array<{
    /** Raw DSN string */
    dsn: string;
    /** Whether this is the primary DSN (the one commands like `sentry init` use) */
    primary: boolean;
    /** Where it was found */
    source: string;
    /** File path (relative) if from a file */
    sourcePath: string | null;
    /** Package path for monorepo grouping */
    packagePath: string | null;
    /** Human-readable source description */
    sourceDescription: string;
    /** Extracted project ID */
    projectId: string;
    /** Extracted org ID (SaaS only) */
    orgId: string | null;
    /** Cached resolution info if available */
    resolved: {
      orgSlug: string;
      projectSlug: string;
    } | null;
  }>;
  /** Whether multiple DSNs were found */
  hasMultiple: boolean;
  /** Detection fingerprint */
  fingerprint: string;
};

/** Mask the middle of a DSN's public key for display */
function maskDsnKey(dsn: string): string {
  return dsn.replace(
    /^(https?:\/\/)([a-z0-9]{4})[a-z0-9]+(@)/i,
    (_, proto, start, at) => `${proto}${start}****${at}`
  );
}

function formatDsnEntry(entry: DsnDiscoveryData["dsns"][number]): string {
  const lines: string[] = [];

  const rows: [string, string][] = [
    ["DSN", safeCodeSpan(maskDsnKey(entry.dsn))],
    ["Source", escapeMarkdownInline(entry.sourceDescription)],
  ];
  if (entry.packagePath) {
    rows.push(["Package", safeCodeSpan(entry.packagePath)]);
  }
  rows.push(["Project ID", safeCodeSpan(entry.projectId)]);
  if (entry.orgId) {
    rows.push(["Org ID", safeCodeSpan(entry.orgId)]);
  }
  if (entry.resolved) {
    rows.push([
      "Resolved",
      colorTag(
        "green",
        `${entry.resolved.orgSlug}/${entry.resolved.projectSlug}`
      ),
    ]);
  } else {
    rows.push(["Resolved", colorTag("muted", "(not yet resolved)")]);
  }

  lines.push(mdKvTable(rows));
  return lines.join("\n");
}

function formatDsnDiscovery(data: DsnDiscoveryData): string {
  const lines: string[] = [];

  // Project root
  lines.push("## Project root");
  lines.push("");
  lines.push(
    mdKvTable([
      ["Path", safeCodeSpan(data.projectRoot.path)],
      ["Reason", data.projectRoot.reason],
    ])
  );

  // Scan summary
  lines.push("## Scan");
  lines.push("");
  const dirCount = data.scan.dirs.length;
  const fileCount = data.scan.files;
  lines.push(
    `${dirCount} director${dirCount === 1 ? "y" : "ies"}, ${fileCount} file${fileCount === 1 ? "" : "s"} checked`
  );
  lines.push("");
  if (dirCount > 0) {
    const sortedDirs = [...data.scan.dirs].sort();
    for (const dir of sortedDirs) {
      lines.push(`- ${colorTag("muted", dir)}`);
    }
    lines.push("");
  }

  // Env var
  lines.push("## Environment");
  lines.push("");
  if (data.envVar) {
    lines.push(`SENTRY\\_DSN: ${safeCodeSpan(maskDsnKey(data.envVar))}`);
  } else {
    lines.push(`SENTRY\\_DSN: ${colorTag("muted", "(not set)")}`);
  }
  lines.push("");

  // DSNs
  if (data.count === 0) {
    lines.push(colorTag("yellow", "No DSNs found"));
    lines.push("");
    lines.push("The CLI looks for DSNs in:");
    lines.push("1. Source code (Sentry.init calls, DSN strings)");
    lines.push("2. .env files (SENTRY\\_DSN=...)");
    lines.push("3. SENTRY\\_DSN environment variable");
    lines.push("");
    lines.push(
      `Searched from ${safeCodeSpan(data.cwd)} up to ${safeCodeSpan(data.projectRoot.path)}`
    );
  } else {
    lines.push(`## Found ${data.count} DSN${data.count > 1 ? "s" : ""}`);
    for (const [i, entry] of data.dsns.entries()) {
      lines.push("");
      if (data.count > 1) {
        const primaryTag = entry.primary
          ? ` ${colorTag("green", "(primary)")}`
          : "";
        lines.push(`### ${i + 1}.${primaryTag}`);
        lines.push("");
      }
      lines.push(formatDsnEntry(entry));
    }
  }

  return renderMarkdown(lines.join("\n"));
}

function mapDsn(
  dsn: DetectedDsn,
  primaryRaw: string | null
): DsnDiscoveryData["dsns"][number] {
  return {
    dsn: dsn.raw,
    primary: dsn.raw === primaryRaw,
    source: dsn.source,
    sourcePath: dsn.sourcePath ?? null,
    packagePath: dsn.packagePath ?? null,
    sourceDescription: getDsnSourceDescription(dsn),
    projectId: dsn.projectId,
    orgId: dsn.orgId ?? null,
    resolved: dsn.resolved
      ? {
          orgSlug: dsn.resolved.orgSlug,
          projectSlug: dsn.resolved.projectSlug,
        }
      : null,
  };
}

export const dsnCommand = buildCommand({
  auth: false,
  docs: {
    brief: "Inspect DSN discovery for the current directory",
    fullDescription:
      "Run the DSN discovery process and display detailed results.\n\n" +
      "Shows the project root detection, environment variable state, and all\n" +
      "DSNs found across source code, .env files, and environment variables.\n\n" +
      "This is useful for debugging when the CLI can't auto-detect your project:\n\n" +
      "  sentry cli dsn              # Inspect discovery results\n" +
      "  sentry cli dsn --fresh      # Bypass cache, re-scan everything\n" +
      "  sentry cli dsn --json       # Machine-readable output",
  },
  output: {
    human: formatDsnDiscovery,
    jsonExclude: ["sourceDescription"],
  },
  parameters: {
    flags: {
      fresh: FRESH_FLAG,
    },
    aliases: FRESH_ALIASES,
  },
  async *func(this: SentryContext, flags: DsnFlags) {
    applyFreshFlag(flags);
    const { cwd } = this;

    // Run project root detection and full DSN scan in parallel
    const [rootResult, detection] = await Promise.all([
      findProjectRoot(cwd),
      detectAllDsns(cwd),
    ]);

    // Try to resolve DSNs to org/project names when authenticated
    if (isAuthenticated()) {
      await Promise.all(
        detection.all.map(async (dsn) => {
          if (dsn.resolved) {
            return;
          }
          try {
            const resolved = await resolveProject(cwd, dsn);
            dsn.resolved = {
              orgSlug: resolved.orgSlug,
              orgName: resolved.orgName,
              projectSlug: resolved.projectSlug,
              projectName: resolved.projectName,
            };
          } catch {
            // Resolution failed (no access, self-hosted, etc.) — skip
          }
        })
      );
    }

    const data: DsnDiscoveryData = {
      cwd,
      projectRoot: {
        path: rootResult.projectRoot,
        reason: rootResult.reason,
      },
      scan: {
        dirs: detection.scannedDirs ?? [],
        files: detection.filesScanned ?? 0,
      },
      envVar: process.env.SENTRY_DSN ?? null,
      count: detection.all.length,
      dsns: detection.all.map((d) => mapDsn(d, detection.primary?.raw ?? null)),
      hasMultiple: detection.hasMultiple,
      fingerprint: detection.fingerprint,
    };

    yield new CommandOutput(data);

    if (detection.hasMultiple) {
      return {
        hint: "The primary DSN is the one used by commands like `sentry init` and `sentry project view`.\nOther DSNs are visible here for debugging but won't be used unless specified explicitly.",
      };
    }
  },
});
