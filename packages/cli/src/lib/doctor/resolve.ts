/**
 * Stage 2: what the server knows.
 *
 * Every fact is independently optional. One endpoint failing must not take the
 * others down, because an absent fact produces `skip` while a thrown error
 * would produce nothing at all — and a doctor that reports nothing is worse
 * than one that reports four of five facts.
 */

import { apiRequestToRegion } from "../api/infrastructure.js";
import { listIssuesPaginated } from "../api/issues.js";
import { findProjectByDsnKey, getProjectKeys } from "../api/projects.js";
import {
  listProjectEnvironments,
  listReleasesForProject,
} from "../api/releases.js";
import { parseDsn } from "../dsn/index.js";
import { logger } from "../logger.js";
import { resolveOrgRegion } from "../region.js";
import type { Capture, ProjectKeyFact, ServerFacts } from "./types.js";

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

/** Debug files uploaded for this project — presence is all any check needs. */
async function hasUploadedArtifacts(
  org: string,
  project: string
): Promise<boolean | undefined> {
  return await tryFact("artifact listing", async () => {
    const region = await resolveOrgRegion(org);
    // Typed defensively: we assert only that the list is non-empty, so
    // response-shape drift cannot break the check.
    const { data } = await apiRequestToRegion<unknown[]>(
      region,
      `projects/${org}/${project}/files/difs/`
    );
    return Array.isArray(data) && data.length > 0;
  });
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
      listReleasesForProject(org, slug, { perPage: 1 })
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
    const newest = releases[0];
    facts.latestRelease = newest
      ? { version: newest.version, lastEvent: newest.lastEvent ?? null }
      : null;
  }
  if (artifacts !== undefined) {
    facts.hasUploadedArtifacts = artifacts;
  }
}
