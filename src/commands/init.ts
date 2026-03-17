/**
 * sentry init
 *
 * Initialize Sentry in a project using the remote wizard workflow.
 * Communicates with the Mastra API via suspend/resume to perform
 * local filesystem operations and interactive prompts.
 *
 * Supports two optional positionals with smart disambiguation:
 *   sentry init                       — auto-detect everything, dir = cwd
 *   sentry init .                     — dir = cwd, auto-detect org
 *   sentry init ./subdir              — dir = subdir, auto-detect org
 *   sentry init acme/                 — explicit org, dir = cwd
 *   sentry init acme/my-app           — explicit org + project, dir = cwd
 *   sentry init my-app                — search for project across orgs
 *   sentry init acme/ ./subdir        — explicit org, dir = subdir
 *   sentry init acme/my-app ./subdir  — explicit org + project, dir = subdir
 *   sentry init ./subdir acme/        — swapped, auto-correct with warning
 */

import path from "node:path";
import type { SentryContext } from "../context.js";
import { listOrganizations } from "../lib/api-client.js";
import { looksLikePath, parseOrgProjectArg } from "../lib/arg-parsing.js";
import { buildCommand } from "../lib/command.js";
import { ContextError } from "../lib/errors.js";
import type { BgOrgDetection } from "../lib/init/types.js";
import { runWizard } from "../lib/init/wizard-runner.js";
import { validateResourceId } from "../lib/input-validation.js";
import { logger } from "../lib/logger.js";
import { resolveOrg, resolveProjectBySlug } from "../lib/resolve-target.js";

const log = logger.withTag("init");

const FEATURE_DELIMITER = /[,+ ]+/;

const USAGE_HINT = "sentry init <org>/<project> [directory]";

type InitFlags = {
  readonly yes: boolean;
  readonly "dry-run": boolean;
  readonly features?: string[];
  readonly team?: string;
};

/**
 * Classify and separate two optional positional args into a target and a directory.
 *
 * Uses {@link looksLikePath} to distinguish filesystem paths from org/project targets.
 * Detects swapped arguments and emits a warning when auto-correcting.
 *
 * @returns Resolved target string (or undefined) and directory string (or undefined)
 */
function classifyArgs(
  first?: string,
  second?: string
): { target: string | undefined; directory: string | undefined } {
  // No args — auto-detect everything
  if (!first) {
    return { target: undefined, directory: undefined };
  }

  const firstIsPath = looksLikePath(first);

  // Single arg
  if (!second) {
    return firstIsPath
      ? { target: undefined, directory: first }
      : { target: first, directory: undefined };
  }

  const secondIsPath = looksLikePath(second);

  // Two paths → error
  if (firstIsPath && secondIsPath) {
    throw new ContextError("Arguments", USAGE_HINT, [
      "Two directory paths provided. Only one directory is allowed.",
    ]);
  }

  // Two targets → error
  if (!(firstIsPath || secondIsPath)) {
    throw new ContextError("Arguments", USAGE_HINT, [
      "Two targets provided. Use <org>/<project> for the target and a path (e.g., ./dir) for the directory.",
    ]);
  }

  // (TARGET, PATH) — correct order
  if (!firstIsPath && secondIsPath) {
    return { target: first, directory: second };
  }

  // (PATH, TARGET) — swapped, auto-correct with warning
  log.warn(`Arguments appear reversed. Interpreting as: ${second} ${first}`);
  return { target: second, directory: first };
}

/**
 * Resolve the parsed org/project target into explicit org and project values.
 *
 * For `project-search` (bare slug), calls {@link resolveProjectBySlug} to search
 * across all accessible orgs and determine both org and project from the match.
 */
async function resolveTarget(targetArg: string | undefined): Promise<{
  org: string | undefined;
  project: string | undefined;
}> {
  const parsed = parseOrgProjectArg(targetArg);

  switch (parsed.type) {
    case "explicit":
      // Validate user-provided slugs before they reach API calls
      validateResourceId(parsed.org, "organization slug");
      validateResourceId(parsed.project, "project name");
      return { org: parsed.org, project: parsed.project };
    case "org-all":
      validateResourceId(parsed.org, "organization slug");
      return { org: parsed.org, project: undefined };
    case "project-search": {
      // Bare slug — search for a project with this name across all orgs.
      // resolveProjectBySlug handles not-found, ambiguity, and org-name-collision errors.
      const resolved = await resolveProjectBySlug(
        parsed.projectSlug,
        USAGE_HINT,
        `sentry init ${parsed.projectSlug}/ (if '${parsed.projectSlug}' is an org)`
      );
      return { org: resolved.org, project: resolved.project };
    }
    case "auto-detect":
      return { org: undefined, project: undefined };
    default: {
      const _exhaustive: never = parsed;
      throw new ContextError("Target", String(_exhaustive));
    }
  }
}

export const initCommand = buildCommand<
  InitFlags,
  [string?, string?],
  SentryContext
>({
  docs: {
    brief: "Initialize Sentry in your project",
    fullDescription:
      "Runs the Sentry setup wizard to detect your project's framework, " +
      "install the SDK, and configure Sentry.\n\n" +
      "Supports org/project syntax and a directory positional. Path-like\n" +
      "arguments (starting with . / ~) are treated as the directory;\n" +
      "everything else is treated as the target.\n\n" +
      "Examples:\n" +
      "  sentry init\n" +
      "  sentry init acme/\n" +
      "  sentry init acme/my-app\n" +
      "  sentry init my-app\n" +
      "  sentry init acme/my-app ./my-project\n" +
      "  sentry init ./my-project",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          placeholder: "target",
          brief: "<org>/<project>, <org>/, <project>, or a directory path",
          parse: String,
          optional: true,
        },
        {
          placeholder: "directory",
          brief: "Project directory (default: current directory)",
          parse: String,
          optional: true,
        },
      ],
    },
    flags: {
      yes: {
        kind: "boolean",
        brief: "Non-interactive mode (accept defaults)",
        default: false,
      },
      "dry-run": {
        kind: "boolean",
        brief: "Preview changes without applying them",
        default: false,
      },
      features: {
        kind: "parsed",
        parse: String,
        brief:
          "Features to enable: errors,tracing,logs,replay,metrics,profiling,sourcemaps,crons,ai-monitoring,user-feedback",
        variadic: true,
        optional: true,
      },
      team: {
        kind: "parsed",
        parse: String,
        brief: "Team slug to create the project under",
        optional: true,
      },
    },
    aliases: {
      y: "yes",
      t: "team",
    },
  },
  async *func(
    this: SentryContext,
    flags: InitFlags,
    first?: string,
    second?: string
  ) {
    // 1. Classify positionals into target vs directory
    const { target: targetArg, directory: dirArg } = classifyArgs(
      first,
      second
    );

    // 2. Resolve directory
    const targetDir = dirArg ? path.resolve(this.cwd, dirArg) : this.cwd;

    // 3. Parse features
    const featuresList = flags.features
      ?.flatMap((f) => f.split(FEATURE_DELIMITER))
      .map((f) => f.trim())
      .filter(Boolean);

    // 4. Resolve target → org + project
    //    Validation of user-provided slugs happens inside resolveTarget.
    //    API-resolved values (from resolveProjectBySlug) are already valid.
    const { org: explicitOrg, project: explicitProject } =
      await resolveTarget(targetArg);

    // 5. Start background org detection when org is not yet known.
    //    These promises run concurrently with the preamble user-interaction
    //    (experimental confirm, git status check) so the results are ready
    //    by the time the wizard needs to create a Sentry project.
    let bgOrgDetection: BgOrgDetection | undefined;
    if (!explicitOrg) {
      bgOrgDetection = {
        orgPromise: resolveOrg({ cwd: targetDir }).catch(() => null),
        orgListPromise: listOrganizations().catch(() => []),
      };
    }

    // 6. Run the wizard
    await runWizard({
      directory: targetDir,
      yes: flags.yes,
      dryRun: flags["dry-run"],
      features: featuresList,
      team: flags.team,
      org: explicitOrg,
      project: explicitProject,
      bgOrgDetection,
    });
  },
});
