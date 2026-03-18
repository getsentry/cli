/**
 * sentry project view
 *
 * View detailed information about Sentry projects.
 * Supports monorepos with multiple detected projects.
 */

import type { SentryContext } from "../../context.js";
import { getProject, tryGetPrimaryDsn } from "../../lib/api-client.js";
import {
  ProjectSpecificationType,
  parseOrgProjectArg,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError, withAuthGuard } from "../../lib/errors.js";
import { divider, formatProjectDetails } from "../../lib/formatters/index.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
  TARGET_PATTERN_NOTE,
} from "../../lib/list-command.js";
import {
  type ResolvedTarget,
  resolveAllTargets,
  resolveProjectBySlug,
} from "../../lib/resolve-target.js";
import { buildProjectUrl } from "../../lib/sentry-urls.js";
import type { SentryProject } from "../../types/index.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
  readonly fresh: boolean;
  readonly fields?: string[];
};

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry project view <org>/<project>";

/**
 * Build an error message for missing context, with optional DSN resolution hint.
 */
function buildContextError(skippedSelfHosted?: number): ContextError {
  if (skippedSelfHosted) {
    return new ContextError("Organization and project", USAGE_HINT, [
      "Run from a directory with a Sentry-configured project",
      "Set SENTRY_ORG and SENTRY_PROJECT (or SENTRY_DSN) environment variables",
      `Found ${skippedSelfHosted} DSN(s) that could not be resolved — you may not have access to these projects`,
    ]);
  }

  return new ContextError("Organization and project", USAGE_HINT);
}

/**
 * Handle --web flag: open a single project in browser.
 * Throws if multiple targets are found.
 */
async function handleWebView(resolvedTargets: ResolvedTarget[]): Promise<void> {
  if (resolvedTargets.length > 1) {
    throw new ContextError("Single project", `${USAGE_HINT} -w`, [
      `Found ${resolvedTargets.length} projects — specify which project to open in browser`,
    ]);
  }

  const target = resolvedTargets[0];
  await openInBrowser(
    target ? buildProjectUrl(target.org, target.project) : undefined,
    "project"
  );
}

/**
 * A project entry enriched with its DSN and optional detection source.
 * This is the data shape returned by the command for both JSON and human output.
 */
type ProjectViewEntry = SentryProject & {
  /** Primary DSN for the project, or null if unavailable */
  dsn: string | null;
  /** Where the project was auto-detected from (e.g. ".env", "source code") */
  detectedFrom?: string;
};

/** Result of fetching a single project with its DSN */
type ProjectWithDsn = {
  project: SentryProject;
  dsn: string | null;
};

/**
 * Fetch project details and keys for a single target.
 * Returns null on non-auth errors (e.g., no access to project).
 * Rethrows auth errors so they propagate to the user.
 */
async function fetchProjectDetails(
  target: ResolvedTarget
): Promise<ProjectWithDsn | null> {
  const result = await withAuthGuard(async () => {
    // Fetch project and DSN in parallel
    const [project, dsn] = await Promise.all([
      getProject(target.org, target.project),
      tryGetPrimaryDsn(target.org, target.project),
    ]);
    return { project, dsn };
  });
  return result.ok ? result.value : null;
}

/** Result of fetching project details for multiple targets */
type FetchResult = {
  projects: SentryProject[];
  dsns: (string | null)[];
  targets: ResolvedTarget[];
};

/**
 * Fetch project details for all targets in parallel.
 * Filters out failed fetches while preserving target association.
 */
async function fetchAllProjectDetails(
  targets: ResolvedTarget[]
): Promise<FetchResult> {
  const results = await Promise.all(targets.map(fetchProjectDetails));

  const projects: SentryProject[] = [];
  const dsns: (string | null)[] = [];
  const validTargets: ResolvedTarget[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const target = targets[i];
    if (result && target) {
      projects.push(result.project);
      dsns.push(result.dsn);
      validTargets.push(target);
    }
  }

  return { projects, dsns, targets: validTargets };
}

/**
 * Format project view entries for human-readable terminal output.
 *
 * Renders each project's details with dividers between multiple projects,
 * and appends detection source information when available.
 */
function formatProjectViewHuman(entries: ProjectViewEntry[]): string {
  const parts: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) {
      continue;
    }

    if (i > 0) {
      parts.push(`\n${divider(60)}\n`);
    }

    parts.push(formatProjectDetails(entry, entry.dsn));
    if (entry.detectedFrom) {
      parts.push(`\nDetected from: ${entry.detectedFrom}`);
    }
  }

  return parts.join("\n");
}

export const viewCommand = buildCommand({
  docs: {
    brief: "View details of a project",
    fullDescription:
      "View detailed information about Sentry projects.\n\n" +
      "Target patterns:\n" +
      "  sentry project view                       # auto-detect from DSN or config\n" +
      "  sentry project view <org>/<project>       # explicit org and project\n" +
      "  sentry project view <project>             # find project across all orgs\n\n" +
      `${TARGET_PATTERN_NOTE}\n\n` +
      "In monorepos with multiple Sentry projects, shows details for all detected projects.",
  },
  output: {
    renderHuman: formatProjectViewHuman,
    jsonExclude: ["detectedFrom"],
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/project",
          brief: "<org>/<project>, <project> (search), or omit for auto-detect",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      web: {
        kind: "boolean",
        brief: "Open in browser",
        default: false,
      },
      fresh: FRESH_FLAG,
    },
    aliases: { ...FRESH_ALIASES, w: "web" },
  },
  async *func(this: SentryContext, flags: ViewFlags, targetArg?: string) {
    applyFreshFlag(flags);
    const { cwd } = this;

    const parsed = parseOrgProjectArg(targetArg);

    let resolvedTargets: ResolvedTarget[];
    let footer: string | undefined;

    switch (parsed.type) {
      case ProjectSpecificationType.Explicit:
        // Direct org/project - single target, no multi-target resolution
        resolvedTargets = [
          {
            org: parsed.org,
            project: parsed.project,
            orgDisplay: parsed.org,
            projectDisplay: parsed.project,
          },
        ];
        break;

      case ProjectSpecificationType.ProjectSearch: {
        // Search for project across all orgs - single target
        const resolved = await resolveProjectBySlug(
          parsed.projectSlug,
          USAGE_HINT,
          `sentry project view <org>/${parsed.projectSlug}`
        );
        resolvedTargets = [
          {
            ...resolved,
            orgDisplay: resolved.org,
            projectDisplay: resolved.project,
          },
        ];
        break;
      }

      case ProjectSpecificationType.OrgAll:
        throw new ContextError(
          "Specific project",
          `sentry project view ${parsed.org}/<project>`,
          ["Specify the full org/project target, not just the organization"]
        );

      case ProjectSpecificationType.AutoDetect: {
        // Auto-detect supports monorepo multi-target resolution
        const result = await resolveAllTargets({ cwd });

        if (result.targets.length === 0) {
          throw buildContextError(result.skippedSelfHosted);
        }

        resolvedTargets = result.targets;
        footer = result.footer;
        break;
      }

      default:
        throw new ContextError("Organization and project", USAGE_HINT);
    }

    if (flags.web) {
      await handleWebView(resolvedTargets);
      return;
    }

    // Fetch project details for all targets in parallel
    const { projects, dsns, targets } =
      await fetchAllProjectDetails(resolvedTargets);

    if (projects.length === 0) {
      throw buildContextError();
    }

    // Build enriched entries array — always an array for consistent JSON shape
    const entries: ProjectViewEntry[] = projects.map((p, i) => ({
      ...p,
      dsn: dsns[i] ?? null,
      detectedFrom: targets[i]?.detectedFrom,
    }));

    yield new CommandOutput(entries);
    return { hint: footer };
  },
});
