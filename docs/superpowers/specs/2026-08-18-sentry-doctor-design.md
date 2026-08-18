# `sentry doctor` — Design

Date: 2026-08-18
Status: approved for implementation planning
Source proposal: `hackweek-proposal-sentry-doctor.md`

## 1. Summary

`sentry doctor` is a fast, read-only, repeatable health check for an existing
Sentry install. It answers one question — *is Sentry actually working here, and
if not, what's wrong* — in seconds, on any platform, and produces a
consent-based export for support triage plus an agent-ready fix prompt.

Two commands, one seam:

- `sentry doctor` — local. Seconds. Always safe. Server-side truth from the
  Sentry API plus local config capture.
- `sentry doctor --fix` — escalates to the existing remote `sentry-wizard`
  Mastra workflow in dry-run to obtain a real patchset. Minutes. Opt-in.

The local path is the product. `--fix` is additive and can be cut without
leaving a hole.

## 2. Problem

When Sentry "doesn't work," the failure is almost never in the SDK. It's a
stale DSN, a project that never received an event, a source-map upload that was
never configured, a key that got rotated, an SDK fourteen majors behind, or an
init call that never runs. Diagnosing this today means a support round-trip
where the first three messages are spent collecting configuration the user
could have exported in one command.

## 3. What already exists (verified)

Findings below were verified by reading code in this repository, not inferred.

**`sentry init` is not local logic.** `src/lib/init/wizard-runner.ts` drives a
*remote* Mastra workflow (`WORKFLOW_ID = "sentry-wizard"` at
`https://sentry-init-agent.getsentry.workers.dev`, a separate Cloudflare Worker
in a different repository). The CLI is a generic suspend/resume executor of
tool calls. It holds **zero** platform knowledge — no framework allowlist
exists anywhere in `src/lib/init/`. All platform intelligence is server-side.
Consequently: `init` gets its breadth from an LLM's runtime knowledge and needs
no framework list, while doctor's local tiers know only what they encode.

**Dry-run is genuinely safe server-side.** A probe run confirmed zero projects
or teams created and a byte-identical filesystem. Four write paths are guarded
in code:

| Path | Guard |
|---|---|
| `src/lib/init/tools/create-sentry-project.ts` (~240) | returns `projectId: "(dry-run)"` before `resolveProjectCreation()` |
| `src/lib/resolve-team.ts:240` | returns before `autoCreateTeam()` |
| `src/lib/init/tools/file-changes/apply.ts:153` | returns before any write |
| `src/lib/init/tools/run-commands.ts:87` | pushes `"(dry-run: skipped)"` instead of executing |

**The wizard does not bail on an existing install.** The CLI precomputes
detection locally (`wizard-runner.ts:1020`, `precomputeSentryDetection`) and
ships `existingSentry: {status, signals, dsn}` in the start request. The
workflow folds it into its evidence, short-circuits project resolution, and
emits a targeted, anchored patchset. A probe that hand-instrumented a Next.js
template client-only got back exactly its defect: `sentry.server.config.ts`,
`sentry.edge.config.ts`, `instrumentation.ts`.

**Diagnostic material is already on the wire and discarded.** Every
`codemodPlan` entry carries a human `description` and a `riskLevel`, and the
`verify-changes` step emits a classified problem list the CLI auto-continues
past (`wizard-runner.ts:419`).

**Reusable infrastructure:**

- `src/lib/dsn/` — `detectAllDsns()` (all DSNs, all sources),
  `isPlaceholderPublicKey()`, `isPlaceholderNumericId()`, `resolveProject()`,
  `getAccessibleProjects()`, `formatConflictError()`.
- `src/lib/api/projects.ts:479` — `findProjectByDsnKey(publicKey)` resolves a
  DSN to a project **without knowing the org**, fanning out across regions.
- `src/lib/scan/` — policy-free walker: `collectGrep({cwd, pattern,
  ...WalkOptions})` with gitignore handling, skip dirs, byte caps, monorepo
  depth reset, mtime capture. `scan-options.ts` states that presets belong to
  callers.
- `src/lib/init/workflow-inputs.ts` — `COMMON_CONFIG_FILES`, 69 exact paths.
- `src/lib/init/verify-setup.ts:72` — `scrubOutputLine()`, the redaction
  primitive.
- `src/lib/detect-agent.ts` — `detectAgent()`, for the in-agent judgement path.
- `src/commands/info.ts` — the precedent for command shape: `auth: false`,
  snake_case machine contract, `this.process.exitCode = 1`.

**Two gaps.** `sourcemaps.ts`, `debug-files.ts`, and `proguard.ts` are
upload-only — no list functions, so "are mappings uploaded for this release"
needs a raw API call. There is documented in-repo precedent for exactly this
(`projects.ts:486-490` keeps a raw `?query=dsn:` call because the param is
absent from the OpenAPI spec). No YAML, TOML, or XML parser is installed.

**Corrections to the source proposal.** The proposal states that
`verify-setup.ts` proves events flow end-to-end. It does not.
`buildVerifyEnv()` points the SDK at a *local* Spotlight sidecar and the check
resolves when an envelope reaches the local buffer (`verify-setup.ts:367-369`)
— it proves SDK emission, not Sentry-side ingestion. The proposal also assumes
a support-ticket export destination; none exists in this repository.

## 4. Approach

Rejected: **doctor as a pure `init --dry-run` wrapper.** Cheapest to build and
best fix quality, but it inherits two disqualifying properties. It takes
**4.5 minutes** (270s and 259s on consecutive probe runs, 12 HTTP round-trips —
reproducible, not variance). And it diagnoses against *the feature flags you
passed*, not what your app does: a probe passing `--features errors,tracing`
against a project with a working `enableLogs: true` got back a proposal to
**delete it**. Two of six hunks touched already-correct files.

Rejected: **local only.** Detection is near-total without the workflow, but
cause attribution is weak, and we'd forgo a real patchset we can already get.

Chosen: **local fast path, workflow as opt-in depth.**

The reason this is a seam and not a compromise: doctor already knows what is
configured, so `--fix` derives the `--features` set from *detected config*
rather than from flags. The destructive `enableLogs` hunk was an artifact of
the workflow being told the wrong thing, and doctor is the one component that
knows the right thing.

Division of labor: **local answers "is it broken." The workflow answers "here
is the patch."**

## 5. Architecture

Four stages. Only the first two perform I/O.

```
capture(cwd)         → Capture         // filesystem only
resolve(capture)     → ServerFacts     // Sentry API only
run(checks, ctx)     → CheckResult[]   // pure
render(results, ctx) → human | json | prompt
```

```ts
type Check = {
  id: string;
  run(ctx: { capture: Capture; server: ServerFacts }): CheckResult | CheckResult[];
};

type CheckResult = {
  id: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
  evidence?: { file: string; line?: number }[];
  fixHint?: string;
};
```

**Checks are pure over `(Capture, ServerFacts)`.** This is the load-bearing
decision. It buys: checks testable against fixtures with no network or
filesystem mocking; `--offline` for free (skip `resolve`, tier-1 checks return
`skip` with a reason); a reproducible JSON report. It is also why capture is a
value rather than something each check performs for itself.

This is the seam `doctor perf` (proposal §7) plugs into later. A new check is a
new object in a registry — no changes to collection, rendering, or export.

## 6. Tier 1 — server-side truth

Platform-agnostic. No source reading. Covers all platforms with no per-platform
code, and is the highest-value tier, so it ships first.

| Check id | Method | Diagnoses |
|---|---|---|
| `dsn.present` | `detectAllDsns()` | no DSN anywhere |
| `dsn.placeholder` | `isPlaceholderPublicKey/NumericId` | copied the docs example |
| `dsn.conflict` | `detectAllDsns()` > 1 distinct | two projects fighting |
| `dsn.resolves` | `findProjectByDsnKey()` | typo'd, stale, wrong-env, borrowed DSN |
| `project.first_event` | `project.firstEvent` is null | **never worked, not once** |
| `project.last_event` | `listIssuesPaginated` by `lastSeen` | "worked until Tuesday" |
| `project.key_active` | `getProjectKeys()` membership + enabled | key rotated or disabled |
| `project.environments` | `listProjectEnvironments()` | everything in one env |
| `release.attribution` | release `firstEvent`/`lastEvent` | events not attributed to a release |
| `artifacts.uploaded` | raw API (see §3 gap) | unreadable stack traces |

**The check that earns the command** is a cross-check no single tier provides:
SDK declared in the manifest, DSN present and valid and resolving to a real
project — and that project has `firstEvent: null`. That is "your install is
broken," stated with certainty, on any platform, in about two seconds. The
inverse also fires: valid DSN, no local SDK dependency → you are pointed at a
project nothing is instrumented for.

## 7. Tier 2 — capture

Collect broadly, judge narrowly. An unrecognized key gets captured, not
misjudged — which is why this is a collection table rather than a rules table.

### 7.1 Mechanism

Capturing `Sentry.init({...})` in TypeScript, `sentry { ... }` in Gradle, and
`sentry_upload_dsym(...)` in a Fastfile are the same operation: find a marker,
return the balanced-delimiter block that follows, keep `file:line`.

```
captureBlock(content, marker, open, close) → { text, line } | null
```

That plus a data table is the engine. Delimiters are table columns, not code
branches. Ruby is the one genuine special case (`do … end`), so `captureBlock`
gets a keyword mode — one extra mode, not one per platform.

### 7.2 Three fidelity classes

1. **Structured** — JSON via stdlib; `.properties` / `.sentryclirc` split on
   `=`; `AndroidManifest.xml` `io.sentry.*` meta-data by regex. For
   `pubspec.yaml` and `Cargo.toml` we do **not** add a YAML/TOML dependency: we
   need only "is the Sentry package a dependency, at what version," which is
   one regex. Marked `ponytail:` — add a real parser when nested reads are
   needed.
2. **Init call sites** — verbatim block plus `file:line`, then a scalar pass for
   the keys we check: `dsn`, `debug`, `environment`, `release`, `*SampleRate`,
   `enableLogs`, `sendDefaultPii`. Dynamic values (`process.env.X`, a variable,
   a call) are captured as source text and flagged `dynamic: true` — **never
   reported as absent**. That distinction is most of what makes this
   trustworthy.
3. **Build/upload config** — same block capture, upload-side markers.

### 7.3 Init markers

| Platform | Marker | Delimiters |
|---|---|---|
| JS/TS/RN | `Sentry.init(` | `{` … `}` object |
| Python | `sentry_sdk.init(` | `(` … `)` kwargs |
| Android | `SentryAndroid.init(` | `(` ctx `)` + trailing `{ options -> … }` |
| Apple Swift | `SentrySDK.start(` | trailing closure `{ options in … }` |
| Apple ObjC | `[SentrySDK startWithConfigureOptions:` | `^(SentryOptions *options) {` … `}` |
| Java/Spring | `Sentry.init(` | `options -> {` … `}` |
| Flutter | `SentryFlutter.init(` | `(options) {` … `}` |
| Go | `sentry.Init(` | `sentry.ClientOptions{` … `}` |
| .NET | `SentrySdk.Init(` / `UseSentry(` | `{` … `}` |
| Ruby | `Sentry.init do \|config\|` | `do` … `end` |
| PHP | `\Sentry\init(` | `[` … `]` array |
| Rust | `sentry::init(` | `ClientOptions {` … `}` |

**Auto-init platforms carry an `autoInit` column.** Android's normal path is
`AndroidManifest.xml` meta-data; Spring is `application.properties`; .NET is
`appsettings.json`'s `Sentry` section; Laravel is `config/sentry.php`. For
these, config presence in the structured source satisfies the check and a
missing init call is `skip`, **never `fail`**. Getting this wrong would
manufacture exactly the false-positive class we rejected the workflow-wrapper
approach over.

### 7.4 Build/upload markers

This is where the loudest ticket class lives — mappings and source maps that
were never uploaded.

| Ecosystem | Files | Markers |
|---|---|---|
| Gradle | `build.gradle(.kts)`, `**/build.gradle(.kts)` | `io.sentry.android.gradle` plugin id, `sentry { }` |
| Gradle | `gradle.properties`, `sentry.properties` | `sentry.*` keys, `auto.upload*` |
| Android | `AndroidManifest.xml` | `io.sentry.*` meta-data |
| Fastlane | `fastlane/Fastfile`, `Fastfile` | `sentry_upload_dsym`, `sentry_upload_sourcemap`, `sentry_create_release`, `sentry_cli` |
| JS bundlers | `next`/`vite`/`webpack`/`rollup`/`nuxt`/`astro`/`svelte`/`metro.config.*` | `withSentryConfig`, `sentry{Vite,Webpack,Rollup,Esbuild}Plugin`, `sentryUnplugin` |
| Any | `.sentryclirc`, `sentry.properties` | org, project, url, authToken |

`src/lib/build/index.ts:141` already recognizes the `sentry-gradle-plugin` and
`sentry-fastlane-plugin` names; reuse those constants. That module is otherwise
about build *artifacts* (APK/AAB/IPA binaries), not build config — no further
reuse.

### 7.5 Discovery and budget

`COMMON_CONFIG_FILES` covers manifest discovery well but nothing on the upload
side — no `AndroidManifest.xml`, Fastfile, `.sentryclirc`, `gradle.properties`,
rollup/esbuild config — and it is 69 exact paths with no glob support, so
multi-module Android (`feature/x/build.gradle.kts`) is invisible to it.

Doctor needs no globbing, because the walk already does the walking. Two
mechanisms over a **single** `collectGrep` pass:

- **Markers** (init call sites, `sentry { }`, bundler plugins, Fastlane actions)
  are found by pattern anywhere the walk reaches — no path list at all.
- **Structured files** (`AndroidManifest.xml`, `sentry.properties`,
  `gradle.properties`, `.sentryclirc`, `appsettings.json`, `pubspec.yaml`) are
  matched by **basename** during that same walk, which is what makes
  `feature/x/build.gradle.kts` visible without enumerating it.

The `**/build.gradle(.kts)` entry in §7.4 denotes "at any depth the walk
reaches," not a glob to be expanded.

Doctor's `collectGrep` preset deliberately differs from the DSN preset:

```
minDepth: 3,          // exhaustive floor
maxDepth: Infinity,   // never silently truncate by tree shape
timeBudgetMs: 1500,   // wall-clock is the real bound
```

The DSN scanner uses `maxDepth: 3` and neither `minDepth` nor `timeBudgetMs`,
which is right for its job: it sits on the hot path of many commands, wants
predictable cost, needs exactly one answer, and can stop at the first hit.
Doctor inverts both axes. It runs once, deliberately, and wants **recall** —
missing the Android init call at `app/src/main/java/com/foo/MyApp.kt` (depth
7+) does not produce "no answer," it produces the *wrong* answer.

A depth cap fails silently; a time budget fails observably. When the budget
blows, capture sets `incomplete` and the affected checks report `status:
"skip", detail: "scan hit its time budget, config capture may be incomplete"`.
For a diagnostic tool that is the difference between "we didn't find init" and
"we didn't finish looking."

Removing the depth cap reintroduces no risk: `node_modules` and build output
(skip dirs), binaries (`TEXT_EXTENSIONS`), and large files (256 KB
`maxFileSize`) are each bounded independently.

### 7.6 Data shape

```ts
type Capture = {
  cwd: string;
  ecosystems: string[];               // ["gradle", "npm"]
  dsns: DetectedDsn[];
  initSites: CapturedBlock[];
  buildConfigs: CapturedBlock[];
  manifests: Record<string, ParsedManifest>;
  incomplete?: string;
};

type CapturedBlock = {
  kind: string;                       // "sentry.init" | "gradle.sentry" | "fastlane"
  file: string;
  line: number;
  text: string;                       // verbatim, redacted
  keys: Record<string, { value?: string; dynamic: boolean }>;
};
```

### 7.7 Redaction

**Redaction happens at the capture boundary, not at render.** Redact once,
early, and every consumer inherits safety — no renderer can leak because no
renderer ever holds a secret. Checks need to know whether `authToken` is set,
not its value, so this costs nothing.

`scrubOutputLine()` is the right primitive but is tuned for log lines: its
`KEY_VALUE_RE` catches `authToken=abc` and misses `authToken: "abc"` (JS/YAML)
and `authToken = 'abc'` (Gradle/Ruby, spaced). Doctor adds a config-shaped
variant covering secret-ish key names (`authToken`, `auth_token`, `api_key`,
`token`, `password`, `secret`) across all three assignment styles.

Redact by default. **No `--no-redact` flag.** One deliberate exception: the DSN
public key is preserved — `findProjectByDsnKey()` needs it and it is not
secret.

## 8. Tier 3 — judgement

Three paths, in order:

1. **In an agent** (`detectAgent()` returns a name) → emit the fix prompt.
   Zero API calls, zero credentials, zero cost. The agent already has auth.
2. **`ANTHROPIC_API_KEY` present** → one `messages.create` with
   `output_config: {format: {...}}` structured output returning
   `CheckResult[]`. A single classification call, not an agent loop — by tier 3
   the evidence is already collected, so the Claude Agent SDK is over-specced.
   The captured config *is* the prompt payload; no files are re-read.
3. **Neither** → skip tier 3, report tiers 1 and 2 in full.

`package.json:86` declares `@anthropic-ai/sdk` at `^0.39.0` but nothing in
`src/` imports it. Path 2 requires a version bump for `output_config` support
and current model IDs.

Most Sentry users have no `ANTHROPIC_API_KEY`, and shipping a key in the CLI
is a cost and abuse surface we are not taking on. Tier 3 is therefore a bonus,
never a dependency — the command must be fully useful with it absent.

## 9. Live check

**API round-trip, no process spawn.** Two variants, in order of cost:

1. Read `project.firstEvent` and the most recent issue's `lastSeen` — free,
   already part of tier 1, and answers "no events since Tuesday" on every
   platform.
2. Optional `--live`: POST a synthetic envelope to the real DSN, then poll
   `src/lib/api/events.ts` to confirm ingestion.

This replaces the proposal's spawn-the-dev-server approach, which cannot work
for Android, iOS, or Go (it depends on `detectDevCommand`), costs a 15-second
timeout, and proves only local SDK emission. The API round-trip is
platform-agnostic and CI-safe.

## 10. Report and export

**Always write a local file.** `sentry-doctor-report.json`, containing
`schema_version`, `cli_version`, `timestamp`, the redacted capture, server
facts, and results. Snake_case machine contract, following the `info.ts`
precedent. Works offline, with telemetry disabled, and in CI.

**Upload is consent-gated and opt-in.** `Sentry.captureFeedback()` tagged with
failing check ids, following `src/commands/cli/feedback.ts`. Note that path
hard-gates on `Sentry.isEnabled()` and throws a `ConfigError` when telemetry is
off — which is precisely why the local file is unconditional rather than a
fallback.

No support-ticket or Zendesk destination exists in this repository.
`src/commands/feedback/index.ts` and `src/lib/api/feedback.ts` are read-only
(feedback is issue groups filtered by `issue.category:feedback`). Building one
is out of scope.

## 11. CLI surface

Stricli `buildCommand`, registered in `src/app.ts` alongside `init` and `info`.
`auth: false` so it runs unauthenticated and reports "unauthorized" as a
finding rather than crashing — the `info.ts` pattern.

| Flag | Effect |
|---|---|
| *(none)* | human render, grouped by status, failures first |
| `--json` | machine contract to stdout |
| `--prompt` | agent-ready fix text |
| `--offline` | skip `resolve()`; tier-1 checks `skip` |
| `--live` | synthetic envelope round-trip (§9) |
| `--fix` | escalate to the workflow (§12) |

**Three renderers, one source — and the fix prompt is the third.** Proposal §5
wants a printed fix prompt; §8 forbids auto-invoking an agent. Making
`--prompt` a renderer over `CheckResult[]` plus `Capture` honors both: nothing
is invoked, and there is no duplicated diagnosis logic to drift.

**Exit codes:** `0` when everything passes or skips, `1` when anything fails.
Warnings do not fail the build. No `--strict` — add it when someone wants
warnings to break CI.

## 12. `--fix` (stretch)

Runs the existing `sentry-wizard` workflow via the `--dry-run` path and renders
`codemodPlan` entries — which already carry `description` and `riskLevel` — as a
fix plan. Derives `--features` from detected config, not from flags (§4).

Two prerequisites, both real:

1. The `verifySetup` dry-run guard (§13) must land first.
2. `--features` is mandatory outside a TTY, so the derivation in §4 is required
   for this to work non-interactively at all.

This is a 4.5-minute command. Acceptable when the user explicitly asked for a
fix plan; unacceptable for a health check — hence the split.

## 13. Prerequisite bug fix

**`sentry init --dry-run` starts your dev server.** `verifySetup` is called
from `wizard-runner.ts:1300` via `handleFinalResult(...)` at line 1226, with
`directory` passed **unconditionally and with no `dryRun` check**.
`verify-setup.ts` then binds a localhost port and `spawn()`s the detected dev
command. The probe escaped it only because its temp project had no
`node_modules`, which surfaced as `"Skipping verification — could not start the
dev command."`

This is a broken promise in shipped code independent of doctor, and warrants
its own PR: a `dryRun` guard at the `verifySetup` call site. `--fix` is unsafe
until it lands.

Also worth a one-line fix while in `src/lib/scan/`: the `minDepth` doc comment
in `types.ts` claims "DSN callers pass `3`." They pass `3` to `maxDepth`;
`minDepth` is never set.

## 14. Error handling

**Doctor never throws because a project is broken.** Broken projects are its
subject matter. A crash is a doctor bug, not a finding.

- **Per-check isolation.** A check that throws is converted to a `CheckResult`
  with `status: "skip"`, a detail naming the failure, and a telemetry report.
  One bad check cannot kill the report. This mirrors the existing decision in
  `verify-setup.ts` to log and report rather than throw.
- **`resolve()` failure** — no auth, offline, API 5xx — degrades every tier-1
  check to `skip` with the reason, and leaves the exit code at `0` unless a
  local check failed. Doctor is still useful with no network.
- **Partial capture** sets `Capture.incomplete`; dependent checks `skip`.
- **`skip` and `pass` are never conflated.** `pass` means determined-good;
  `skip` means could-not-determine and **must** carry a reason string. This is
  the single most important rule in the design — a diagnostic that reports
  unknowns as healthy is worse than no diagnostic.
- **Unknown platform** → `skip`, never `fail`. Doctor covers what it covers and
  says so.

## 15. Testing

Tests live in `packages/cli/test/`, matching repository convention (not
colocated).

- **Golden check tests.** Because checks are pure, a fixture is a `Capture`
  JSON plus expected `CheckResult[]`. No network mocking, no filesystem
  mocking. One fixture per interesting state: never-worked, worked-until,
  conflicting DSNs, placeholder DSN, no upload config, auto-init platform.
- **`captureBlock` unit tests** — the part most likely to be subtly wrong:
  nested delimiters, strings containing delimiters, comments containing
  delimiters, Ruby `do`/`end`, unterminated block, marker inside a comment.
- **Redaction tests** — the three assignment styles crossed with secret key
  names, asserting no secret survives into rendered JSON. This is a security
  boundary; it gets explicit coverage.
- **One integration test** against a real template from
  `test/init-eval/templates/`.
- **No network in tests.** `resolve()` is one function at one boundary, so
  stubbing it is trivial by construction.

## 16. Week plan

| Day | Work |
|---|---|
| 1 | Command skeleton, `Check`/`CheckResult`, registry, tier 1, report file, human render |
| 2 | `captureBlock` engine, discovery preset, structured class, Gradle + manifest + `sentry.properties` |
| 3 | JS bundler markers, Fastfile, init markers, config-shaped redaction |
| 4 | Tier 3 judgement (both paths), `--prompt` renderer, consent-gated upload |
| 5 | `verifySetup` guard PR, `--fix`, demo |

Day 1 is the demo on its own. Day 5 is cuttable.

## 17. Non-goals

From the proposal, preserved:

- **No auto-invoking an AI agent.** The fix prompt is printed text.
- No generalized rules engine. The tables in §7 are data.
- No cost or budget tracking on live checks.

Added by this design:

- **No `project.pbxproj` parsing.** Hostile format for regex, low yield.
- **No CI config scanning.** High noise, low signal.
- **No YAML/TOML parser dependency.** Regex the handful of keys we need.
- **No `--no-redact` flag.**
- **No `--strict` flag.**
- **No support-ticket destination.** None exists; building one is its own
  project.
- **`doctor perf`** is out of scope. It plugs into the §5 seam later.

## 18. Open item

A parallel review of PostHog's CLI `doctor` (`github.com/PostHog/posthog/tree/master/cli`)
is in flight to check for ideas worth adopting or mistakes worth avoiding.
Findings will be folded in as a revision to this document; nothing above
depends on them.
