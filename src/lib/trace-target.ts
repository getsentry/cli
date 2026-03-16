/**
 * Shared Trace-Target Parsing & Resolution
 *
 * Provides a unified abstraction for commands that accept trace IDs
 * with optional org/project context. Trace IDs are globally unique,
 * so these formats are all supported:
 *
 * - `<trace-id>` — auto-detect org/project from DSN/config
 * - `<org>/<trace-id>` — org-scoped (for org-only APIs like trace-logs)
 * - `<org>/<project>/<trace-id>` — fully explicit
 *
 * Also handles two-arg forms:
 * - `<org>/<project> <trace-id>` — target as first arg, trace ID as second
 * - `<org> <trace-id>` — org as first arg, trace ID as second
 *
 * Used by: span list, span view, trace view, trace logs.
 */

import { normalizeSlug, parseOrgProjectArg } from "./arg-parsing.js";
import { ContextError, ValidationError } from "./errors.js";
import { logger } from "./logger.js";
import {
  resolveOrg,
  resolveOrgAndProject,
  resolveProjectBySlug,
} from "./resolve-target.js";
import { validateTraceId } from "./trace-id.js";

/** Match `[<prefix>]<id>` in usageHint for generating suggestions */
const USAGE_BRACKET_RE = /\[.*\]/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parsed result from trace-related positional arguments.
 * Discriminated union based on the `type` field.
 *
 * Unlike `ParsedOrgProject`, the `traceId` is always present
 * because it's the mandatory identifier for all trace commands.
 */
export type ParsedTraceTarget =
  | {
      type: "explicit";
      traceId: string;
      org: string;
      project: string;
      /** True if any slug was normalized (underscores → dashes) */
      normalized?: boolean;
    }
  | {
      type: "org-scoped";
      traceId: string;
      org: string;
      /** True if org slug was normalized */
      normalized?: boolean;
    }
  | {
      type: "project-search";
      traceId: string;
      projectSlug: string;
      /** True if slug was normalized */
      normalized?: boolean;
    }
  | {
      type: "auto-detect";
      traceId: string;
    };

/** Resolved trace target with both org and project. */
export type ResolvedTraceOrgProject = {
  traceId: string;
  org: string;
  project: string;
};

/** Resolved trace target with org only. */
export type ResolvedTraceOrg = {
  traceId: string;
  org: string;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse trace-related positional arguments into a {@link ParsedTraceTarget}.
 *
 * **Single argument (slash-separated):**
 * - `<trace-id>` → auto-detect
 * - `<org>/<trace-id>` → org-scoped
 * - `<org>/<project>/<trace-id>` → explicit
 *
 * **Two arguments (space-separated):**
 * - `<org>/<project> <trace-id>` → explicit
 * - `<org> <trace-id>` → project-search (bare slug)
 *
 * Extra positional arguments beyond the first two are ignored with a
 * warning, matching the established pattern across CLI commands.
 *
 * @param args - Positional arguments from CLI
 * @param usageHint - Usage example for error messages
 * @returns Parsed trace target with type discrimination
 * @throws {ContextError} If no arguments are provided
 * @throws {ValidationError} If the trace ID format is invalid
 */
export function parseTraceTarget(
  args: string[],
  usageHint: string
): ParsedTraceTarget {
  if (args.length === 0) {
    throw new ContextError("Trace ID", usageHint);
  }

  const first = args[0];
  if (first === undefined) {
    throw new ContextError("Trace ID", usageHint);
  }

  // Warn about extra positional args that will be ignored
  if (args.length > 2) {
    const log = logger.withTag("trace-target");
    log.warn(
      `Extra arguments ignored: ${args.slice(2).join(" ")}. Expected: ${usageHint}`
    );
  }

  if (args.length === 1) {
    return parseSlashSeparatedTraceTarget(first, usageHint);
  }

  // Two+ args: first is target context, second is trace ID
  const second = args[1];
  if (second === undefined) {
    return parseSlashSeparatedTraceTarget(first, usageHint);
  }

  const traceId = validateTraceId(second);
  return targetArgToTraceTarget(first, traceId);
}

/**
 * Parse a single slash-separated argument into a trace target.
 *
 * - No slashes → auto-detect (bare trace ID)
 * - One slash → `<org>/<trace-id>` (org-scoped)
 * - Two+ slashes → split on last `/` → `<org>/<project>/<trace-id>` (explicit)
 *
 * @internal Exported for testing
 */
export function parseSlashSeparatedTraceTarget(
  input: string,
  usageHint: string
): ParsedTraceTarget {
  const lastSlash = input.lastIndexOf("/");

  if (lastSlash === -1) {
    // No slashes — bare trace ID
    return { type: "auto-detect", traceId: validateTraceId(input) };
  }

  const prefix = input.slice(0, lastSlash);
  const rawTraceId = input.slice(lastSlash + 1);

  if (!rawTraceId) {
    throw new ContextError("Trace ID", usageHint);
  }

  const traceId = validateTraceId(rawTraceId);

  if (!prefix) {
    // "/<trace-id>" — leading slash, treat as auto-detect
    return { type: "auto-detect", traceId };
  }

  const innerSlash = prefix.indexOf("/");

  if (innerSlash === -1) {
    // "org/<trace-id>" — org-scoped
    const ns = normalizeSlug(prefix);
    return {
      type: "org-scoped",
      traceId,
      org: ns.slug,
      ...(ns.normalized && { normalized: true }),
    };
  }

  // "org/project/<trace-id>" — explicit
  const rawOrg = prefix.slice(0, innerSlash);
  const rawProject = prefix.slice(innerSlash + 1);

  if (!(rawOrg && rawProject)) {
    throw new ContextError("Trace ID", usageHint);
  }

  const no = normalizeSlug(rawOrg);
  const np = normalizeSlug(rawProject);
  const normalized = no.normalized || np.normalized;

  return {
    type: "explicit",
    traceId,
    org: no.slug,
    project: np.slug,
    ...(normalized && { normalized: true }),
  };
}

/**
 * Convert a target argument + validated trace ID into a trace target.
 * Delegates org/project parsing to {@link parseOrgProjectArg}.
 *
 * @internal Exported for testing
 */
export function targetArgToTraceTarget(
  targetArg: string,
  traceId: string
): ParsedTraceTarget {
  const parsed = parseOrgProjectArg(targetArg);

  switch (parsed.type) {
    case "explicit":
      return {
        type: "explicit",
        traceId,
        org: parsed.org,
        project: parsed.project,
        normalized: parsed.normalized,
      };

    case "org-all":
      // "org/" → org-scoped (valid for trace commands, not "all projects")
      return {
        type: "org-scoped",
        traceId,
        org: parsed.org,
        normalized: parsed.normalized,
      };

    case "project-search":
      return {
        type: "project-search",
        traceId,
        projectSlug: parsed.projectSlug,
        normalized: parsed.normalized,
      };

    case "auto-detect":
      return { type: "auto-detect", traceId };

    default: {
      const _exhaustive: never = parsed;
      throw new ValidationError(`Unexpected target: ${_exhaustive}`);
    }
  }
}

/**
 * Emit a slug normalization warning if applicable.
 * Shared by all trace commands to avoid duplicating the check.
 */
export function warnIfNormalized(parsed: ParsedTraceTarget, tag: string): void {
  if ("normalized" in parsed && parsed.normalized) {
    const log = logger.withTag(tag);
    log.warn("Normalized slug (Sentry slugs use dashes, not underscores)");
  }
}

// ---------------------------------------------------------------------------
// Resolution — org + project
// ---------------------------------------------------------------------------

/**
 * Resolve a parsed trace target to org + project.
 *
 * For commands like `span list` and `trace view` that require both
 * org and project for API calls.
 *
 * @throws {ContextError} If org-scoped without project
 * @throws {ContextError} If auto-detection fails
 */
export async function resolveTraceOrgProject(
  parsed: ParsedTraceTarget,
  cwd: string,
  usageHint: string
): Promise<ResolvedTraceOrgProject> {
  switch (parsed.type) {
    case "explicit":
      return {
        traceId: parsed.traceId,
        org: parsed.org,
        project: parsed.project,
      };

    case "project-search":
      return resolveProjectSearchTarget(parsed, usageHint);

    case "org-scoped":
      throw new ContextError("Specific project", usageHint, [
        `Use: ${usageHint.replace(USAGE_BRACKET_RE, `${parsed.org}/<project>/`)}`,
        `List projects: sentry project list ${parsed.org}/`,
      ]);

    case "auto-detect": {
      const resolved = await resolveOrgAndProject({
        cwd,
        usageHint,
      });
      if (!resolved) {
        throw new ContextError("Organization and project", usageHint);
      }
      return {
        traceId: parsed.traceId,
        org: resolved.org,
        project: resolved.project,
      };
    }

    default: {
      const _exhaustive: never = parsed;
      throw new ValidationError(`Unexpected target type: ${_exhaustive}`);
    }
  }
}

/** Resolve a project-search target by searching across orgs. */
async function resolveProjectSearchTarget(
  parsed: Extract<ParsedTraceTarget, { type: "project-search" }>,
  usageHint: string
): Promise<ResolvedTraceOrgProject> {
  const target = await resolveProjectBySlug(
    parsed.projectSlug,
    usageHint,
    usageHint.replace(
      USAGE_BRACKET_RE,
      `<org>/${parsed.projectSlug}/${parsed.traceId}`
    )
  );
  return {
    traceId: parsed.traceId,
    org: target.org,
    project: target.project,
  };
}

// ---------------------------------------------------------------------------
// Resolution — org only
// ---------------------------------------------------------------------------

/**
 * Resolve a parsed trace target to org only.
 *
 * For commands like `trace logs` where the API is org-scoped.
 * When both org and project are provided, only org is used.
 *
 * @throws {ContextError} If auto-detection fails
 */
export async function resolveTraceOrg(
  parsed: ParsedTraceTarget,
  cwd: string,
  usageHint: string
): Promise<ResolvedTraceOrg> {
  switch (parsed.type) {
    case "explicit":
      return { traceId: parsed.traceId, org: parsed.org };

    case "org-scoped":
      return { traceId: parsed.traceId, org: parsed.org };

    case "project-search": {
      // Bare slug in org-only context → treat as org slug
      const resolved = await resolveOrg({ org: parsed.projectSlug, cwd });
      if (!resolved) {
        throw new ContextError("Organization", usageHint, [
          `Could not resolve "${parsed.projectSlug}" as an organization.`,
          `Specify the org explicitly: <org>/${parsed.traceId}`,
        ]);
      }
      return { traceId: parsed.traceId, org: resolved.org };
    }

    case "auto-detect": {
      const resolved = await resolveOrg({ cwd });
      if (!resolved) {
        throw new ContextError("Organization", usageHint);
      }
      return { traceId: parsed.traceId, org: resolved.org };
    }

    default: {
      const _exhaustive: never = parsed;
      throw new ValidationError(`Unexpected target type: ${_exhaustive}`);
    }
  }
}
