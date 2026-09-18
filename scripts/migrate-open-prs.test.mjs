import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMappedManifest,
  buildStackPlan,
  classifyNameStatus,
  classifySourcePaths,
  createLegacyPathMapping,
  destinationPullResumeState,
  destinationRecoveryAction,
  digest,
  guardedMigrationWrite,
  isMigratedPath,
  MIGRATION_WRITE_PHASES,
  mapSourcePath,
  migrationPullBody,
  parseArgs,
  reconstructionMode,
  replayParent,
  snapshotPull,
  verifyWriteReferences,
} from "./lib/pr-migration-plan.mjs";

const MOVED_REFERENCE_ERROR = /moved to/;

function snapshot(number, head, base = "main", repository = "getsentry/cli") {
  return {
    number,
    title: `PR ${number}`,
    body: "",
    author: "author",
    state: "open",
    draft: false,
    head: { repository, branch: head, sha: `${number}-head` },
    base: { repository, branch: base, sha: `${number}-base` },
    labels: [],
    assignees: [],
    reviewers: [],
    reviewerTeams: [],
    milestone: null,
    url: `https://github.com/getsentry/cli/pull/${number}`,
  };
}

test("maps multiple stacks by exact repository and source base branch", () => {
  const entries = buildStackPlan([
    snapshot(1588, "second", "first"),
    snapshot(1572, "first"),
    snapshot(1405, "c", "b"),
    snapshot(1402, "a"),
    snapshot(1404, "b", "a"),
  ]);
  assert.deepEqual(
    entries.map((entry) => [
      entry.snapshot.number,
      entry.parentNumber,
      entry.destinationBase,
    ]),
    [
      [1402, null, "main"],
      [1572, null, "main"],
      [1404, 1402, "migrated/cli-pr-1402"],
      [1588, 1572, "migrated/cli-pr-1572"],
      [1405, 1404, "migrated/cli-pr-1404"],
    ]
  );
});

test("accepts stale base SHAs for root and stacked pull requests", () => {
  const parent = snapshot(10, "parent");
  parent.base.sha = "old-main";
  const child = snapshot(11, "child", "parent");
  child.base.sha = "old-parent-head";
  const entries = buildStackPlan([child, parent]);
  assert.deepEqual(
    entries.map((entry) => [entry.snapshot.number, entry.parentNumber]),
    [
      [10, null],
      [11, 10],
    ]
  );
});

test("does not confuse equal branch names from forks", () => {
  const parent = snapshot(1, "topic");
  parent.head.repository = "alice/cli";
  const child = snapshot(2, "child");
  child.base.branch = "topic";
  assert.throws(
    () => buildStackPlan([parent, child]),
    /neither main nor another open PR head/
  );
});

test("rejects pull requests targeting another repository", () => {
  const pull = snapshot(1, "topic");
  pull.base.repository = "alice/cli";
  assert.throws(() => buildStackPlan([pull]), /unexpected repository/);
});

test("rejects ambiguous heads and stack cycles", () => {
  assert.throws(
    () => buildStackPlan([snapshot(1, "same"), snapshot(2, "same")]),
    /ambiguous/
  );
  assert.throws(
    () => buildStackPlan([snapshot(1, "a", "b"), snapshot(2, "b", "a")]),
    /cycle/
  );
});

test("classifies only imported destination paths", () => {
  assert.equal(isMigratedPath("packages/cli/src/index.ts"), true);
  assert.equal(isMigratedPath("apps/cli-docs"), true);
  assert.equal(isMigratedPath(".github/workflows/ci.yml"), false);
  assert.deepEqual(
    classifyNameStatus([
      "M",
      "packages/cli/src/index.ts",
      "A",
      ".github/workflows/ci.yml",
    ]),
    {
      included: ["packages/cli/src/index.ts"],
      excluded: [".github/workflows/ci.yml"],
    }
  );
});

test("maps only paths in the explicit historical layout move", () => {
  const mapping = createLegacyPathMapping();
  assert.equal(mapping.cliRoots.has("src"), true);
  assert.equal(mapping.cliRoots.has("test"), true);
  assert.equal(mapping.docsRoots.has("src"), true);
  assert.equal(
    mapSourcePath("src/index.ts", "legacy", mapping),
    "packages/cli/src/index.ts"
  );
  assert.equal(
    mapSourcePath("docs/src/index.mdx", "legacy", mapping),
    "apps/cli-docs/src/index.mdx"
  );
  assert.equal(
    mapSourcePath(".github/workflows/ci.yml", "legacy", mapping),
    null
  );
  assert.equal(mapSourcePath(".gitignore", "legacy", mapping), null);
  assert.equal(mapSourcePath("package.json", "legacy", mapping), null);
  assert.equal(mapSourcePath("docs/pnpm-lock.yaml", "legacy", mapping), null);
  assert.deepEqual(
    classifySourcePaths(
      [
        "src/index.ts",
        "docs/package.json",
        ".gitignore",
        "package.json",
        "docs/pnpm-lock.yaml",
        ".github/workflows/ci.yml",
      ],
      "legacy",
      mapping
    ),
    {
      included: ["docs/package.json", "src/index.ts"],
      excluded: [
        ".github/workflows/ci.yml",
        ".gitignore",
        "docs/pnpm-lock.yaml",
        "package.json",
      ],
      mapped: ["apps/cli-docs/package.json", "packages/cli/src/index.ts"],
    }
  );
});

test("does not infer lineage from a same-named destination root", () => {
  const mapping = createLegacyPathMapping();
  assert.equal(mapping.cliRoots.has("admin"), false);
  assert.equal(mapSourcePath("admin/config.ts", "legacy", mapping), null);
});

test("keeps monorepo paths unchanged and rejects unknown layouts", () => {
  assert.equal(
    mapSourcePath("packages/cli/src/index.ts", "monorepo"),
    "packages/cli/src/index.ts"
  );
  assert.equal(mapSourcePath("src/index.ts", "monorepo"), null);
  assert.throws(() => mapSourcePath("src/index.ts", "future"), /unknown/);
});

test("replays a merge commit against its first parent", () => {
  assert.equal(replayParent(["first", "merged"], "commit"), "first");
  assert.throws(() => replayParent([], "root"), /root commit/);
  assert.equal(reconstructionMode([1, 1, 2, 1]), "net");
  assert.equal(reconstructionMode([1, 1]), "commits");
});

test("verifies mapped changes by exact blob identity", () => {
  const mapping = {
    cliRoots: new Set(["src"]),
    docsRoots: new Set(["a.md"]),
  };
  const manifest = buildMappedManifest(
    [
      { blob: "blob-b", mode: "100644", path: "src/b.ts", status: "M" },
      {
        blob: "admin",
        mode: "100644",
        path: ".github/ci.yml",
        status: "M",
      },
      { blob: "blob-a", mode: "100755", path: "docs/a.md", status: "A" },
    ],
    (path) => mapSourcePath(path, "legacy", mapping)
  );
  assert.deepEqual(manifest, [
    {
      blob: "blob-a",
      mode: "100755",
      path: "apps/cli-docs/a.md",
      status: "A",
    },
    {
      blob: "blob-b",
      mode: "100644",
      path: "packages/cli/src/b.ts",
      status: "M",
    },
  ]);
  assert.notEqual(
    digest(manifest),
    digest([
      {
        blob: "changed",
        mode: "100755",
        path: "apps/cli-docs/a.md",
        status: "A",
      },
      {
        blob: "blob-b",
        mode: "100644",
        path: "packages/cli/src/b.ts",
        status: "M",
      },
    ])
  );
});

function destinationPull(entry, overrides = {}) {
  return {
    state: "open",
    title: entry.snapshot.title,
    body: migrationPullBody(entry),
    draft: entry.snapshot.draft,
    base: { ref: entry.destinationBase, sha: entry.destinationBaseSha },
    head: {
      ref: entry.destinationBranch,
      sha: entry.headSha,
      repo: { full_name: "getsentry/sentry-mcp" },
    },
    labels: [],
    assignees: [],
    requested_reviewers: [],
    requested_teams: [],
    milestone: null,
    ...overrides,
  };
}

test("resumes only exact migration-owned destination pull metadata", () => {
  const entry = {
    snapshot: snapshot(42, "topic"),
    destinationBase: "main",
    destinationBaseSha: "base",
    destinationBranch: "migrated/cli-pr-42",
    headSha: "head",
    destinationMetadata: {
      labels: ["CLI", "bug"],
      assignees: ["alice"],
      milestone: 7,
      reviewers: ["bob"],
      reviewerTeams: ["cli"],
    },
  };
  assert.equal(
    destinationPullResumeState(entry, destinationPull(entry)),
    "created"
  );
  const issueMetadata = destinationPull(entry, {
    labels: [{ name: "bug" }, { name: "CLI" }],
    assignees: [{ login: "alice" }],
    milestone: { number: 7 },
  });
  assert.equal(
    destinationPullResumeState(entry, issueMetadata),
    "issue-metadata"
  );
  assert.equal(
    destinationPullResumeState(entry, {
      ...issueMetadata,
      requested_reviewers: [{ login: "bob" }],
      requested_teams: [{ slug: "cli" }],
    }),
    "complete"
  );
  for (const edited of [
    { title: "user title" },
    { body: `${migrationPullBody(entry)}\nuser edit` },
    { draft: true },
    { labels: [{ name: "user-label" }] },
    { assignees: [{ login: "mallory" }] },
    { milestone: { number: 99 } },
    { requested_reviewers: [{ login: "mallory" }] },
  ]) {
    assert.equal(
      destinationPullResumeState(entry, destinationPull(entry, edited)),
      null
    );
  }
});

test("keeps branch-without-pull recovery independent of pull metadata", () => {
  assert.equal(
    destinationRecoveryAction({
      branchExists: true,
      branchSha: "head",
      diffMatches: true,
      expectedHeadSha: "head",
      pullExists: false,
    }),
    "create-pull"
  );
});

test("sorts manifests by code units without locale comparison", () => {
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = () => {
    throw new Error("localeCompare must not be called");
  };
  try {
    const manifest = buildMappedManifest(
      [
        { blob: "lower", mode: "100644", path: "a", status: "M" },
        { blob: "upper", mode: "100644", path: "Z", status: "M" },
        { blob: "accent", mode: "100644", path: "ä", status: "M" },
      ],
      (path) => path
    );
    assert.deepEqual(
      manifest.map((entry) => entry.path),
      ["Z", "a", "ä"]
    );
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test("recovers an exact branch without a pull request", () => {
  assert.equal(
    destinationRecoveryAction({
      branchExists: true,
      branchSha: "head",
      diffMatches: true,
      expectedHeadSha: "head",
      pullExists: false,
    }),
    "create-pull"
  );
  assert.equal(
    destinationRecoveryAction({
      branchExists: true,
      branchSha: "other",
      diffMatches: true,
      expectedHeadSha: "head",
      pullExists: false,
    }),
    "reject"
  );
  assert.equal(
    destinationRecoveryAction({
      branchExists: true,
      branchSha: "head",
      diffMatches: false,
      expectedHeadSha: "head",
      pullExists: false,
    }),
    "reject"
  );
});

test("removes source-closing arguments", () => {
  assert.throws(() => parseArgs(["--close-source"]), /unknown argument/);
  assert.deepEqual(parseArgs(["--execute", "--plan", "plan.json"]), {
    execute: true,
    keepTemp: false,
    output: "cli-open-pr-migration-plan.json",
    plan: "plan.json",
  });
});

test("fails closed on rename, copy, malformed, and unsafe paths", () => {
  assert.throws(() => classifyNameStatus(["R100", "a", "b"]), /rename\/copy/);
  assert.throws(() => classifyNameStatus(["C100", "a", "b"]), /rename\/copy/);
  assert.throws(() => classifyNameStatus(["M"]), /malformed/);
  assert.throws(
    () => classifyNameStatus(["M", "packages/cli/../secret"]),
    /unsafe/
  );
});

test("normalizes and sorts all required pull metadata", () => {
  const result = snapshotPull({
    number: 3,
    state: "open",
    title: "title",
    body: null,
    draft: true,
    html_url: "url",
    user: { login: "alice" },
    head: { ref: "topic", sha: "h", repo: { full_name: "alice/cli" } },
    base: { ref: "main", sha: "b", repo: { full_name: "getsentry/cli" } },
    labels: [{ name: "z" }, { name: "a" }],
    assignees: [{ login: "bob" }],
    requested_reviewers: [{ login: "dave" }, { login: "carol" }],
    requested_teams: [{ slug: "cli" }],
    milestone: { title: "M1" },
  });
  assert.deepEqual(result.labels, ["a", "z"]);
  assert.deepEqual(result.reviewers, ["carol", "dave"]);
  assert.equal(result.head.repository, "alice/cli");
  assert.equal(result.state, "open");
  assert.equal(result.body, "");
  assert.equal(result.milestone, "M1");
});

test("plan digests are key-order independent", () => {
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
});

function writeReferenceEntries() {
  const root = {
    snapshot: snapshot(10, "root"),
    parentNumber: null,
    action: "migrate",
    sourceTargetSha: "source-main",
    destinationBase: "main",
    destinationBaseSha: "destination-main",
  };
  const skipped = {
    snapshot: snapshot(11, "skipped", "root"),
    parentNumber: 10,
    action: "skip",
    sourceTargetSha: "root-head",
    destinationBase: "migrated/cli-pr-10",
    destinationBaseSha: "root-destination-head",
  };
  const leaf = {
    snapshot: snapshot(12, "leaf", "skipped"),
    parentNumber: 11,
    action: "migrate",
    sourceTargetSha: "skipped-head",
    destinationBase: "migrated/cli-pr-10",
    destinationBaseSha: "root-destination-head",
  };
  return {
    leaf,
    entriesByNumber: new Map([
      [10, root],
      [11, skipped],
      [12, leaf],
    ]),
  };
}

test("verifies live root, stacked, and skipped-parent refs before writes", async () => {
  const { leaf, entriesByNumber } = writeReferenceEntries();
  const sourceResolutions = [];
  const destinationResolutions = [];
  await verifyWriteReferences(
    leaf,
    entriesByNumber,
    (entry) => {
      sourceResolutions.push(entry.snapshot.number);
      return entry.sourceTargetSha;
    },
    (entry) => {
      destinationResolutions.push(entry.snapshot.number);
      return entry.destinationBaseSha;
    }
  );
  assert.deepEqual(sourceResolutions, [12, 11, 10]);
  assert.deepEqual(destinationResolutions, [12, 11, 10]);
});

for (const drift of ["source target", "destination base"]) {
  test(`${drift} drift blocks every GitHub write phase`, async () => {
    const { leaf, entriesByNumber } = writeReferenceEntries();
    const mutations = [];
    for (const phase of MIGRATION_WRITE_PHASES) {
      await assert.rejects(
        guardedMigrationWrite(
          phase,
          () =>
            verifyWriteReferences(
              leaf,
              entriesByNumber,
              (entry) =>
                drift === "source target" && entry.snapshot.number === 11
                  ? "moved-source-target"
                  : entry.sourceTargetSha,
              (entry) =>
                drift === "destination base" && entry.snapshot.number === 11
                  ? "moved-destination-base"
                  : entry.destinationBaseSha
            ),
          () => mutations.push(phase)
        ),
        MOVED_REFERENCE_ERROR
      );
    }
    assert.deepEqual(mutations, []);
  });
}
