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
import {
  deleteProject,
  getOrganization,
  getProject,
} from "../../lib/api-client.js";
import { parseOrgProjectArg } from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { ApiError, CliError, ContextError } from "../../lib/errors.js";
import {
  formatProjectDeleted,
  type ProjectDeleteResult,
} from "../../lib/formatters/human.js";
import { logger } from "../../lib/logger.js";
import { resolveOrgProjectTarget } from "../../lib/resolve-target.js";
import { buildProjectUrl } from "../../lib/sentry-urls.js";

const log = logger.withTag("project.delete");

/** Command name used in error messages and resolution hints */
const COMMAND_NAME = "project delete";

/**
 * Prompt for confirmation before deleting a project.
 *
 * Throws in non-interactive mode without --yes. Returns true if confirmed,
 * false if the user cancels.
 *
 * @param orgSlug - Organization slug for display
 * @param project - Project with slug and name for display
 * @returns true if confirmed, false if cancelled
 */
async function confirmDeletion(
  orgSlug: string,
  project: { slug: string; name: string }
): Promise<boolean> {
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
  return confirmed === true;
}

/**
 * Build an actionable 403 error by checking the user's org role.
 *
 * - member/billing → tell them they need a higher role
 * - manager/owner/admin → suggest re-authenticating (likely token scope)
 * - unknown/fetch failure → generic message covering both cases
 */
async function buildPermissionError(
  orgSlug: string,
  projectSlug: string
): Promise<ApiError> {
  const label = `'${orgSlug}/${projectSlug}'`;
  const rolesWithAccess = "Manager, Owner, or Team Admin";

  let orgRole: string | undefined;
  try {
    const org = await getOrganization(orgSlug);
    orgRole = (org as Record<string, unknown>).orgRole as string | undefined;
  } catch {
    // Best-effort — fall through to generic message
  }

  if (orgRole && ["member", "billing"].includes(orgRole)) {
    return new ApiError(
      `Permission denied: You don't have permission to delete ${label}.\n\n` +
        `Your organization role is '${orgRole}'. ` +
        `Project deletion requires ${rolesWithAccess} role.\n` +
        "  Ask an org admin to change your role or delete the project for you.",
      403
    );
  }

  if (orgRole && ["manager", "owner", "admin"].includes(orgRole)) {
    return new ApiError(
      `Permission denied: You don't have permission to delete ${label}.\n\n` +
        `Your org role ('${orgRole}') should allow this. ` +
        "Your auth token may be missing the 'project:admin' scope.\n" +
        "  Re-authenticate:  sentry auth login",
      403
    );
  }

  return new ApiError(
    `Permission denied: You don't have permission to delete ${label}.\n\n` +
      `This requires ${rolesWithAccess} role, or a token with the 'project:admin' scope.\n` +
      `  Check your role:   sentry org view ${orgSlug}\n` +
      "  Re-authenticate:   sentry auth login",
    403
  );
}

/** Build a result object for both dry-run and actual deletion */
function buildResult(
  orgSlug: string,
  project: { slug: string; name: string },
  dryRun?: boolean
): ProjectDeleteResult {
  return {
    orgSlug,
    projectSlug: project.slug,
    projectName: project.name,
    url: buildProjectUrl(orgSlug, project.slug),
    dryRun,
  };
}

type DeleteFlags = {
  readonly yes: boolean;
  readonly "dry-run": boolean;
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
      "  sentry project delete acme-corp/my-app --yes\n" +
      "  sentry project delete acme-corp/my-app --dry-run",
  },
  output: {
    json: true,
    human: formatProjectDeleted,
    jsonTransform: (result: ProjectDeleteResult) => {
      if (result.dryRun) {
        return {
          dryRun: true,
          org: result.orgSlug,
          project: result.projectSlug,
          name: result.projectName,
          url: result.url,
        };
      }
      return {
        deleted: true,
        org: result.orgSlug,
        project: result.projectSlug,
      };
    },
  },
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
    const { stdout, cwd } = this;

    // Block auto-detect for safety — destructive commands require explicit targets
    const parsed = parseOrgProjectArg(target);
    if (parsed.type === "auto-detect") {
      throw new ContextError(
        "Project target",
        `sentry ${COMMAND_NAME} <org>/<project>`,
        [
          "Auto-detection is disabled for delete — specify the target explicitly",
        ]
      );
    }

    const { org: orgSlug, project: projectSlug } =
      await resolveOrgProjectTarget(parsed, cwd, COMMAND_NAME);

    // Verify project exists before prompting — also used to display the project name
    const project = await getProject(orgSlug, projectSlug);

    // Dry-run mode: show what would be deleted without deleting it
    if (flags["dry-run"]) {
      return { data: buildResult(orgSlug, project, true) };
    }

    // Confirmation gate
    if (!flags.yes) {
      const confirmed = await confirmDeletion(orgSlug, project);
      if (!confirmed) {
        stdout.write("Cancelled.\n");
        return;
      }
    }

    try {
      await deleteProject(orgSlug, project.slug);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        throw await buildPermissionError(orgSlug, project.slug);
      }
      throw error;
    }

    return { data: buildResult(orgSlug, project) };
  },
});
