/**
 * sentry project delete
 *
 * Permanently delete a Sentry project.
 *
 * ## Flow
 *
 * 1. Parse target arg → extract org/project (e.g., "acme/my-app" or "my-app")
 * 2. Verify the project exists via `getProject` (also displays its name)
 * 3. Prompt for confirmation (unless --yes is passed)
 * 4. Call `deleteProject` API
 * 5. Display result
 *
 * Safety measures:
 * - No auto-detect mode: requires explicit target to prevent accidental deletion
 * - Confirmation prompt with strict `confirmed !== true` check (Symbol(clack:cancel) gotcha)
 * - Refuses to run in non-interactive mode without --yes flag
 */

import { isatty } from "node:tty";
import type { SentryContext } from "../../context.js";
import { deleteProject, getProject } from "../../lib/api-client.js";
import {
  ProjectSpecificationType,
  parseOrgProjectArg,
} from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { ApiError, CliError, ContextError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { resolveProjectBySlug } from "../../lib/resolve-target.js";
import { buildProjectUrl } from "../../lib/sentry-urls.js";

const log = logger.withTag("project.delete");

/** Usage hint for error messages */
const USAGE_HINT = "sentry project delete <org>/<project>";

type DeleteFlags = {
  readonly yes: boolean;
  readonly "dry-run": boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

/**
 * Resolve the target argument into an org/project pair.
 *
 * Only explicit (`org/project`) and project-search (`project`) modes are
 * supported — auto-detect and org-all are rejected for safety.
 *
 * @param target - Raw positional argument from the CLI
 * @returns Resolved org and project slugs
 */
function resolveDeleteTarget(
  target: string
): Promise<{ org: string; project: string }> {
  const parsed = parseOrgProjectArg(target);

  switch (parsed.type) {
    case ProjectSpecificationType.Explicit:
      return Promise.resolve({ org: parsed.org, project: parsed.project });

    case ProjectSpecificationType.ProjectSearch:
      return resolveProjectBySlug(
        parsed.projectSlug,
        USAGE_HINT,
        `sentry project delete <org>/${parsed.projectSlug}`
      );

    case ProjectSpecificationType.OrgAll:
      throw new ContextError(
        "Specific project",
        `${USAGE_HINT}\n\n` +
          "Specify the full org/project target, not just the organization."
      );

    case ProjectSpecificationType.AutoDetect:
      throw new ContextError("Project target", USAGE_HINT, [
        "Auto-detection is disabled for delete — specify the target explicitly",
      ]);

    default: {
      const _exhaustive: never = parsed;
      throw new ContextError("Project", String(_exhaustive));
    }
  }
}

export const deleteCommand = buildCommand({
  docs: {
    brief: "Delete a project",
    fullDescription:
      "Permanently delete a Sentry project. This action cannot be undone.\n\n" +
      "Requires explicit target — auto-detection is disabled for safety.\n\n" +
      "Examples:\n" +
      "  sentry project delete acme-corp/my-app\n" +
      "  sentry project delete my-app\n" +
      "  sentry project delete acme-corp/my-app --yes\n" +
      "  sentry project delete acme-corp/my-app --dry-run",
  },
  output: "json",
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "org/project",
          brief: "<org>/<project> or <project> (search across orgs)",
          parse: String,
        },
      ],
    },
    flags: {
      yes: {
        kind: "boolean",
        brief: "Skip confirmation prompt",
        default: false,
      },
      "dry-run": {
        kind: "boolean",
        brief:
          "Validate inputs and show what would be deleted without deleting it",
        default: false,
      },
    },
    aliases: { y: "yes", n: "dry-run" },
  },
  async func(this: SentryContext, flags: DeleteFlags, target: string) {
    const { stdout } = this;
    const { org: orgSlug, project: projectSlug } =
      await resolveDeleteTarget(target);

    // Verify project exists before prompting — also used to display the project name
    const project = await getProject(orgSlug, projectSlug);

    // Dry-run mode: show what would be deleted without deleting it
    if (flags["dry-run"]) {
      if (flags.json) {
        stdout.write(
          `${JSON.stringify({ dryRun: true, org: orgSlug, project: project.slug, name: project.name, url: buildProjectUrl(orgSlug, project.slug) })}\n`
        );
      } else {
        stdout.write(
          `Would delete project '${project.name}' (${orgSlug}/${project.slug}).\n` +
            `  URL: ${buildProjectUrl(orgSlug, project.slug)}\n`
        );
      }
      return;
    }

    // Confirmation gate
    if (!flags.yes) {
      if (!isatty(0)) {
        throw new CliError(
          `Refusing to delete '${orgSlug}/${project.slug}' in non-interactive mode. Use --yes to confirm.`
        );
      }

      const confirmed = await log.prompt(
        `Delete project '${project.name}' (${orgSlug}/${project.slug})? This cannot be undone.`,
        { type: "confirm", initial: false }
      );

      // consola prompt returns Symbol(clack:cancel) on Ctrl+C — a truthy value.
      // Strictly check for `true` to avoid deleting on cancel.
      if (confirmed !== true) {
        stdout.write("Cancelled.\n");
        return;
      }
    }

    try {
      await deleteProject(orgSlug, project.slug);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        throw new ApiError(
          `Permission denied: You don't have permission to delete '${orgSlug}/${project.slug}'.\n\n` +
            "Project deletion requires the 'project:admin' scope.\n" +
            "  Re-authenticate:  sentry auth login",
          403,
          error.detail,
          error.endpoint
        );
      }
      throw error;
    }

    if (flags.json) {
      stdout.write(
        `${JSON.stringify({ deleted: true, org: orgSlug, project: project.slug })}\n`
      );
    } else {
      stdout.write(
        `Deleted project '${project.name}' (${orgSlug}/${project.slug}).\n`
      );
    }
  },
});
