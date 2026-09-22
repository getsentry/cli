/**
 * DSN resolution for `sentry event send`.
 *
 * Ingest still authenticates with a DSN. This module fills that DSN from
 * the same sources users expect on other commands: `--dsn` / `SENTRY_DSN`,
 * a leading `<org>/<project>` positional, then a project-directory scan.
 */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { getProjectKeys } from "../api/projects.js";
import { parseOrgProjectArg } from "../arg-parsing.js";
import { getAuthConfig } from "../db/auth.js";
import { ConfigError } from "../errors.js";
import { logger } from "../logger.js";
import { type DsnFlags, resolveDsn, resolveIngestDsn } from "./transport.js";

const log = logger.withTag("event.send");

/** Usage example shown on missing-DSN errors. */
export const EVENT_SEND_DSN_HINT =
  "sentry event send --dsn <your-dsn> -m 'My message'";

/** User-facing missing-DSN message covering every resolution source. */
export const EVENT_SEND_NO_DSN_MESSAGE =
  "No DSN found. Provide one via --dsn <dsn>, set the SENTRY_DSN environment variable, run from a project where a DSN can be detected, or pass <org>/<project> (requires login).";

export type OrgProjectTarget = {
  /** Organization slug used to look up the project client key. */
  org: string;
  /** Project slug used to look up the project client key. */
  project: string;
};

/**
 * Peel a leading `<org>/<project>` positional when it is unambiguously a
 * target rather than an event file.
 *
 * Remaining arguments stay as JSON/envelope files. Existing paths and
 * path-shaped arguments such as `events/crash.json` are never consumed as
 * an org/project target.
 *
 * @param cwd - Working directory used to resolve relative paths.
 * @param files - Positional arguments as received by `event send`.
 * @returns The optional target and the remaining file arguments.
 */
export function peelOrgProjectTarget(
  cwd: string,
  files: readonly string[]
): { target: OrgProjectTarget | undefined; files: string[] } {
  const first = files[0];
  if (!first) {
    return { target: undefined, files: [...files] };
  }
  if (pathExists(cwd, first) || !looksLikeOrgProjectTarget(first)) {
    return { target: undefined, files: [...files] };
  }
  try {
    const parsed = parseOrgProjectArg(first);
    if (parsed.type === "explicit") {
      return {
        target: { org: parsed.org, project: parsed.project },
        files: files.slice(1),
      };
    }
  } catch (error) {
    log.debug("positional is not org/project", error);
  }
  return { target: undefined, files: [...files] };
}

/**
 * Resolve the ingest DSN for `event send`.
 *
 * Priority: `--dsn` / `SENTRY_DSN` → explicit `<org>/<project>` client key
 * (requires login) → project scan via {@link resolveIngestDsn}.
 *
 * @param flags - DSN flag source, with `SENTRY_DSN` fallback.
 * @param cwd - Directory to scan when explicit sources are absent.
 * @param target - Optional org/project whose public DSN should be fetched.
 * @returns The resolved ingest DSN.
 * @throws {ConfigError} When no DSN can be resolved.
 */
export async function resolveEventSendDsn(
  flags: DsnFlags,
  cwd: string,
  target: OrgProjectTarget | undefined
): Promise<string> {
  const explicit = resolveDsn(flags);
  if (explicit) {
    return explicit;
  }
  if (target) {
    return dsnFromOrgProject(target.org, target.project);
  }
  const scanned = await resolveIngestDsn(flags, cwd);
  if (scanned) {
    return scanned;
  }
  throw new ConfigError(EVENT_SEND_NO_DSN_MESSAGE, EVENT_SEND_DSN_HINT);
}

function pathExists(cwd: string, value: string): boolean {
  const abs = isAbsolute(value) ? value : resolve(cwd, value);
  return existsSync(abs);
}

/**
 * Cheap pre-filter before {@link parseOrgProjectArg}.
 *
 * Dots are not valid in current Sentry project slugs, so dotted final
 * segments remain file arguments even when the file does not exist yet.
 */
function looksLikeOrgProjectTarget(value: string): boolean {
  if (value.startsWith(".") || value.startsWith("/")) {
    return false;
  }
  const slash = value.indexOf("/");
  if (slash <= 0 || slash !== value.lastIndexOf("/")) {
    return false;
  }
  const project = value.slice(slash + 1);
  return project.length > 0 && !project.includes(".");
}

/**
 * Look up the public DSN for an org/project via the Web API.
 *
 * A refreshable OAuth session remains usable after its access token expires.
 * The session is used only for the key lookup; ingest authenticates with the
 * resulting DSN.
 */
async function dsnFromOrgProject(
  org: string,
  project: string
): Promise<string> {
  if (!getAuthConfig()) {
    throw new ConfigError(
      `No DSN found for ${org}/${project}. Provide one via --dsn, set SENTRY_DSN, or run sentry auth login.`,
      "sentry auth login"
    );
  }
  const keys = await getProjectKeys(org, project);
  const dsn =
    keys.find((key) => key.isActive)?.dsn.public ?? keys[0]?.dsn.public;
  if (!dsn) {
    throw new ConfigError(
      `No DSN found for ${org}/${project}. The project has no client keys.`,
      EVENT_SEND_DSN_HINT
    );
  }
  log.debug(`Using DSN from ${org}/${project} client keys`);
  return dsn;
}
