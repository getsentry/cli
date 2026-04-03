/**
 * sentry release set-commits
 *
 * Associate commits with a release using auto-discovery or local git history.
 */

import type { OrgReleaseResponse } from "@sentry/api";
import type { SentryContext } from "../../context.js";
import {
  setCommitsAuto,
  setCommitsLocal,
  setCommitsWithRefs,
  updateRelease,
} from "../../lib/api-client.js";
import { buildCommand, numberParser } from "../../lib/command.js";
import { getDatabase } from "../../lib/db/index.js";
import { clearMetadata, getMetadata, setMetadata } from "../../lib/db/utils.js";
import { ApiError, ContextError, ValidationError } from "../../lib/errors.js";
import {
  escapeMarkdownInline,
  mdKvTable,
  renderMarkdown,
  safeCodeSpan,
} from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  getCommitLog,
  getRepositoryName,
  isShallowRepository,
} from "../../lib/git.js";
import { logger } from "../../lib/logger.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { parseReleaseArg } from "./parse.js";

const log = logger.withTag("release.set-commits");

/** Read commits from local git history and send to the Sentry API. */
function setCommitsFromLocal(
  org: string,
  version: string,
  cwd: string,
  depth: number
): Promise<OrgReleaseResponse> {
  const shallow = isShallowRepository(cwd);
  if (shallow) {
    log.warn(
      "Repository is a shallow clone. Commit history may be incomplete. " +
        "Consider running `git fetch --unshallow` or increasing --initial-depth."
    );
  }

  const commits = getCommitLog(cwd, { depth });
  const repoName = getRepositoryName(cwd);
  const commitsWithRepo = commits.map((c) => ({
    ...c,
    repository: repoName,
  }));

  return setCommitsLocal(org, version, commitsWithRepo);
}

// ---------------------------------------------------------------------------
// Repo integration cache — skip speculative --auto call when we know
// the org has no repo integration configured. Stored in the metadata
// key-value table with a 1-hour TTL.
// ---------------------------------------------------------------------------

/** Cache TTL: 1 hour in milliseconds */
const REPO_CACHE_TTL_MS = 60 * 60 * 1000;

/** Check if we've cached that this org has no repo integration */
function hasNoRepoIntegration(orgSlug: string): boolean {
  try {
    const db = getDatabase();
    const key = `repos_configured.${orgSlug}`;
    const checkedKey = `${key}.checked_at`;
    const m = getMetadata(db, [key, checkedKey]);
    const value = m.get(key);
    const checkedAt = m.get(checkedKey);
    if (value === "false" && checkedAt) {
      const age = Date.now() - Number(checkedAt);
      return age < REPO_CACHE_TTL_MS;
    }
  } catch {
    // DB errors shouldn't block the command
  }
  return false;
}

/** Cache that this org has no repo integration */
function cacheNoRepoIntegration(orgSlug: string): void {
  try {
    const db = getDatabase();
    const key = `repos_configured.${orgSlug}`;
    setMetadata(db, {
      [key]: "false",
      [`${key}.checked_at`]: String(Date.now()),
    });
  } catch {
    // Non-fatal
  }
}

/** Clear the negative cache (e.g., when auto succeeds) */
function clearRepoIntegrationCache(orgSlug: string): void {
  try {
    const db = getDatabase();
    const key = `repos_configured.${orgSlug}`;
    clearMetadata(db, [key, `${key}.checked_at`]);
  } catch {
    // Non-fatal
  }
}

/**
 * Default mode: try auto-discovery, fall back to local git.
 *
 * Uses a per-org negative cache to skip the speculative auto API call
 * when we already know the org has no repo integration (1-hour TTL).
 */
async function setCommitsDefault(
  org: string,
  version: string,
  cwd: string,
  depth: number
): Promise<OrgReleaseResponse> {
  // Fast path: cached "no repos" — skip the API call entirely
  if (hasNoRepoIntegration(org)) {
    return setCommitsFromLocal(org, version, cwd, depth);
  }

  try {
    const release = await setCommitsAuto(org, version, cwd);
    clearRepoIntegrationCache(org);
    return release;
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      cacheNoRepoIntegration(org);
      log.warn(
        "Could not auto-discover commits (no repository integration). " +
          "Falling back to local git history."
      );
      return setCommitsFromLocal(org, version, cwd, depth);
    }
    if (error instanceof ValidationError && error.field === "repository") {
      log.warn(
        `Auto-discovery failed: ${error.message}. ` +
          "Falling back to local git history."
      );
      return setCommitsFromLocal(org, version, cwd, depth);
    }
    throw error;
  }
}

function formatCommitsSet(release: OrgReleaseResponse): string {
  const lines: string[] = [];
  lines.push(`## Commits Set: ${escapeMarkdownInline(release.version)}`);
  lines.push("");
  const kvRows: [string, string][] = [];
  kvRows.push(["Version", safeCodeSpan(release.version)]);
  kvRows.push(["Commits", String(release.commitCount ?? 0)]);
  lines.push(mdKvTable(kvRows));
  return renderMarkdown(lines.join("\n"));
}

export const setCommitsCommand = buildCommand({
  docs: {
    brief: "Set commits for a release",
    fullDescription:
      "Associate commits with a release.\n\n" +
      "Use --auto to let Sentry discover commits via your repository integration\n" +
      "(requires a local git checkout — matches the origin remote against Sentry repos),\n" +
      "or --local to read commits from the local git history.\n" +
      "With no flag, tries --auto first and falls back to --local on failure.\n\n" +
      "Examples:\n" +
      "  sentry release set-commits 1.0.0 --auto\n" +
      "  sentry release set-commits my-org/1.0.0 --local\n" +
      "  sentry release set-commits 1.0.0 --local --initial-depth 50\n" +
      "  sentry release set-commits 1.0.0 --commit owner/repo@abc123..def456\n" +
      "  sentry release set-commits 1.0.0 --clear",
  },
  output: {
    human: formatCommitsSet,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        placeholder: "org/version",
        brief: "[<org>/]<version> - Release version",
        parse: String,
      },
    },
    flags: {
      auto: {
        kind: "boolean",
        brief:
          "Auto-discover commits via repository integration (needs local git checkout)",
        default: false,
      },
      local: {
        kind: "boolean",
        brief: "Read commits from local git history",
        default: false,
      },
      clear: {
        kind: "boolean",
        brief: "Clear all commits from the release",
        default: false,
      },
      commit: {
        kind: "parsed",
        parse: String,
        brief:
          "Explicit commit as REPO@SHA or REPO@PREV..SHA (comma-separated)",
        optional: true,
      },
      "initial-depth": {
        kind: "parsed",
        parse: numberParser,
        brief: "Number of commits to read with --local",
        default: "20", // Stricli passes string defaults through parse(); numberParser converts to number
      },
    },
  },
  async *func(
    this: SentryContext,
    flags: {
      readonly auto: boolean;
      readonly local: boolean;
      readonly clear: boolean;
      readonly commit?: string;
      readonly "initial-depth": number;
      readonly json: boolean;
      readonly fields?: string[];
    },
    ...args: string[]
  ) {
    const { cwd } = this;

    const joined = args.join(" ").trim();
    if (!joined) {
      throw new ContextError(
        "Release version",
        "sentry release set-commits [<org>/]<version> --auto",
        []
      );
    }

    const { version, orgSlug } = parseReleaseArg(
      joined,
      "sentry release set-commits [<org>/]<version>"
    );
    const resolved = await resolveOrg({ org: orgSlug, cwd });
    if (!resolved) {
      throw new ContextError(
        "Organization",
        "sentry release set-commits [<org>/]<version>"
      );
    }

    // Clear mode: remove all commits regardless of other flags
    if (flags.clear) {
      const release = await updateRelease(resolved.org, version, {
        commits: [],
      });
      yield new CommandOutput(release);
      return;
    }

    // Validate mutual exclusivity of commit source flags
    const modeFlags = [flags.auto, flags.local, !!flags.commit].filter(Boolean);
    if (modeFlags.length > 1) {
      throw new ValidationError(
        "Only one of --auto, --local, or --commit can be used at a time.",
        "commit"
      );
    }

    // Explicit --commit mode: parse REPO@SHA or REPO@PREV..SHA pairs as refs
    if (flags.commit) {
      const refs = flags.commit.split(",").map((pair) => {
        const trimmed = pair.trim();
        const atIdx = trimmed.lastIndexOf("@");
        if (atIdx <= 0) {
          throw new ValidationError(
            `Invalid commit format '${trimmed}'. Expected REPO@SHA or REPO@PREV..SHA.`,
            "commit"
          );
        }
        const repository = trimmed.slice(0, atIdx);
        const sha = trimmed.slice(atIdx + 1);

        // Support REPO@PREV..SHA range syntax
        const rangeParts = sha.split("..");
        if (rangeParts.length === 2 && rangeParts[0] && rangeParts[1]) {
          return {
            repository,
            commit: rangeParts[1],
            previousCommit: rangeParts[0],
          };
        }

        return { repository, commit: sha };
      });

      const release = await setCommitsWithRefs(resolved.org, version, refs);
      yield new CommandOutput(release);
      return;
    }

    let release: OrgReleaseResponse;

    if (flags.local) {
      // Explicit --local: use local git only
      release = await setCommitsFromLocal(
        resolved.org,
        version,
        cwd,
        flags["initial-depth"]
      );
    } else if (flags.auto) {
      // Explicit --auto: use repo integration, fail hard on error
      release = await setCommitsAuto(resolved.org, version, cwd);
    } else {
      // Default (no flag): try auto with cached fallback
      release = await setCommitsDefault(
        resolved.org,
        version,
        cwd,
        flags["initial-depth"]
      );
    }

    yield new CommandOutput(release);
  },
});
