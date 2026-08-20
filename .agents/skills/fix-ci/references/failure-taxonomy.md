# CI Failure Taxonomy

Categorize the failure before attempting a fix. The category
determines the response strategy.

## Categories

### 1. Test failure

**Signature:** Test runner output with `FAIL`, assertion errors,
expected/actual diffs.

**Response:** Read the failing test, understand what it asserts, check
if the test expectation is wrong (your change intentionally altered
behavior) or if the code has a bug. Fix the test if the expectation
is outdated; fix the code if the behavior is wrong.

### 2. Type / lint error

**Signature:** `tsc` errors (TS####), ESLint/Biome errors with rule
names, type mismatch messages.

**Response:** Fix the type or lint issue directly. These are usually
mechanical. For lint rules you disagree with, fix the code anyway —
don't modify lint config.

### 3. Build error

**Signature:** Bundler/compiler errors, missing modules, import
resolution failures.

**Response:** Check if your change broke an import path, removed an
export, or changed a file name. Fix the import/export. If the build
error is in unrelated code, note it and investigate whether it's
pre-existing.

### 4. Snapshot diff

**Signature:** Snapshot test failures showing before/after diffs.

**Response:** If your change intentionally altered the output, update
the snapshot (`--update-snapshots`, `-u`, etc.). If the diff is
unexpected, investigate why the output changed.

### 5. Flaky test

**Signature:** The test passes on retry. The failure involves timing,
network, or random ordering. The test name may appear in known-flaky
lists.

**Response:** Re-run once: `gh run rerun <id> --failed`. Do not
attempt to fix the test — flaky test fixes are out of scope for a
CI-fix skill.

### 6. Infrastructure issue

**Signature:** Network timeouts, registry errors (`npm ERR! 503`),
Docker pull failures, runner out of disk, GitHub Actions service
degradation.

**Response:** BLOCKED. These are transient or platform-level issues.
Post a comment noting the infrastructure failure and stop.

## Decision tree

```
Is it a test failure?
├── Yes → Did your change intentionally alter behavior?
│   ├── Yes → Update the test/snapshot
│   └── No → Fix the code bug
└── No → Is it a type/lint/build error?
    ├── Yes → Fix the type/lint/import issue
    └── No → Is it intermittent / passes on retry?
        ├── Yes → Re-run once, then stop
        └── No → Infrastructure issue → BLOCKED
```
