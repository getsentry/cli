/**
 * Stage 2: what the server knows.
 *
 * Every fact is independently optional. One endpoint failing must not take the
 * others down, because an absent fact produces `skip` while a thrown error
 * would produce nothing at all — and a doctor that reports nothing is worse
 * than one that reports four of five facts.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { apiRequestToRegion } from "../api/infrastructure.js";
import { listIssuesPaginated } from "../api/issues.js";
import { findProjectByDsnKey, getProjectKeys } from "../api/projects.js";
import {
  listProjectEnvironments,
  listReleasesForProject,
} from "../api/releases.js";
import { getDefaultOrganization, getDefaultProject } from "../db/defaults.js";
import { parseDsn } from "../dsn/index.js";
import { parseIni } from "../ini.js";
import { logger } from "../logger.js";
import { resolveOrgRegion } from "../region.js";
import { getActiveTokenHost, isHostTrusted } from "../token-host.js";
import type { Capture, ProjectKeyFact, ServerFacts } from "./types.js";

/** Skip lookup when the DSN is not on this CLI session's instance. */
function sessionMismatch(dsn: {
  protocol: string;
  host: string;
}): string | undefined {
  const tokenHost = getActiveTokenHost();
  if (!tokenHost) {
    return;
  }
  if (isHostTrusted(`${dsn.protocol}://${dsn.host}`, tokenHost)) {
    return;
  }
  let loggedIn = tokenHost;
  try {
    loggedIn = new URL(tokenHost).host;
  } catch {
    // keep the raw origin
  }
  return `DSN is on ${dsn.host}; this CLI is logged into ${loggedIn}.`;
}

/** Org/project from flags, then sentry.properties, then CLI defaults. */
async function orgProjectHint(
  cwd: string,
  flags: { org?: string; project?: string }
): Promise<{ org?: string; project?: string }> {
  let org = flags.org;
  let project = flags.project;
  try {
    const global = parseIni(
      await readFile(join(cwd, "sentry.properties"), "utf-8")
    )[""];
    org ??= global?.["defaults.org"] || undefined;
    project ??= global?.["defaults.project"] || undefined;
  } catch {
    // no sentry.properties
  }
  try {
    org ??= getDefaultOrganization() ?? undefined;
    project ??= getDefaultProject() ?? undefined;
  } catch {
    // no CLI defaults store
  }
  return { org, project };
}

/** Run a fact-producing call, swallowing failure into `undefined`. */
async function tryFact<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    logger.debug(`doctor: ${label} unavailable`, error);
    return;
  }
}

/** True if the list endpoint returned at least one item. */
async function listingNonEmpty(
  region: string,
  path: string
): Promise<boolean | undefined> {
  return await tryFact(path, async () => {
    const { data } = await apiRequestToRegion<unknown[]>(region, path);
    return Array.isArray(data) && data.length > 0;
  });
}

/**
 * Debug files (`/files/dsyms/`) or JS source maps (`artifact-bundles`,
 * `source-maps`). Presence on any of those is enough.
 */
async function hasUploadedArtifacts(
  org: string,
  project: string
): Promise<boolean | undefined> {
  const region = await resolveOrgRegion(org);
  const prefix = `projects/${org}/${project}/files`;
  const [dsyms, bundles, maps] = await Promise.all([
    listingNonEmpty(region, `${prefix}/dsyms/`),
    listingNonEmpty(region, `${prefix}/artifact-bundles/`),
    listingNonEmpty(region, `${prefix}/source-maps/`),
  ]);
  if (dsyms === true || bundles === true || maps === true) {
    return true;
  }
  if (dsyms === false || bundles === false || maps === false) {
    return false;
  }
  return;
}

export async function resolveServerFacts(
  capture: Capture,
  flags: { org?: string; project?: string } = {}
): Promise<ServerFacts> {
  const dsn = capture.dsns[0];
  if (!dsn) {
    return {
      reachable: false,
      unreachableReason:
        "No DSN found in the project, so there is nothing to look up.",
    };
  }

  const mismatch = sessionMismatch(dsn);
  if (mismatch) {
    return { reachable: false, unreachableReason: mismatch };
  }

  let projectInfo: Awaited<ReturnType<typeof findProjectByDsnKey>>;
  try {
    projectInfo = await findProjectByDsnKey(dsn.publicKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      reachable: false,
      unreachableReason: `Could not reach Sentry: ${message}`,
    };
  }

  if (!projectInfo) {
    const hint = await orgProjectHint(capture.cwd, flags);
    const { org: hintOrg, project: hintProject } = hint;
    if (hintOrg && hintProject) {
      const keys = await tryFact("project keys", () =>
        getProjectKeys(hintOrg, hintProject)
      );
      const matched = keys?.some(
        (key) => parseDsn(key.dsn.public)?.publicKey === dsn.publicKey
      );
      if (matched) {
        const facts: ServerFacts = {
          reachable: true,
          org: hintOrg,
          project: hintProject,
          dsnMatchesProject: true,
        };
        await populateEndpointFacts(facts, hintOrg, hintProject);
        return facts;
      }
    }
    return {
      reachable: true,
      dsnMatchesProject: false,
      unreachableReason:
        "The DSN in this project does not match any project you can access.",
    };
  }

  const org = flags.org ?? projectInfo.organization?.slug;
  const slug = flags.project ?? projectInfo.slug;

  const facts: ServerFacts = {
    reachable: true,
    org,
    project: slug,
    projectPlatform: projectInfo.platform ?? undefined,
    firstEvent: projectInfo.firstEvent ?? null,
    dsnMatchesProject: true,
  };

  if (!(org && slug)) {
    return facts;
  }

  await populateEndpointFacts(facts, org, slug);
  return facts;
}

/** Newest release that has events, else the newest unused one, else none. */
function pickAttributedRelease(
  releases: readonly { version: string; lastEvent?: string | null }[]
): ServerFacts["latestRelease"] {
  if (releases.length === 0) {
    return null;
  }
  const attributed = releases.find((r) => r.lastEvent);
  const chosen = attributed ?? releases[0];
  if (!chosen) {
    return null;
  }
  return { version: chosen.version, lastEvent: chosen.lastEvent ?? null };
}

/** Fetch per-project facts in parallel and merge them into `facts`. */
async function populateEndpointFacts(
  facts: ServerFacts,
  org: string,
  slug: string
): Promise<void> {
  const [keys, issues, environments, releases, artifacts] = await Promise.all([
    tryFact("project keys", () => getProjectKeys(org, slug)),
    tryFact("issue list", () =>
      listIssuesPaginated(org, slug, { perPage: 1, sort: "date" })
    ),
    tryFact("environments", () => listProjectEnvironments(org, slug)),
    tryFact("releases", () =>
      listReleasesForProject(org, slug, { perPage: 20 })
    ),
    hasUploadedArtifacts(org, slug),
  ]);

  if (keys) {
    facts.keys = keys.flatMap((key): ProjectKeyFact[] => {
      const parsed = parseDsn(key.dsn.public);
      return parsed
        ? [{ publicKey: parsed.publicKey, isActive: key.isActive }]
        : [];
    });
  }
  if (issues) {
    facts.lastIssueSeen = issues.data[0]?.lastSeen ?? null;
  }
  if (environments) {
    facts.environments = environments
      .filter((env) => !env.isHidden)
      .map((env) => env.name);
  }
  if (releases) {
    // lastEvent is on the wire (release view already reads it) but not on
    // SentryRelease's generated type.
    facts.latestRelease = pickAttributedRelease(
      releases as { version: string; lastEvent?: string | null }[]
    );
  }
  if (artifacts !== undefined) {
    facts.hasUploadedArtifacts = artifacts;
  }
}
