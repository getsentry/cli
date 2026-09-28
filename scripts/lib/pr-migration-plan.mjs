import { createHash } from "node:crypto";

export const SOURCE_REPOSITORY = "getsentry/cli";
export const DESTINATION_REPOSITORY = "getsentry/sentry-mcp";
export const SOURCE_MAIN_CUTOFF = "fc1140092883409046438c8bb5d6f7f939eb9659";
export const SOURCE_LAYOUT_COMMIT = "96390e5f6953aa61ed2e90687f2d6858478c708c";
export const FILTERED_TIPS = Object.freeze([
  "6b08e9029dc7e092bfebaa3870ca116e7dfdfc89",
  "4358ec2729a60ef034f3866680fc5fd7bce62ce0",
]);
export const MIGRATED_PATHS = Object.freeze(["packages/cli", "apps/cli-docs"]);
export const DEFAULT_PLAN = "cli-open-pr-migration-plan.json";
export const MIGRATION_WRITE_PHASES = Object.freeze([
  "push-branch",
  "create-pull",
  "update-metadata",
  "request-reviewers",
  "comment-source",
]);

const EMPTY_LEGACY_MAPPING = Object.freeze({
  cliRoots: new Set(),
  docsRoots: new Set(),
});

/** Exact roots moved by the immutable source layout commit. */
export const LEGACY_PATH_MOVES = Object.freeze(
  [
    [".claude-plugin", "packages/cli/.claude-plugin"],
    [".cursor", "packages/cli/.cursor"],
    [".env.example", "packages/cli/.env.example"],
    [".vscode", "packages/cli/.vscode"],
    ["CONTRIBUTING.md", "packages/cli/CONTRIBUTING.md"],
    ["DEVELOPMENT.md", "packages/cli/DEVELOPMENT.md"],
    ["assets", "packages/cli/assets"],
    ["biome.jsonc", "packages/cli/biome.jsonc"],
    ["codecov.yml", "packages/cli/codecov.yml"],
    ["install", "packages/cli/install"],
    ["lint-rules", "packages/cli/lint-rules"],
    ["patches", "packages/cli/patches"],
    ["plugins", "packages/cli/plugins"],
    ["script", "packages/cli/script"],
    ["src", "packages/cli/src"],
    ["test", "packages/cli/test"],
    ["tsconfig.json", "packages/cli/tsconfig.json"],
    ["vitest.config.ts", "packages/cli/vitest.config.ts"],
    ["warden.toml", "packages/cli/warden.toml"],
    ["docs/astro.config.mjs", "apps/cli-docs/astro.config.mjs"],
    ["docs/package.json", "apps/cli-docs/package.json"],
    ["docs/public", "apps/cli-docs/public"],
    ["docs/sentry.client.config.js", "apps/cli-docs/sentry.client.config.js"],
    ["docs/sentry.server.config.js", "apps/cli-docs/sentry.server.config.js"],
    ["docs/src", "apps/cli-docs/src"],
    ["docs/tsconfig.json", "apps/cli-docs/tsconfig.json"],
  ].map((move) => Object.freeze(move))
);

/** Compares strings by JavaScript code units without consulting the locale. */
export function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function text(value) {
  return value ?? "";
}

function names(values) {
  return (values ?? [])
    .map((value) => value.login ?? value.name)
    .sort(compareCodeUnits);
}

/** Reduces GitHub's pull response to the fields whose movement invalidates a plan. */
export function snapshotPull(pull) {
  if (!(pull.head?.repo?.full_name && pull.base?.repo?.full_name)) {
    throw new Error(`PR #${pull.number} has a deleted head or base repository`);
  }

  return {
    number: pull.number,
    title: pull.title,
    body: text(pull.body),
    author: pull.user?.login ?? "",
    state: pull.state,
    draft: Boolean(pull.draft),
    head: {
      repository: pull.head.repo.full_name,
      branch: pull.head.ref,
      sha: pull.head.sha,
    },
    base: {
      repository: pull.base.repo.full_name,
      branch: pull.base.ref,
      sha: pull.base.sha,
    },
    labels: (pull.labels ?? [])
      .map((label) => label.name)
      .sort(compareCodeUnits),
    assignees: names(pull.assignees),
    reviewers: names(pull.requested_reviewers),
    reviewerTeams: (pull.requested_teams ?? [])
      .map((team) => team.slug)
      .sort(compareCodeUnits),
    milestone: pull.milestone?.title ?? null,
    url: pull.html_url,
  };
}

function headKey(repository, branch) {
  return `${repository}\0${branch}`;
}

/** Maps source base branches to open PR heads and returns parent-first entries. */
export function buildStackPlan(snapshots, sourceDefaultBranch = "main") {
  const byHead = new Map();
  for (const snapshot of snapshots) {
    const key = headKey(snapshot.head.repository, snapshot.head.branch);
    if (byHead.has(key)) {
      throw new Error(
        `ambiguous open PR head ${snapshot.head.repository}:${snapshot.head.branch}`
      );
    }
    byHead.set(key, snapshot);
  }

  const entries = snapshots.map((snapshot) => {
    if (snapshot.base.repository !== SOURCE_REPOSITORY) {
      throw new Error(
        `PR #${snapshot.number} targets unexpected repository ${snapshot.base.repository}`
      );
    }
    const parent = byHead.get(
      headKey(snapshot.base.repository, snapshot.base.branch)
    );
    if (!parent && snapshot.base.branch !== sourceDefaultBranch) {
      throw new Error(
        `PR #${snapshot.number} targets ${snapshot.base.repository}:${snapshot.base.branch}, ` +
          "which is neither main nor another open PR head"
      );
    }
    if (parent?.number === snapshot.number) {
      throw new Error(`PR #${snapshot.number} targets its own head branch`);
    }
    return {
      snapshot,
      parentNumber: parent?.number ?? null,
      destinationBranch: `migrated/cli-pr-${snapshot.number}`,
      destinationBase: parent ? `migrated/cli-pr-${parent.number}` : "main",
    };
  });

  const pending = new Map(
    entries.map((entry) => [entry.snapshot.number, entry])
  );
  const ordered = [];
  while (pending.size > 0) {
    const ready = [...pending.values()]
      .filter(
        (entry) =>
          entry.parentNumber === null || !pending.has(entry.parentNumber)
      )
      .sort((left, right) => left.snapshot.number - right.snapshot.number);
    if (ready.length === 0) {
      throw new Error("open PR base mapping contains a cycle");
    }
    for (const entry of ready) {
      ordered.push(entry);
      pending.delete(entry.snapshot.number);
    }
  }
  return ordered;
}

export function isMigratedPath(path) {
  return MIGRATED_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/** Parses migration arguments. Execution never includes source-PR closure. */
export function parseArgs(argv) {
  const options = {
    execute: false,
    keepTemp: false,
    output: DEFAULT_PLAN,
    plan: DEFAULT_PLAN,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--execute") options.execute = true;
    else if (argument === "--keep-temp") options.keepTemp = true;
    else if (argument === "--help") options.help = true;
    else if (argument === "--output" || argument === "--plan") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a path`);
      }
      options[argument === "--output" ? "output" : "plan"] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  return options;
}

/** Builds path lookup sets from the explicit immutable layout mapping. */
export function createLegacyPathMapping() {
  const cliRoots = new Set();
  const docsRoots = new Set();
  for (const [source, destination] of LEGACY_PATH_MOVES) {
    if (destination.startsWith("packages/cli/")) cliRoots.add(source);
    else if (destination.startsWith("apps/cli-docs/")) {
      docsRoots.add(source.slice("docs/".length));
    } else throw new Error(`unknown legacy destination ${destination}`);
  }
  return { cliRoots, docsRoots };
}

/** Maps one source-era path using lineage from the immutable layout commit. */
export function mapSourcePath(
  path,
  layout,
  legacyMapping = EMPTY_LEGACY_MAPPING
) {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`unsafe changed path ${JSON.stringify(path)}`);
  }
  if (layout === "monorepo") return isMigratedPath(path) ? path : null;
  if (layout !== "legacy") throw new Error(`unknown source layout ${layout}`);
  if (path.startsWith("docs/")) {
    const docsPath = path.slice("docs/".length);
    const docsRoot = docsPath.split("/", 1)[0];
    return legacyMapping.docsRoots.has(docsRoot)
      ? `apps/cli-docs/${docsPath}`
      : null;
  }
  const root = path.split("/", 1)[0];
  return legacyMapping.cliRoots.has(root) ? `packages/cli/${path}` : null;
}

/** Classifies source paths and reports their mapped destination paths. */
export function classifySourcePaths(
  paths,
  layout,
  legacyMapping = EMPTY_LEGACY_MAPPING
) {
  const included = [];
  const excluded = [];
  const mapped = [];
  for (const path of paths) {
    const destination = mapSourcePath(path, layout, legacyMapping);
    if (destination) {
      included.push(path);
      mapped.push(destination);
    } else {
      excluded.push(path);
    }
  }
  return {
    included: [...new Set(included)].sort(compareCodeUnits),
    excluded: [...new Set(excluded)].sort(compareCodeUnits),
    mapped: [...new Set(mapped)].sort(compareCodeUnits),
  };
}

/** Returns the first parent used to replay a commit's net first-parent change. */
export function replayParent(parents, commit) {
  if (parents.length === 0) {
    throw new Error(`root commit edge case at ${commit}`);
  }
  return parents[0];
}

/** Chooses commit replay unless any merge requires one verified net change. */
export function reconstructionMode(parentCounts) {
  return parentCounts.some((count) => count > 1) ? "net" : "commits";
}

/** Builds a stable, byte-identity manifest after applying source path mapping. */
export function buildMappedManifest(changes, mapPath) {
  const manifest = [];
  for (const change of changes) {
    const path = mapPath(change.path);
    if (!path) continue;
    manifest.push({
      blob: change.blob,
      mode: change.mode,
      path,
      status: change.status,
    });
  }
  return manifest.sort((left, right) =>
    compareCodeUnits(left.path, right.path)
  );
}

/** Decides whether an exact destination branch can be resumed safely. */
export function destinationRecoveryAction(state) {
  if (!state.branchExists) return state.pullExists ? "reject" : "push";
  if (state.branchSha !== state.expectedHeadSha || !state.diffMatches) {
    return "reject";
  }
  return state.pullExists ? "reuse" : "create-pull";
}

/**
 * Re-resolves every source target and destination base in an entry's stack.
 * This includes skipped parents because they can still determine either base.
 */
export async function verifyWriteReferences(
  entry,
  entriesByNumber,
  resolveSourceTarget,
  resolveDestinationBase
) {
  const visited = new Set();
  for (let current = entry; current; ) {
    if (visited.has(current.snapshot.number)) {
      throw new Error(
        `cycle while verifying write references for PR #${entry.snapshot.number}`
      );
    }
    visited.add(current.snapshot.number);

    const sourceTargetSha = await resolveSourceTarget(current);
    if (sourceTargetSha !== current.sourceTargetSha) {
      throw new Error(
        `source target for PR #${current.snapshot.number} moved to ${sourceTargetSha}, expected ${current.sourceTargetSha}`
      );
    }
    const destinationBaseSha = await resolveDestinationBase(current);
    if (destinationBaseSha !== current.destinationBaseSha) {
      throw new Error(
        `destination base for PR #${current.snapshot.number} moved to ${destinationBaseSha}, expected ${current.destinationBaseSha}`
      );
    }

    current =
      current.parentNumber === null
        ? null
        : entriesByNumber.get(current.parentNumber);
    if (current === undefined) {
      throw new Error(
        `missing source stack parent for PR #${entry.snapshot.number}`
      );
    }
  }
}

/** Runs one named GitHub write only after its live-reference guard succeeds. */
export async function guardedMigrationWrite(phase, verifyReferences, write) {
  if (!MIGRATION_WRITE_PHASES.includes(phase)) {
    throw new Error(`unknown migration write phase ${phase}`);
  }
  await verifyReferences(phase);
  return await write();
}

/** Classifies a NUL-delimited `git diff-tree --name-status` result. */
export function classifyNameStatus(fields, includePath = isMigratedPath) {
  const included = [];
  const excluded = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (!status) {
      continue;
    }
    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    const paths = fields.slice(index, index + pathCount);
    index += pathCount;
    if (paths.length !== pathCount || paths.some((path) => !path)) {
      throw new Error("malformed git name-status output");
    }
    if (status.startsWith("R") || status.startsWith("C")) {
      throw new Error(
        `rename/copy edge case (${status}: ${paths.join(" -> ")})`
      );
    }
    if (status === "T") {
      throw new Error(`file-type change edge case (${paths.join(", ")})`);
    }
    if (!["A", "M", "D"].includes(status)) {
      throw new Error(`unsupported git change status ${status}`);
    }
    for (const path of paths) {
      if (path.startsWith("/") || path.split("/").includes("..")) {
        throw new Error(`unsafe changed path ${JSON.stringify(path)}`);
      }
      (includePath(path) ? included : excluded).push(path);
    }
  }
  return {
    included: [...new Set(included)].sort(compareCodeUnits),
    excluded: [...new Set(excluded)].sort(compareCodeUnits),
  };
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  const content =
    typeof value === "string" || ArrayBuffer.isView(value)
      ? value
      : stableJson(value);
  return createHash("sha256").update(content).digest("hex");
}

export function migrationMarker(entry) {
  return `<!-- cli-pr-migration: ${SOURCE_REPOSITORY}#${entry.snapshot.number} source-head=${entry.snapshot.head.sha} -->`;
}

/** Builds the exact migration-owned destination pull request body. */
export function migrationPullBody(entry) {
  const author = entry.snapshot.author
    ? `@${entry.snapshot.author}`
    : "the original author";
  return `${entry.snapshot.body}\n\n---\nMigrated from [${SOURCE_REPOSITORY}#${entry.snapshot.number}](${entry.snapshot.url}) after the CLI subtree import. Original author: ${author}.\n\n${migrationMarker(entry)}`;
}

function sameValues(left, right) {
  return stableJson(left) === stableJson(right);
}

function destinationPullMetadata(pull) {
  return {
    labels: names(pull.labels),
    assignees: names(pull.assignees),
    milestone: pull.milestone?.number ?? null,
    reviewers: names(pull.requested_reviewers),
    reviewerTeams: (pull.requested_teams ?? [])
      .map((team) => team.slug)
      .sort(compareCodeUnits),
  };
}

/**
 * Returns the exact migration phase of an existing destination pull request.
 * Unknown or user-edited metadata returns null and must fail closed.
 */
export function destinationPullResumeState(entry, pull) {
  if (
    pull?.state !== "open" ||
    pull.base.ref !== entry.destinationBase ||
    pull.base.sha !== entry.destinationBaseSha ||
    pull.head.ref !== entry.destinationBranch ||
    pull.head.repo?.full_name !== DESTINATION_REPOSITORY ||
    pull.head.sha !== entry.headSha ||
    pull.title !== entry.snapshot.title ||
    String(pull.body ?? "") !== migrationPullBody(entry) ||
    Boolean(pull.draft) !== entry.snapshot.draft
  ) {
    return null;
  }

  const actual = destinationPullMetadata(pull);
  const planned = entry.destinationMetadata;
  const emptyIssueMetadata = { labels: [], assignees: [], milestone: null };
  const actualIssueMetadata = {
    labels: actual.labels,
    assignees: actual.assignees,
    milestone: actual.milestone,
  };
  const plannedIssueMetadata = {
    labels: planned.labels,
    assignees: planned.assignees,
    milestone: planned.milestone,
  };
  const emptyReviewers = { reviewers: [], reviewerTeams: [] };
  const actualReviewers = {
    reviewers: actual.reviewers,
    reviewerTeams: actual.reviewerTeams,
  };
  const plannedReviewers = {
    reviewers: planned.reviewers,
    reviewerTeams: planned.reviewerTeams,
  };

  if (
    sameValues(actualIssueMetadata, plannedIssueMetadata) &&
    sameValues(actualReviewers, plannedReviewers)
  ) {
    return "complete";
  }
  if (
    sameValues(actualIssueMetadata, plannedIssueMetadata) &&
    sameValues(actualReviewers, emptyReviewers)
  ) {
    return "issue-metadata";
  }
  if (
    sameValues(actualIssueMetadata, emptyIssueMetadata) &&
    sameValues(actualReviewers, emptyReviewers)
  ) {
    return "created";
  }
  return null;
}
