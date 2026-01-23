/**
 * sentry project view
 *
 * View detailed information about Sentry projects.
 * Supports monorepos with multiple detected projects.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { getProject } from "../../lib/api-client.js";
import { openInBrowser } from "../../lib/browser.js";
import { AuthError, ContextError } from "../../lib/errors.js";
import {
  divider,
  formatProjectDetails,
  writeJson,
  writeOutput,
} from "../../lib/formatters/index.js";
import {
  type ResolvedTarget,
  resolveAllTargets,
} from "../../lib/resolve-target.js";
import { buildProjectUrl } from "../../lib/sentry-urls.js";
import type { SentryProject } from "../../types/index.js";

type ViewFlags = {
  readonly org?: string;
  readonly json: boolean;
  readonly web: boolean;
};

/**
 * Build an error message for missing context, with optional DSN resolution hint.
 */
function buildContextError(skippedSelfHosted?: number): ContextError {
  const usageHint = "sentry project view <project-slug> --org <org-slug>";

  if (skippedSelfHosted) {
    return new ContextError(
      "Organization and project",
      `${usageHint}\n\n` +
        `Note: Found ${skippedSelfHosted} DSN(s) that could not be resolved.\n` +
        "You may not have access to these projects, or you can specify --org and --project explicitly."
    );
  }

  return new ContextError("Organization and project", usageHint);
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
      "sentry project view <project-slug> --org <org-slug> -w\n\n" +
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
 * Fetch project details for a single target.
 * Returns null on non-auth errors (e.g., no access to project).
 * Rethrows auth errors so they propagate to the user.
 */
async function fetchProjectDetails(
  target: ResolvedTarget
): Promise<SentryProject | null> {
  try {
    return await getProject(target.org, target.project);
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
  const validTargets: ResolvedTarget[] = [];

  for (let i = 0; i < results.length; i++) {
    const project = results[i];
    const target = targets[i];
    if (project && target) {
      projects.push(project);
      validTargets.push(target);
    }
  }

  return { projects, targets: validTargets };
}

/**
 * Write multiple project details with separators.
 */
function writeMultipleProjects(
  stdout: { write: (s: string) => void },
  projects: SentryProject[],
  targets: ResolvedTarget[]
): void {
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const target = targets[i];

    if (i > 0) {
      stdout.write(`\n${divider(60)}\n\n`);
    }

    if (project) {
      const details = formatProjectDetails(project);
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
      "The organization and project are resolved from:\n" +
      "  1. Positional argument <project-slug> and --org flag\n" +
      "  2. Config defaults\n" +
      "  3. SENTRY_DSN environment variable or source code detection\n\n" +
      "In monorepos with multiple Sentry projects, shows details for all detected projects.",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Project slug (optional if auto-detected)",
          parse: String,
          optional: true,
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
    projectSlug?: string
  ): Promise<void> {
    const { stdout, cwd } = this;

    // Resolve targets (may find multiple in monorepos)
    const {
      targets: resolvedTargets,
      footer,
      skippedSelfHosted,
    } = await resolveAllTargets({
      org: flags.org,
      project: projectSlug,
      cwd,
      usageHint: "sentry project view <project-slug> --org <org-slug>",
    });

    if (resolvedTargets.length === 0) {
      throw buildContextError(skippedSelfHosted);
    }

    if (flags.web) {
      await handleWebView(stdout, resolvedTargets);
      return;
    }

    // Fetch project details for all targets in parallel
    const { projects, targets } = await fetchAllProjectDetails(resolvedTargets);

    if (projects.length === 0) {
      throw buildContextError();
    }

    // JSON output - array if multiple, single object if one
    if (flags.json) {
      writeJson(stdout, projects.length === 1 ? projects[0] : projects);
      return;
    }

    // Human output
    const firstProject = projects[0];
    const firstTarget = targets[0];
    if (projects.length === 1 && firstProject) {
      writeOutput(stdout, firstProject, {
        json: false,
        formatHuman: formatProjectDetails,
        detectedFrom: firstTarget?.detectedFrom,
      });
    } else {
      writeMultipleProjects(stdout, projects, targets);
    }

    if (footer) {
      stdout.write(`\n${footer}\n`);
    }
  },
});
