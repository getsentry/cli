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
import { CliError, ContextError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { resolveProjectBySlug } from "../../lib/resolve-target.js";

const log = logger.withTag("project.delete");

/** Usage hint for error messages */
const USAGE_HINT = "sentry project delete <org>/<project>";

type DeleteFlags = {
  readonly yes: boolean;
  readonly json: boolean;
  readonly fields?: string[];
};

export const deleteCommand = buildCommand({
  docs: {
    brief: "Delete a project",
    fullDescription:
      "Permanently delete a Sentry project. This action cannot be undone.\n\n" +
      "Requires explicit target — auto-detection is disabled for safety.\n\n" +
      "Examples:\n" +
      "  sentry project delete acme-corp/my-app\n" +
      "  sentry project delete my-app\n" +
      "  sentry project delete acme-corp/my-app --yes",
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
    },
    aliases: { y: "yes" },
  },
  async func(this: SentryContext, flags: DeleteFlags, target: string) {
    const { stdout } = this;
    const parsed = parseOrgProjectArg(target);

    let orgSlug: string;
    let projectSlug: string;

    switch (parsed.type) {
      case ProjectSpecificationType.Explicit:
        orgSlug = parsed.org;
        projectSlug = parsed.project;
        break;

      case ProjectSpecificationType.ProjectSearch: {
        const resolved = await resolveProjectBySlug(
          parsed.projectSlug,
          USAGE_HINT,
          `sentry project delete <org>/${parsed.projectSlug}`
        );
        orgSlug = resolved.org;
        projectSlug = resolved.project;
        break;
      }

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

    // Verify project exists before prompting — also used to display the project name
    const project = await getProject(orgSlug, projectSlug);

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

    await deleteProject(orgSlug, project.slug);

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
