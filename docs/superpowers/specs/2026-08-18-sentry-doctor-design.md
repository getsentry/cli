# `sentry doctor` — Design

Date: 2026-08-18
Status: approved for implementation planning
Source proposal: `hackweek-proposal-sentry-doctor.md`

## 1. Summary

`sentry doctor` is a fast, read-only, repeatable health check for an existing
Sentry install. It answers one question — *is Sentry actually working here, and
if not, what's wrong* — in seconds, on any platform, and produces a
consent-based export for support triage plus agent-ready fix instructions.

Read-only by default, including its liveness verdict (§9) — the one flag that
writes, `--send-test-event`, says so in its name.

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
  remediation?: string;
};
```

`remediation` is **one** string, written to be executable: "in
`app/build.gradle.kts`, inside `sentry { }`, set
`autoUploadProguardMapping = true`, then re-run `./gradlew assembleRelease`."
There is exactly one output (§11), so a second, terser variant for human eyes
would be the same instruction twice — the diagnosis and the location already
live in `detail` and `evidence`. See §18 for why PostHog splits this and we do
not.

**Checks are pure over `(Capture, ServerFacts)`.** This is the load-bearing
decision. It buys: checks testable against fixtures with no network or
filesystem mocking; offline degradation for free (skip `resolve`, tier-1 checks
return `skip` with a reason — §14); a reproducible JSON contract. It is also why
capture is a value rather than something each check performs for itself.

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

### 7.8 Captured content is untrusted

Everything in `Capture` is attacker-influenceable. Config files come from the
project under inspection, which may include vendored or dependency-supplied
config; server facts include values like SDK name and version that originate
from event payloads and are therefore writable by anyone holding the public
DSN key.

Two boundaries follow, and both are load-bearing because tier 3 pipes captured
text into an LLM prompt:

- **Captured text is data, never instructions.** Tier 3's prompt must frame the
  capture as untrusted content to report on, not as directions to follow — even
  when a captured comment or string looks like a command. Only our own check
  definitions and `remediation` fields are trusted guidance.
- **Validate before interpolating.** Any captured value spliced into a prompt,
  a rendered line, or a report field is allowlisted first. Version-like values
  match `^[A-Za-z0-9._+\-]+$`; identifiers and file paths are length-capped and
  control-character-stripped. A value that fails validation is reported as
  malformed rather than passed through.

Prior art: PostHog's health-issue serializer states the same rule outright, and
its `sdk_outdated` check allowlists `$lib_version` before interpolation for
exactly this reason (§18).

## 8. Tier 3 — judgement

Three paths, in order:

1. **In an agent** (`detectAgent()` returns a name) → hand the judgement to the
   agent already reading stdout: state what was captured and what is unresolved
   in the `Fix` block, rather than classifying it ourselves. Zero API calls,
   zero credentials, zero cost. The agent already has auth.
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

**Liveness is default, because the reads that establish it create nothing.**
What blocked defaulting liveness was never the flag, it was the write. Splitting
the failures by what actually detects them shows only one needs a write:

| Failure | Detected by | Writes? |
|---|---|---|
| Never worked | `firstEvent: null` | no |
| Worked, then stopped | most recent issue's `lastSeen` | no |
| **Key revoked or rotated** | `getProjectKeys()`, match `dsn.public`, read `isActive` | no |
| **Project deleted, DSN points nowhere** | `findProjectByDsnKey()` returns nothing | no |
| Egress blocked, proxy, SDK never inits at runtime | synthetic envelope | **yes** |

The first four are the common failures and all four are tier-1 reads on a
project we have already resolved — the key-status check costs one additional
call. `ProjectKey` carries `isActive` and `dsn.public`, confirmed at
`src/lib/api/projects.ts:632`. So a bare `sentry doctor` can say "this DSN's key
was deactivated" or "key active, last event 4 minutes ago" without touching the
project.

**`--send-test-event` is the escalation for the last row only.** It POSTs a
synthetic envelope to the real DSN and polls `src/lib/api/events.ts` to confirm
ingestion. It stays opt-in because it is a write: it consumes quota and leaves a
real issue in the user's stream, which on every CI build would break §1's
read-only, repeatable promise. The name says so — `--live` read as a liveness
*read*, which is exactly what it is not.

This whole section replaces the proposal's spawn-the-dev-server approach, which
cannot work for Android, iOS, or Go (it depends on `detectDevCommand`), costs a
15-second timeout, and proves only local SDK emission. API reads are
platform-agnostic and CI-safe.

## 10. Report and export

**Doctor writes no files, ever.** `--json` puts the contract on stdout;
`sentry doctor --json > report.json` writes it. The shell already does
file-writing, so a `--report` flag would buy only a default filename, and a
health check that drops `sentry-doctor-report.json` into someone's repository as
a side effect fails the safe-to-run-repeatedly test. Upload holds the contract in
memory, so it needs no file either. Net result: no path-handling, no overwrite
prompt, no cleanup.

Contents: `schema_version`, `cli_version`, `timestamp`, the redacted capture,
server facts, and results — **every** result, including passes, since a display
decision must not change what a machine consumer receives. Snake_case, following
the `info.ts` precedent. Works offline, with telemetry disabled, and in CI.

**Upload is consent-gated and opt-in.** `Sentry.captureFeedback()` tagged with
failing check ids, following `src/commands/cli/feedback.ts`. Note that path
hard-gates on `Sentry.isEnabled()` and throws a `ConfigError` when telemetry is
off — which is precisely why stdout is the primary path and upload is the extra,
not the reverse.

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
| *(none)* | findings, failures first, with a `Fix` block when anything failed |
| `--json` | machine contract to stdout (§10) |
| `--send-test-event` | synthetic envelope round-trip — a write (§9) |
| `--fix` | escalate to the workflow (§12) |

**Three flags, because four flags were three too many.** The earlier draft had
seven. `--offline` went because §14 already degrades tier 1 to `skip` on any
`resolve()` failure, so the flag only ever saved a timeout. `--report` went to
shell redirection (§10). `--verbose` went because the reasons to see all sixteen
passes are debugging doctor and scripting, and `--json` serves both. `--prompt`
went because the fix text is now simply printed — see below.

**Two renderers, one source.** Human text and the `--json` contract are both
functions of `CheckResult[]` plus `Capture`; there is no third mode and so no
duplicated diagnosis logic to drift. Proposal §5 wants a printed fix prompt and
§8 forbids auto-invoking an agent: printing the `Fix` block unconditionally
honors both, and removes the need to know in advance whether a human or an agent
will read it.

**Inside an agent** (`detectAgent()` — the same call tier 3 makes in §8), the
render drops color, glyphs, and the trailing `Next:` hints, keeping the findings
and the `Fix` block. This is not a mode switch; it is the existing decision at
`src/lib/init/wizard-runner.ts:608`, which suppresses the init banner because it
"wastes tokens and adds noise to structured output without value to the agent."

**Exit codes:** `0` when everything passes or skips, `1` when anything fails.
Warnings do not fail the build. No `--strict` — add it when someone wants
warnings to break CI.

### 11.1 Default output

Glyphs follow `src/lib/formatters/human.ts` — `✓` green, `✗` red, `⚠` yellow —
with `-` for skips, which has no existing precedent in the repo.

A broken Android install:

```
Sentry Doctor

✗ Sentry is configured but has never received an event.

### Failures

  ✗ project.first_event   No event has ever reached javascript-android/my-app.
                          app/build.gradle.kts:14
  ✗ artifacts.uploaded    No ProGuard mappings for this project. Stack traces
                          will stay obfuscated.
                          app/build.gradle.kts:52

### Warnings

  ⚠ sdk.version           sentry-android 7.14.0 is 4 minor versions behind
                          (latest 8.2.0).
  ⚠ config.debug          debug = true is enabled unconditionally.

### Skipped

  - live.roundtrip        Not requested. Run with --send-test-event.
  - release.attribution   Requires an authenticated session.

### Fix

  1. In app/build.gradle.kts, inside the sentry { } block at line 52, set
     autoUploadProguardMapping = true. Re-run ./gradlew assembleRelease and
     confirm a mapping file appears under Settings → Debug Files.
  2. Upgrade io.sentry:sentry-android to 8.2.0 in app/build.gradle.kts:14.
  3. Gate debug behind a build type rather than enabling it unconditionally.

12 passed · 2 failed · 2 warnings · 2 skipped   (1.4s)
```

A healthy install:

```
Sentry Doctor

✓ Sentry looks healthy — key active, last event 4 minutes ago.

16 passed · 3 skipped   (1.2s)
```

Five decisions those renders encode:

- **The verdict line states a conclusion, not a count.** "2 failed" does not
  tell you whether Sentry works; "configured but has never received an event"
  does. The counts stay, in the footer, where they answer a different question.
- **Passing checks collapse to a number.** Sixteen green lines are noise on
  every healthy run, and the healthy run is the common one. `--json` carries all
  of them for anyone who needs more than the number.
- **Skips are shown with reasons, sorted last.** §14 forbids conflating `skip`
  with `pass`, and a silent skip is exactly that conflation. Showing them last
  keeps them visible without competing with failures.
- **The `Fix` block prints unconditionally when something failed,** rather than
  hiding behind a flag. It is the whole deliverable of a diagnostic, it costs
  nothing on a healthy run because there is nothing to print, and it is equally
  usable by a human reading the terminal and an agent reading stdout.
- **Evidence renders as `file:line`,** which most terminals make clickable — the
  shortest path from a finding to the code that caused it.

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
- **Allowlist tests** (§7.8) — a captured version string containing shell
  metacharacters, a control character, or prompt-shaped text is reported as
  malformed rather than interpolated. Also a security boundary.
- **One integration test** against a real template from
  `test/init-eval/templates/`.
- **No network in tests.** `resolve()` is one function at one boundary, so
  stubbing it is trivial by construction.

## 16. Week plan

| Day | Work |
|---|---|
| 1 | Command skeleton, `Check`/`CheckResult`, registry, tier 1 incl. key status, `--json`, human render |
| 2 | `captureBlock` engine, discovery preset, structured class, Gradle + manifest + `sentry.properties` |
| 3 | JS bundler markers, Fastfile, init markers, config-shaped redaction |
| 4 | Tier 3 judgement (both paths), `Fix` block render, consent-gated upload |
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

## 18. Prior art: PostHog

**First, a correction to the premise.** PostHog's Rust CLI at
`PostHog/posthog/tree/master/cli` has no `doctor` command — `grep -ri doctor`
across that directory returns nothing. `doctor` lives in a different repo,
`PostHog/wizard` (TypeScript, invoked as `npx @posthog/wizard doctor`).

The architecture is close enough to ours to be worth comparing: a local
detection pass over project files, plus API-side queries against recent events,
producing a list of typed "health issues." Three things came out of the review.

**Considered and rejected — the split remediation.** PostHog's health issues
carry separate human-facing and machine-facing remediation text rather than one
string. That is right for them: they render into a web UI *and* serve a machine
API, two consumers with genuinely different appetites. An earlier draft of this
design copied it, then lost the justification when the output collapsed to one
render (§11). With a single `Fix` block read by both humans and agents, a second
terser variant would be the same instruction written twice, and `detail` plus
`evidence` already carry the diagnosis and the location. §5 keeps one
`remediation` string, written to be executable.

**Adopted — the untrusted-input boundary.** PostHog's serializer states outright
that captured project content is data rather than instructions, and its
`sdk_outdated` check allowlists `$lib_version` against a character class before
interpolating it. Since that value arrives from event payloads, anyone with the
public key can write it. §7.8 generalizes both rules to our whole capture.

**Rejected — absence implies healthy.** PostHog treats several checks as passing
when it finds no evidence of a problem, which conflates "verified fine" with
"could not tell." §14 forbids that: a check that cannot reach its evidence
returns `skip` with a reason. The whole value of `sentry doctor` is telling
someone their install is silently broken, and a check that reports green when it
learned nothing is the exact failure mode we are building the command to catch.
