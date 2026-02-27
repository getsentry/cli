/**
 * sentry project view
 *
 * View detailed information about Sentry projects.
 * Supports monorepos with multiple detected projects.
 */

import type { SentryContext } from "../../context.js";
import { getProject, getProjectKeys } from "../../lib/api-client.js";
import {
  ProjectSpecificationType,
  parseOrgProjectArg,
} from "../../lib/arg-parsing.js";
import { openInBrowser } from "../../lib/browser.js";
import { buildCommand } from "../../lib/command.js";
import { AuthError, ContextError } from "../../lib/errors.js";
import {
  divider,
  formatProjectDetails,
  writeJson,
  writeOutput,
} from "../../lib/formatters/index.js";
import { TARGET_PATTERN_NOTE } from "../../lib/list-command.js";
import {
  type ResolvedTarget,
  resolveAllTargets,
  resolveProjectBySlug,
} from "../../lib/resolve-target.js";
import { buildProjectUrl } from "../../lib/sentry-urls.js";
import type { ProjectKey, SentryProject } from "../../types/index.js";

type ViewFlags = {
  readonly json: boolean;
  readonly web: boolean;
};

/** Usage hint for ContextError messages */
const USAGE_HINT = "sentry project view <org>/<project>";

/**
 * Build an error message for missing context, with optional DSN resolution hint.
 */
function buildContextError(skippedSelfHosted?: number): ContextError {
  if (skippedSelfHosted) {
    return new ContextError(
      "Organization and project",
      `${USAGE_HINT}\n\n` +
        `Note: Found ${skippedSelfHosted} DSN(s) that could not be resolved.\n` +
        "You may not have access to these projects, or specify the target explicitly."
    );
  }

  return new ContextError("Organization and project", USAGE_HINT);
}

/**
 * Handle --web flag: open a single project in browser.
 * Throws if multiple targets are found.
 */
async function handleWebView(
  stdout: { write: (s: string) => void },
  resolvedTargets: ResolvedTarget[]
): Promise<void> {
  if (resolvedTargets.length > 1) {
    throw new ContextError(
      "Single project",
      `${USAGE_HINT} -w\n\n` +
        `Found ${resolvedTargets.length} projects. Specify which project to open in browser.`
    );
  }

  const target = resolvedTargets[0];
  await openInBrowser(
    stdout,
    target ? buildProjectUrl(target.org, target.project) : undefined,
    "project"
  );
}

/**
 * Try to fetch project keys, returning null on any error.
 * Non-blocking - if keys fetch fails, we still display project info.
 */
async function tryGetProjectKeys(
  orgSlug: string,
  projectSlug: string
): Promise<ProjectKey[] | null> {
  try {
    return await getProjectKeys(orgSlug, projectSlug);
  } catch {
    return null;
  }
}

/**
 * Get the primary DSN from project keys.
 * Returns the first active key's public DSN, or null if none found.
 */
function getPrimaryDsn(keys: ProjectKey[] | null): string | null {
  if (!keys || keys.length === 0) {
    return null;
  }
  const activeKey = keys.find((k) => k.isActive);
  return activeKey?.dsn.public ?? keys[0]?.dsn.public ?? null;
}

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
  try {
    // Fetch project and keys in parallel
    const [project, keys] = await Promise.all([
      getProject(target.org, target.project),
      tryGetProjectKeys(target.org, target.project),
    ]);
    return { project, dsn: getPrimaryDsn(keys) };
  } catch (error) {
    // Rethrow auth errors - user needs to know they're not authenticated
    if (error instanceof AuthError) {
      throw error;
    }
    // Silently skip other errors (e.g., no access to specific project)
    return null;
  }
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
 * Write multiple project details with separators.
 */
function writeMultipleProjects(
  stdout: { write: (s: string) => void },
  projects: SentryProject[],
  dsns: (string | null)[],
  targets: ResolvedTarget[]
): void {
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const dsn = dsns[i];
    const target = targets[i];

    if (i > 0) {
      stdout.write(`\n${divider(60)}\n\n`);
    }

    if (project) {
      const details = formatProjectDetails(project, dsn);
      stdout.write(details.join("\n"));
      stdout.write("\n");
      if (target?.detectedFrom) {
        stdout.write(`\nDetected from: ${target.detectedFrom}\n`);
      }
    }
  }
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
    aliases: { w: "web" },
  },
  async func(
    this: SentryContext,
    flags: ViewFlags,
    targetArg?: string
  ): Promise<void> {
    const { stdout, cwd } = this;

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
          `sentry project view <org>/${parsed.projectSlug}`,
          this.stderr
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
          `${USAGE_HINT}\n\n` +
            "Specify the full org/project target, not just the organization."
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
      await handleWebView(stdout, resolvedTargets);
      return;
    }

    // Fetch project details for all targets in parallel
    const { projects, dsns, targets } =
      await fetchAllProjectDetails(resolvedTargets);

    if (projects.length === 0) {
      throw buildContextError();
    }

    // JSON output - array if multiple, single object if one
    if (flags.json) {
      // Add dsn field to JSON output
      const projectsWithDsn = projects.map((p, i) => ({
        ...p,
        dsn: dsns[i] ?? null,
      }));
      writeJson(
        stdout,
        projectsWithDsn.length === 1 ? projectsWithDsn[0] : projectsWithDsn
      );
      return;
    }

    // Human output
    const firstProject = projects[0];
    const firstDsn = dsns[0];
    const firstTarget = targets[0];
    if (projects.length === 1 && firstProject) {
      writeOutput(stdout, firstProject, {
        json: false,
        formatHuman: (p: SentryProject) => formatProjectDetails(p, firstDsn),
        detectedFrom: firstTarget?.detectedFrom,
      });
    } else {
      writeMultipleProjects(stdout, projects, dsns, targets);
    }

    if (footer) {
      stdout.write(`\n${footer}\n`);
    }
  },
});
