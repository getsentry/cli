#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMappedManifest,
  buildStackPlan,
  classifyNameStatus,
  createLegacyPathMapping,
  DEFAULT_PLAN,
  DESTINATION_REPOSITORY,
  destinationPullResumeState,
  destinationRecoveryAction,
  digest,
  FILTERED_TIPS,
  guardedMigrationWrite,
  isMigratedPath,
  LEGACY_PATH_MOVES,
  MIGRATED_PATHS,
  mapSourcePath,
  migrationPullBody,
  parseArgs,
  reconstructionMode,
  replayParent,
  SOURCE_LAYOUT_COMMIT,
  SOURCE_MAIN_CUTOFF,
  SOURCE_REPOSITORY,
  snapshotPull,
  stableJson,
  verifyWriteReferences,
} from "./lib/pr-migration-plan.mjs";

const PLAN_VERSION = 2;
const SOURCE_MAIN_REF = "refs/migration/source-main";

function usage() {
  return `Usage:
  node scripts/migrate-open-prs.mjs [--output PATH]
  node scripts/migrate-open-prs.mjs --execute [--plan PATH]

The default command only reads GitHub/Git data, reconstructs every open PR in a
temporary clone, verifies its scoped diff, and exports a plan. It never pushes,
creates, edits, comments on, readies, or closes a PR.

Options:
  --output PATH    Dry-run plan output (default: ${DEFAULT_PLAN})
  --execute        Apply a previously exported and revalidated plan
  --plan PATH      Plan consumed by --execute (default: ${DEFAULT_PLAN})
  --keep-temp      Keep the temporary reconstruction clone for inspection
  --help           Show this help
`;
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: options.encoding ?? "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    maxBuffer: 256 * 1024 * 1024,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${program} ${args.join(" ")} failed (${result.status}):\n${String(result.stderr).trim()}`
    );
  }
  return result;
}

function ghJson(args, input) {
  const result = command(
    "gh",
    args,
    input === undefined ? {} : { input: JSON.stringify(input) }
  );
  const output = String(result.stdout).trim();
  return output ? JSON.parse(output) : null;
}

function api(endpoint, options = {}) {
  const args = ["api", endpoint];
  if (options.method) args.push("--method", options.method);
  if (options.paginate) args.push("--paginate", "--slurp");
  if (options.input !== undefined) args.push("--input", "-");
  return ghJson(args, options.input);
}

function git(cwd, args, options = {}) {
  return command("git", args, { cwd, ...options });
}

function repositoryUrl(repository) {
  return `https://github.com/${repository}.git`;
}

async function listSourceSnapshots() {
  const pages = api(
    `repos/${SOURCE_REPOSITORY}/pulls?state=open&per_page=100`,
    { paginate: true }
  );
  return pages
    .flat()
    .map(snapshotPull)
    .sort((left, right) => left.number - right.number);
}

async function verifySnapshot(expected) {
  const actual = snapshotPull(
    api(`repos/${SOURCE_REPOSITORY}/pulls/${expected.number}`)
  );
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(
      `source PR #${expected.number} moved since the plan was exported`
    );
  }
}

function splitNul(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function assertCommit(repository, revision, description) {
  const result = git(repository, ["cat-file", "-e", `${revision}^{commit}`], {
    allowFailure: true,
  });
  if (result.status !== 0)
    throw new Error(`${description} ${revision} is not available as a commit`);
}

function isAncestor(repository, ancestor, descendant) {
  return (
    git(repository, ["merge-base", "--is-ancestor", ancestor, descendant], {
      allowFailure: true,
    }).status === 0
  );
}

function pathExists(repository, revision, path) {
  return (
    git(repository, ["cat-file", "-e", `${revision}:${path}`], {
      allowFailure: true,
    }).status === 0
  );
}

function fetchSourcePull(repository, entry) {
  const ref = `refs/migration/source/${entry.snapshot.number}`;
  git(repository, [
    "fetch",
    "--no-tags",
    repositoryUrl(SOURCE_REPOSITORY),
    `+refs/pull/${entry.snapshot.number}/head:${ref}`,
  ]);
  const fetched = git(repository, ["rev-parse", ref]).stdout.trim();
  if (fetched !== entry.snapshot.head.sha) {
    throw new Error(
      `source PR #${entry.snapshot.number} head resolved to ${fetched}, expected ${entry.snapshot.head.sha}`
    );
  }
  return ref;
}

function inspectCommit(repository, parent, commit, layout, legacyMapping) {
  const status = git(
    repository,
    [
      "diff-tree",
      "--no-commit-id",
      "--name-status",
      "-r",
      "-z",
      "--find-renames",
      "--find-copies",
      parent,
      commit,
    ],
    { encoding: "buffer" }
  );
  const classified = classifyNameStatus(splitNul(status.stdout), (path) =>
    Boolean(mapSourcePath(path, layout, legacyMapping))
  );
  const numstat = splitNul(
    git(repository, ["diff", "--numstat", "-z", parent, commit], {
      encoding: "buffer",
    }).stdout
  );
  for (const record of numstat) {
    const [added, deleted, path] = record.split("\t");
    if ((added === "-" || deleted === "-") && path)
      throw new Error(`binary change in ${path} at ${commit}`);
  }
  for (const path of classified.included) {
    for (const revision of [parent, commit]) {
      const tree = git(repository, ["ls-tree", revision, "--", path]).stdout;
      if (tree.startsWith("120000 ") || tree.startsWith("160000 ")) {
        throw new Error(
          `symlink or submodule edge case at ${path} in ${commit}`
        );
      }
    }
  }
  return classified;
}

function commitMetadata(repository, commit) {
  const fields = git(
    repository,
    [
      "show",
      "-s",
      "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B%x00",
      commit,
    ],
    {
      encoding: "buffer",
    }
  )
    .stdout.toString("utf8")
    .split("\0");
  if (fields.length < 7)
    throw new Error(`could not read metadata for ${commit}`);
  return {
    authorName: fields[0],
    authorEmail: fields[1],
    authorDate: fields[2],
    committerName: fields[3],
    committerEmail: fields[4],
    committerDate: fields[5],
    message: fields[6],
  };
}

function scopedPatch(repository, from, to) {
  return git(
    repository,
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-renames",
      from,
      to,
      "--",
      ...MIGRATED_PATHS,
    ],
    { encoding: "buffer" }
  ).stdout;
}

function sourceLayout(repository, baseRevision) {
  if (isAncestor(repository, SOURCE_LAYOUT_COMMIT, baseRevision)) {
    return "monorepo";
  }
  if (isAncestor(repository, baseRevision, SOURCE_LAYOUT_COMMIT))
    return "legacy";
  throw new Error(
    `source merge base ${baseRevision} is not comparable with layout commit ${SOURCE_LAYOUT_COMMIT}`
  );
}

function deriveLegacyMapping(repository) {
  for (const [source, destination] of LEGACY_PATH_MOVES) {
    if (
      !pathExists(repository, `${SOURCE_LAYOUT_COMMIT}^`, source) ||
      pathExists(repository, SOURCE_LAYOUT_COMMIT, source) ||
      !pathExists(repository, SOURCE_LAYOUT_COMMIT, destination)
    ) {
      throw new Error(
        `legacy path mapping ${source} -> ${destination} does not match layout commit ${SOURCE_LAYOUT_COMMIT}`
      );
    }
  }
  return createLegacyPathMapping();
}

function mappedSourcePatch(repository, from, to, layout, legacyMapping) {
  if (layout === "monorepo") return scopedPatch(repository, from, to);
  const cliPatch = git(
    repository,
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-renames",
      "--src-prefix=a/packages/cli/",
      "--dst-prefix=b/packages/cli/",
      from,
      to,
      "--",
      ...legacyMapping.cliRoots,
    ],
    { encoding: "buffer" }
  ).stdout;
  const docsPatch =
    legacyMapping.docsRoots.size > 0
      ? git(
          repository,
          [
            "diff",
            "--binary",
            "--full-index",
            "--no-renames",
            "--relative=docs",
            "--src-prefix=a/apps/cli-docs/",
            "--dst-prefix=b/apps/cli-docs/",
            from,
            to,
            "--",
            ...[...legacyMapping.docsRoots].map((root) => `docs/${root}`),
          ],
          { encoding: "buffer" }
        ).stdout
      : Buffer.alloc(0);
  return Buffer.concat([docsPatch, cliPatch]);
}

function changeManifest(repository, from, to, mapPath) {
  const fields = splitNul(
    git(repository, ["diff", "--name-status", "-z", "--no-renames", from, to], {
      encoding: "buffer",
    }).stdout
  );
  const changes = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    const path = fields[index++];
    if (!(status && path && ["A", "M", "D"].includes(status))) {
      throw new Error("unsupported change while building exact diff manifest");
    }
    const identity =
      status === "D"
        ? { blob: null, mode: null }
        : (() => {
            const record = git(repository, ["ls-tree", "-z", to, "--", path])
              .stdout.toString("utf8")
              .replace(/\0$/, "");
            const match = /^(\d+) blob ([0-9a-f]+)\t/.exec(record);
            if (!match) {
              throw new Error(
                `could not read regular-file identity for ${path}`
              );
            }
            return { blob: match[2], mode: match[1] };
          })();
    changes.push({ ...identity, path, status });
  }
  return buildMappedManifest(changes, mapPath);
}

function destinationDiffDigest(repository, from, to) {
  return digest(
    changeManifest(repository, from, to, (path) =>
      isMigratedPath(path) ? path : null
    )
  );
}

function createCommit(repository, commit) {
  const metadata = commitMetadata(repository, commit);
  git(
    repository,
    ["commit", "--no-gpg-sign", "--allow-empty-message", "-F", "-"],
    {
      input: metadata.message,
      env: {
        GIT_AUTHOR_NAME: metadata.authorName,
        GIT_AUTHOR_EMAIL: metadata.authorEmail,
        GIT_AUTHOR_DATE: metadata.authorDate,
        GIT_COMMITTER_NAME: metadata.committerName,
        GIT_COMMITTER_EMAIL: metadata.committerEmail,
        GIT_COMMITTER_DATE: metadata.committerDate,
      },
    }
  );
}

function reconstructEntry(repository, entry, sourceRef, legacyMapping) {
  const targetRevision =
    entry.parentNumber === null
      ? SOURCE_MAIN_REF
      : `refs/migration/source/${entry.parentNumber}`;
  assertCommit(
    repository,
    targetRevision,
    `source base for PR #${entry.snapshot.number}`
  );
  const sourceTargetSha = git(repository, [
    "rev-parse",
    targetRevision,
  ]).stdout.trim();
  const baseRevision = git(repository, [
    "merge-base",
    targetRevision,
    sourceRef,
  ]).stdout.trim();
  assertCommit(
    repository,
    baseRevision,
    `source merge base for PR #${entry.snapshot.number}`
  );
  const layout = sourceLayout(repository, baseRevision);
  const sourceClassification = inspectCommit(
    repository,
    baseRevision,
    sourceRef,
    layout,
    legacyMapping
  );

  git(repository, ["checkout", "--detach", entry.destinationBase]);
  git(repository, ["checkout", "-B", entry.destinationBranch]);
  const destinationBaseSha = git(repository, [
    "rev-parse",
    entry.destinationBase,
  ]).stdout.trim();
  const commits = git(repository, [
    "rev-list",
    "--reverse",
    "--first-parent",
    `${baseRevision}..${sourceRef}`,
  ])
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  const parentCounts = commits.map((commit) => {
    const parents = git(repository, [
      "rev-list",
      "--parents",
      "-n",
      "1",
      commit,
    ])
      .stdout.trim()
      .split(" ")
      .slice(1);
    return parents.length;
  });
  const hasMerge = reconstructionMode(parentCounts) === "net";
  const replayCommits = hasMerge ? [sourceRef] : commits;
  for (const commit of replayCommits) {
    const parents = git(repository, [
      "rev-list",
      "--parents",
      "-n",
      "1",
      commit,
    ])
      .stdout.trim()
      .split(" ")
      .slice(1);
    const parent = hasMerge ? baseRevision : replayParent(parents, commit);
    const classified = inspectCommit(
      repository,
      parent,
      commit,
      layout,
      legacyMapping
    );
    if (classified.included.length === 0) continue;
    const patch = mappedSourcePatch(
      repository,
      parent,
      commit,
      layout,
      legacyMapping
    );
    git(repository, ["apply", "--index", "--whitespace=nowarn", "-"], {
      input: patch,
      encoding: "buffer",
    });
    createCommit(repository, commit);
  }

  if (sourceClassification.included.length === 0) {
    return {
      action: "skip",
      reason: "no changes under imported CLI or CLI docs paths",
      destinationBaseSha,
      includedPaths: [],
      mappedPaths: [],
      excludedPaths: sourceClassification.excluded,
      sourceLayout: layout,
      sourceMergeBaseSha: baseRevision,
      sourceTargetSha,
    };
  }
  const sourceManifest = changeManifest(
    repository,
    baseRevision,
    sourceRef,
    (path) => mapSourcePath(path, layout, legacyMapping)
  );
  const destinationManifest = changeManifest(
    repository,
    entry.destinationBase,
    entry.destinationBranch,
    (path) => (isMigratedPath(path) ? path : null)
  );
  const sourceDiffSha256 = digest(sourceManifest);
  const destinationDiffSha256 = digest(destinationManifest);
  if (sourceDiffSha256 !== destinationDiffSha256) {
    throw new Error(
      `exact scoped diff verification failed for PR #${entry.snapshot.number}`
    );
  }
  return {
    action: "migrate",
    destinationBaseSha,
    headSha: git(repository, [
      "rev-parse",
      entry.destinationBranch,
    ]).stdout.trim(),
    diffSha256: destinationDiffSha256,
    includedPaths: sourceClassification.included,
    mappedPaths: sourceClassification.included
      .map((path) => {
        const mapped = mapSourcePath(path, layout, legacyMapping);
        if (!mapped) throw new Error(`included path ${path} has no mapping`);
        return mapped;
      })
      .sort(),
    excludedPaths: sourceClassification.excluded,
    sourceDiffSha256,
    sourceLayout: layout,
    sourceMergeBaseSha: baseRevision,
    sourceTargetSha,
  };
}

function isNotFound(result) {
  return (
    result.status !== 0 &&
    /(?:HTTP\s+404|status code 404|Not Found)/i.test(String(result.stderr))
  );
}

function verifyDestinationBranch(repository, entry, branchSha) {
  if (branchSha !== entry.headSha) return false;
  git(repository, [
    "fetch",
    "--no-tags",
    "origin",
    `refs/heads/${entry.destinationBranch}`,
  ]);
  const fetchedSha = git(repository, ["rev-parse", "FETCH_HEAD"]).stdout.trim();
  if (fetchedSha !== branchSha) return false;
  return (
    destinationDiffDigest(repository, entry.destinationBase, "FETCH_HEAD") ===
    entry.diffSha256
  );
}

function checkDestinationCollision(repository, entry) {
  if (entry.action === "skip") return;
  const refResult = command(
    "gh",
    [
      "api",
      `repos/${DESTINATION_REPOSITORY}/git/ref/heads/${encodeURIComponent(entry.destinationBranch)}`,
    ],
    { allowFailure: true }
  );
  const existingPull = findDestinationPull(entry);
  if (refResult.status !== 0) {
    if (!isNotFound(refResult)) {
      throw new Error(
        `could not determine whether destination branch ${entry.destinationBranch} exists: ${String(refResult.stderr).trim()}`
      );
    }
    if (existingPull)
      throw new Error(
        `destination PR collision for ${entry.destinationBranch}`
      );
    return;
  }
  const branchSha = JSON.parse(refResult.stdout).object.sha;
  const diffMatches = verifyDestinationBranch(repository, entry, branchSha);
  const action = destinationRecoveryAction({
    branchExists: true,
    branchSha,
    diffMatches,
    expectedHeadSha: entry.headSha,
    pullExists: Boolean(existingPull),
  });
  if (
    action === "reject" ||
    (existingPull && destinationPullResumeState(entry, existingPull) === null)
  ) {
    throw new Error(
      `destination branch/PR collision for ${entry.destinationBranch}`
    );
  }
}

async function buildPlan(workspace, snapshots) {
  command(
    "gh",
    ["repo", "clone", DESTINATION_REPOSITORY, "repository", "--", "--no-tags"],
    { cwd: workspace }
  );
  const repository = join(workspace, "repository");
  const originUrl = git(repository, [
    "remote",
    "get-url",
    "origin",
  ]).stdout.trim();
  if (!/(?:[:/])getsentry\/sentry-mcp(?:\.git)?$/.test(originUrl)) {
    throw new Error(`destination clone has unexpected origin ${originUrl}`);
  }
  git(repository, ["config", "commit.gpgsign", "false"]);
  git(repository, [
    "fetch",
    "--no-tags",
    repositoryUrl(SOURCE_REPOSITORY),
    `+refs/heads/main:${SOURCE_MAIN_REF}`,
    SOURCE_MAIN_CUTOFF,
  ]);
  assertCommit(repository, SOURCE_MAIN_CUTOFF, "source cutoff");
  assertCommit(repository, SOURCE_MAIN_REF, "source main");
  assertCommit(repository, SOURCE_LAYOUT_COMMIT, "source layout commit");
  if (!isAncestor(repository, SOURCE_LAYOUT_COMMIT, SOURCE_MAIN_CUTOFF)) {
    throw new Error(
      "source layout commit is not an ancestor of the source cutoff"
    );
  }
  const legacyMapping = deriveLegacyMapping(repository);
  if (legacyMapping.cliRoots.size === 0 || legacyMapping.docsRoots.size === 0) {
    throw new Error(
      "could not derive legacy CLI and docs lineage from the source layout commit"
    );
  }
  if (scopedPatch(repository, SOURCE_MAIN_CUTOFF, SOURCE_MAIN_REF).length > 0) {
    throw new Error(
      "source main contains CLI or CLI docs changes after the imported cutoff"
    );
  }
  for (const tip of FILTERED_TIPS) {
    assertCommit(repository, tip, "filtered import tip");
    if (!isAncestor(repository, tip, "origin/main"))
      throw new Error(`filtered import tip ${tip} is not in destination main`);
  }

  const entries = buildStackPlan(snapshots);
  for (const entry of entries) fetchSourcePull(repository, entry);
  const entriesByNumber = new Map(
    entries.map((entry) => [entry.snapshot.number, entry])
  );
  for (const entry of entries) {
    if (entry.parentNumber !== null) {
      const parent = entriesByNumber.get(entry.parentNumber);
      if (!parent?.action) {
        throw new Error(
          `source stack parent was not reconstructed for PR #${entry.snapshot.number}`
        );
      }
      entry.destinationBase =
        parent.action === "migrate"
          ? parent.destinationBranch
          : parent.destinationBase;
    }
    Object.assign(
      entry,
      reconstructEntry(
        repository,
        entry,
        `refs/migration/source/${entry.snapshot.number}`,
        legacyMapping
      )
    );
  }
  const metadata = destinationMetadata();
  for (const entry of entries) {
    entry.destinationMetadata =
      entry.action === "skip"
        ? null
        : {
            labels: entry.snapshot.labels.filter((label) =>
              metadata.labels.has(label)
            ),
            assignees: entry.snapshot.assignees.filter(isValidAssignee),
            reviewers: entry.snapshot.reviewers.filter(
              (reviewer) =>
                reviewer !== metadata.viewer && isValidReviewer(reviewer)
            ),
            reviewerTeams: entry.snapshot.reviewerTeams.filter(isValidTeam),
            milestone: entry.snapshot.milestone
              ? (metadata.milestones.get(entry.snapshot.milestone) ?? null)
              : null,
          };
  }
  for (const entry of entries) checkDestinationCollision(repository, entry);
  return {
    version: PLAN_VERSION,
    createdAt: new Date().toISOString(),
    sourceRepository: SOURCE_REPOSITORY,
    destinationRepository: DESTINATION_REPOSITORY,
    sourceMainCutoff: SOURCE_MAIN_CUTOFF,
    filteredTips: FILTERED_TIPS,
    entries,
  };
}

function validatePlanIdentity(expected, rebuilt) {
  const omitCreatedAt = ({ createdAt: _createdAt, ...plan }) => plan;
  if (
    stableJson(omitCreatedAt(expected)) !== stableJson(omitCreatedAt(rebuilt))
  ) {
    throw new Error(
      "rebuilt plan differs from exported plan; export a new dry-run plan before executing"
    );
  }
}

function destinationMetadata() {
  const viewer = api("user").login;
  const labelPages = api(
    `repos/${DESTINATION_REPOSITORY}/labels?per_page=100`,
    { paginate: true }
  );
  const milestonePages = api(
    `repos/${DESTINATION_REPOSITORY}/milestones?state=open&per_page=100`,
    { paginate: true }
  );
  return {
    viewer,
    labels: new Set(labelPages.flat().map((label) => label.name)),
    milestones: new Map(
      milestonePages
        .flat()
        .map((milestone) => [milestone.title, milestone.number])
    ),
  };
}

function isValidAssignee(login) {
  const result = command(
    "gh",
    [
      "api",
      `repos/${DESTINATION_REPOSITORY}/assignees/${encodeURIComponent(login)}`,
      "--silent",
    ],
    { allowFailure: true }
  );
  if (result.status === 0) return true;
  if (isNotFound(result)) return false;
  throw new Error(
    `could not validate destination assignee ${login}: ${String(result.stderr).trim()}`
  );
}

function isValidReviewer(login) {
  const result = command(
    "gh",
    [
      "api",
      `repos/${DESTINATION_REPOSITORY}/collaborators/${encodeURIComponent(login)}/permission`,
    ],
    { allowFailure: true }
  );
  if (result.status !== 0) {
    if (isNotFound(result)) return false;
    throw new Error(
      `could not validate destination reviewer ${login}: ${String(result.stderr).trim()}`
    );
  }
  const permission = JSON.parse(result.stdout).permission;
  return permission && permission !== "none";
}

function isValidTeam(team) {
  const [owner, repository] = DESTINATION_REPOSITORY.split("/");
  const result = command(
    "gh",
    [
      "api",
      `orgs/${owner}/teams/${encodeURIComponent(team)}/repos/${owner}/${repository}`,
      "--silent",
    ],
    { allowFailure: true }
  );
  if (result.status === 0) return true;
  if (isNotFound(result)) return false;
  throw new Error(
    `could not validate destination reviewer team ${team}: ${String(result.stderr).trim()}`
  );
}

async function verifyRemotePull(repository, entry, number) {
  const pull = api(`repos/${DESTINATION_REPOSITORY}/pulls/${number}`);
  const resumeState = destinationPullResumeState(entry, pull);
  if (resumeState === null) {
    throw new Error(
      `destination PR #${number} does not have the exact planned head, base, or migration-owned metadata`
    );
  }
  git(repository, [
    "fetch",
    "--no-tags",
    "origin",
    `refs/heads/${entry.destinationBranch}`,
  ]);
  const remoteSha = git(repository, ["rev-parse", "FETCH_HEAD"]).stdout.trim();
  if (remoteSha !== entry.headSha)
    throw new Error(
      `destination branch ${entry.destinationBranch} moved after push`
    );
  if (
    destinationDiffDigest(repository, entry.destinationBase, remoteSha) !==
    entry.diffSha256
  )
    throw new Error(
      `destination PR #${number} remote diff does not match the plan`
    );
  return { pull, resumeState };
}

function findDestinationPull(entry) {
  const [owner] = DESTINATION_REPOSITORY.split("/");
  const pulls = api(
    `repos/${DESTINATION_REPOSITORY}/pulls?state=all&head=${owner}:${encodeURIComponent(entry.destinationBranch)}&per_page=10`
  );
  const match = pulls[0];
  return match
    ? api(`repos/${DESTINATION_REPOSITORY}/pulls/${match.number}`)
    : null;
}

function sourceAlreadyLinked(entry, destinationUrl) {
  const pages = api(
    `repos/${SOURCE_REPOSITORY}/issues/${entry.snapshot.number}/comments?per_page=100`,
    { paginate: true }
  );
  return pages
    .flat()
    .some((comment) => String(comment.body ?? "").includes(destinationUrl));
}

async function verifySourceChain(entry, entriesByNumber) {
  const visited = new Set();
  for (let current = entry; current; ) {
    if (visited.has(current.snapshot.number)) {
      throw new Error(
        `cycle while verifying source stack for PR #${entry.snapshot.number}`
      );
    }
    visited.add(current.snapshot.number);
    await verifySnapshot(current.snapshot);
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

function fetchWriteReference(repository, remote, remoteRef, localRef) {
  git(repository, ["fetch", "--no-tags", remote, `+${remoteRef}:${localRef}`]);
  return git(repository, ["rev-parse", localRef]).stdout.trim();
}

async function verifyLiveWriteReferences(repository, entry, entriesByNumber) {
  await verifySourceChain(entry, entriesByNumber);
  await verifyWriteReferences(
    entry,
    entriesByNumber,
    (current) =>
      fetchWriteReference(
        repository,
        repositoryUrl(current.snapshot.base.repository),
        `refs/heads/${current.snapshot.base.branch}`,
        `refs/migration/write/source-target/${current.snapshot.number}`
      ),
    (current) =>
      fetchWriteReference(
        repository,
        "origin",
        `refs/heads/${current.destinationBase}`,
        `refs/migration/write/destination-base/${current.snapshot.number}`
      )
  );
}

async function writeWithFreshReferences(
  phase,
  repository,
  entry,
  entriesByNumber,
  write
) {
  return await guardedMigrationWrite(
    phase,
    async () => verifyLiveWriteReferences(repository, entry, entriesByNumber),
    write
  );
}

async function executePlan(repository, plan) {
  const entriesByNumber = new Map(
    plan.entries.map((entry) => [entry.snapshot.number, entry])
  );
  for (const entry of plan.entries) {
    if (entry.action === "skip") {
      console.log(`skip #${entry.snapshot.number}: ${entry.reason}`);
      continue;
    }
    await verifySourceChain(entry, entriesByNumber);
    const refResult = command(
      "gh",
      [
        "api",
        `repos/${DESTINATION_REPOSITORY}/git/ref/heads/${encodeURIComponent(entry.destinationBranch)}`,
      ],
      { allowFailure: true }
    );
    const existingPull = findDestinationPull(entry);
    let recoveryAction;
    if (refResult.status === 0) {
      const branchSha = JSON.parse(refResult.stdout).object.sha;
      recoveryAction = destinationRecoveryAction({
        branchExists: true,
        branchSha,
        diffMatches: verifyDestinationBranch(repository, entry, branchSha),
        expectedHeadSha: entry.headSha,
        pullExists: Boolean(existingPull),
      });
      if (
        recoveryAction === "reject" ||
        (existingPull &&
          destinationPullResumeState(entry, existingPull) === null)
      ) {
        throw new Error(
          `destination branch/PR collision for ${entry.destinationBranch}`
        );
      }
    } else {
      if (!isNotFound(refResult)) {
        throw new Error(
          `could not determine whether destination branch ${entry.destinationBranch} exists: ${String(refResult.stderr).trim()}`
        );
      }
      if (existingPull)
        throw new Error(
          `destination PR collision for ${entry.destinationBranch}`
        );
      recoveryAction = destinationRecoveryAction({
        branchExists: false,
        branchSha: null,
        diffMatches: false,
        expectedHeadSha: entry.headSha,
        pullExists: false,
      });
      await writeWithFreshReferences(
        "push-branch",
        repository,
        entry,
        entriesByNumber,
        () =>
          git(repository, [
            "push",
            "--atomic",
            `--force-with-lease=refs/heads/${entry.destinationBranch}:`,
            "origin",
            `${entry.headSha}:refs/heads/${entry.destinationBranch}`,
          ])
      );
      if (!verifyDestinationBranch(repository, entry, entry.headSha)) {
        throw new Error(
          `pushed destination branch ${entry.destinationBranch} does not match the plan`
        );
      }
    }

    let pull = existingPull;
    if (
      !pull &&
      (recoveryAction === "push" || recoveryAction === "create-pull")
    ) {
      const createArgs = [
        "pr",
        "create",
        "--repo",
        DESTINATION_REPOSITORY,
        "--head",
        entry.destinationBranch,
        "--base",
        entry.destinationBase,
        "--title",
        entry.snapshot.title,
        "--body",
        migrationPullBody(entry),
      ];
      if (entry.snapshot.draft) createArgs.push("--draft");
      const result = await writeWithFreshReferences(
        "create-pull",
        repository,
        entry,
        entriesByNumber,
        () => command("gh", createArgs)
      );
      const number = Number(result.stdout.trim().match(/\/(\d+)\/?$/)?.[1]);
      if (!Number.isInteger(number))
        throw new Error(
          `could not parse created PR URL: ${result.stdout.trim()}`
        );
      pull = api(`repos/${DESTINATION_REPOSITORY}/pulls/${number}`);
    }

    let verified = await verifyRemotePull(repository, entry, pull.number);
    if (verified.resumeState === "created") {
      await writeWithFreshReferences(
        "update-metadata",
        repository,
        entry,
        entriesByNumber,
        () =>
          api(`repos/${DESTINATION_REPOSITORY}/issues/${pull.number}`, {
            method: "PATCH",
            input: {
              labels: entry.destinationMetadata.labels,
              assignees: entry.destinationMetadata.assignees,
              milestone: entry.destinationMetadata.milestone,
            },
          })
      );
      verified = await verifyRemotePull(repository, entry, pull.number);
    }
    const reviewers = entry.destinationMetadata.reviewers;
    const teamReviewers = entry.destinationMetadata.reviewerTeams;
    if (
      verified.resumeState === "issue-metadata" &&
      (reviewers.length > 0 || teamReviewers.length > 0)
    ) {
      await writeWithFreshReferences(
        "request-reviewers",
        repository,
        entry,
        entriesByNumber,
        () =>
          api(
            `repos/${DESTINATION_REPOSITORY}/pulls/${pull.number}/requested_reviewers`,
            {
              method: "POST",
              input: { reviewers, team_reviewers: teamReviewers },
            }
          )
      );
      verified = await verifyRemotePull(repository, entry, pull.number);
    }
    if (verified.resumeState !== "complete") {
      throw new Error(
        `destination PR #${pull.number} metadata did not reach the planned state`
      );
    }

    await verifyRemotePull(repository, entry, pull.number);
    if (!sourceAlreadyLinked(entry, pull.html_url)) {
      await writeWithFreshReferences(
        "comment-source",
        repository,
        entry,
        entriesByNumber,
        () =>
          command("gh", [
            "pr",
            "comment",
            String(entry.snapshot.number),
            "--repo",
            SOURCE_REPOSITORY,
            "--body",
            `Migrated to ${pull.html_url} after exact base and scoped-diff verification.`,
          ])
      );
    }
    console.log(`migrated #${entry.snapshot.number} -> ${pull.html_url}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  command("gh", ["auth", "status"]);
  command("git", ["--version"]);
  const workspace = await mkdtemp(join(tmpdir(), "cli-pr-migration-"));
  try {
    const snapshots = await listSourceSnapshots();
    const rebuilt = await buildPlan(workspace, snapshots);
    if (!options.execute) {
      await writeFile(options.output, `${JSON.stringify(rebuilt, null, 2)}\n`, {
        flag: "wx",
      });
      console.log(
        `Exported read-only migration plan for ${rebuilt.entries.length} open PRs to ${options.output}`
      );
      console.log(`Plan digest: ${digest(rebuilt)}`);
      return;
    }
    const exported = JSON.parse(await readFile(options.plan, "utf8"));
    validatePlanIdentity(exported, rebuilt);
    await executePlan(join(workspace, "repository"), rebuilt);
  } finally {
    if (options.keepTemp)
      console.error(`Temporary reconstruction kept at ${workspace}`);
    else await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
