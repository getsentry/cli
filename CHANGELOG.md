# Changelog

<!-- Craft will auto-populate this file -->
## 0.22.0

### New Features ✨

- (dashboard) Add layout/position flags to widget edit and add commands by @BYK in [#591](https://github.com/getsentry/cli/pull/591)
- (init) Surface server-provided detail in spinner messages by @MathurAditya724 in [#588](https://github.com/getsentry/cli/pull/588)
- AsyncIterable streaming support for library SDK by @BYK in [#586](https://github.com/getsentry/cli/pull/586)

### Bug Fixes 🐛

#### Dashboard

- Normalize numeric org IDs from DSN auto-detection by @BYK in [#593](https://github.com/getsentry/cli/pull/593)
- Show actionable error messages instead of raw API errors by @BYK in [#592](https://github.com/getsentry/cli/pull/592)

#### Other

- (auth) Skip stale cached user info for env var tokens in `auth status` by @BYK in [#589](https://github.com/getsentry/cli/pull/589)
- (upgrade) Move delta patch log.info outside spinner callback by @BYK in [#590](https://github.com/getsentry/cli/pull/590)

### Internal Changes 🔧

- Remove upstream issue templates for Sentry SDK light exports by @MathurAditya724 in [#596](https://github.com/getsentry/cli/pull/596)
- Regenerate skill files and command docs by @github-actions[bot] in [0276f760](https://github.com/getsentry/cli/commit/0276f760f0d5b9596b8208a1066156eb935c04cb)

## 0.21.0

### New Features ✨

#### Dashboard

- Add pagination and glob filtering to dashboard list by @BYK in [#560](https://github.com/getsentry/cli/pull/560)
- Add a full chart rendering engine for `sentry dashboard view` that transforms widget data into rich terminal visualizations. by @BYK in [#555](https://github.com/getsentry/cli/pull/555)

#### Init

- Propagate sentry-trace headers to wizard API calls by @betegon in [#567](https://github.com/getsentry/cli/pull/567)
- Treat bare slug as new project name when not found by @BYK in [#554](https://github.com/getsentry/cli/pull/554)

#### Other

- (formatters) Colorize SQL in DB span descriptions by @BYK in [#546](https://github.com/getsentry/cli/pull/546)
- (output) Add Zod schema registration to OutputConfig for self-documenting JSON fields by @BYK in [#582](https://github.com/getsentry/cli/pull/582)
- (telemetry) Report unknown commands to Sentry by @BYK in [#563](https://github.com/getsentry/cli/pull/563)
- Expose CLI as a programmatic library by @BYK in [#565](https://github.com/getsentry/cli/pull/565)
- Bidirectional cursor pagination (-c next / -c prev) by @BYK in [#564](https://github.com/getsentry/cli/pull/564)
- Add `sentry sourcemap inject` and `sentry sourcemap upload` commands by @BYK in [#547](https://github.com/getsentry/cli/pull/547)
- Native debug ID injection and sourcemap upload by @BYK in [#543](https://github.com/getsentry/cli/pull/543)

### Bug Fixes 🐛

#### Dashboard

- Fix table widget rendering and timeseries bar chart width by @BYK in [#584](https://github.com/getsentry/cli/pull/584)
- Validate display types against all datasets by @betegon in [#577](https://github.com/getsentry/cli/pull/577)
- Auto-clamp widget limit instead of erroring by @BYK in [#573](https://github.com/getsentry/cli/pull/573)
- Default issue dataset table columns to ["issue"] by @betegon in [#570](https://github.com/getsentry/cli/pull/570)
- Scale timeseries bar width to fill chart area by @BYK in [#562](https://github.com/getsentry/cli/pull/562)
- Resolve dashboard by ID/slug in addition to title by @BYK in [#559](https://github.com/getsentry/cli/pull/559)

#### Event

- Detect SHORT-ID/EVENT-ID format in event view by @BYK in [#574](https://github.com/getsentry/cli/pull/574)
- Auto-fallback to org-wide search when event 404s in project by @BYK in [#575](https://github.com/getsentry/cli/pull/575)

#### Other

- (api) Show meaningful message for network errors instead of '0 Unknown' by @BYK in [#572](https://github.com/getsentry/cli/pull/572)
- (event-view) Auto-redirect issue short IDs in two-arg form (CLI-MP) by @BYK in [#558](https://github.com/getsentry/cli/pull/558)
- (help) Show help when user passes `help` as positional arg by @BYK in [#561](https://github.com/getsentry/cli/pull/561)
- (issue) Auto-redirect bare org slug to org-all mode in issue list by @BYK in [#576](https://github.com/getsentry/cli/pull/576)
- (log) Use 30d default period and show newest logs first by @sergical in [#568](https://github.com/getsentry/cli/pull/568)
- Reject @-selectors in parseOrgProjectArg with helpful redirect by @BYK in [#557](https://github.com/getsentry/cli/pull/557)

### Documentation 📚

- Add missing command pages for trace, span, sourcemap, repo, trial, schema by @sergical in [#569](https://github.com/getsentry/cli/pull/569)

### Internal Changes 🔧

#### Coverage

- Use informational-patch input instead of sed hack by @BYK in [#544](https://github.com/getsentry/cli/pull/544)
- Make checks informational on release branches by @BYK in [#541](https://github.com/getsentry/cli/pull/541)

#### Event

- Replace "latest" magic string with @latest sentinel constant by @BYK in [#583](https://github.com/getsentry/cli/pull/583)
- Deduplicate span tree building into shared helper by @BYK in [#581](https://github.com/getsentry/cli/pull/581)

#### Other

- (api) Collapse stats on issue detail endpoints to save 100-300ms by @BYK in [#551](https://github.com/getsentry/cli/pull/551)
- (ci) Upgrade GitHub Actions to Node 24 runtime by @BYK in [#542](https://github.com/getsentry/cli/pull/542)
- (db) DRY up database layer with shared helpers and lint enforcement by @BYK in [#550](https://github.com/getsentry/cli/pull/550)
- (docs) Polish sidebar, header, focus, and code block UX by @sergical in [#580](https://github.com/getsentry/cli/pull/580)
- (issue-list) Use collapse parameter to skip unused Snuba queries by @BYK in [#545](https://github.com/getsentry/cli/pull/545)
- Bump Bun from 1.3.9 to 1.3.11 by @BYK in [#552](https://github.com/getsentry/cli/pull/552)
- Regenerate skill files by @github-actions[bot] in [ec1ffe28](https://github.com/getsentry/cli/commit/ec1ffe2810eb5054ac7aa81ba9dac7bfccedb1fd)

## 0.20.0

### New Features ✨

- (install) Support SENTRY_VERSION env var for version pinning by @BYK in [#537](https://github.com/getsentry/cli/pull/537)

### Bug Fixes 🐛

#### Event

- Detect org/ISSUE-SHORT-ID in event view single-arg path (CLI-9K) by @BYK in [#529](https://github.com/getsentry/cli/pull/529)
- Auto-redirect issue short IDs in event view (CLI-JR) by @BYK in [#524](https://github.com/getsentry/cli/pull/524)

#### Other

- (api) Strip api/0/ prefix and exclude NodeSystemError integration (CLI-K1) by @BYK in [#523](https://github.com/getsentry/cli/pull/523)
- (dashboard) Add missing datasets to agent guidance by @betegon in [#522](https://github.com/getsentry/cli/pull/522)
- (docs) Overscroll popup — curl command + click-to-copy by @betegon in [#531](https://github.com/getsentry/cli/pull/531)
- (init) Resolve numeric org ID from DSN and prompt when Sentry already configured by @betegon in [#532](https://github.com/getsentry/cli/pull/532)
- (polling) Move spinner from stderr to stdout to prevent consola collision by @BYK in [#533](https://github.com/getsentry/cli/pull/533)
- (telemetry) Set sentry.org tag in issue explain and plan commands by @BYK in [#534](https://github.com/getsentry/cli/pull/534)
- Handle invalid URLs gracefully in response cache (CLI-GC) by @BYK in [#528](https://github.com/getsentry/cli/pull/528)
- Avoid double-prefixing in buildCommandHint for slashed args (CLI-8C) by @BYK in [#527](https://github.com/getsentry/cli/pull/527)
- Handle full short IDs and numeric IDs in multi-slash issue args (CLI-KC, CLI-B6) by @BYK in [#526](https://github.com/getsentry/cli/pull/526)
- Auto-recovery for wrong entity types across commands (CLI-G6, CLI-K6, CLI-JR) by @BYK in [#525](https://github.com/getsentry/cli/pull/525)

### Documentation 📚

- (init) Add documentation and experimental notice for sentry init by @betegon in [#530](https://github.com/getsentry/cli/pull/530)

### Internal Changes 🔧

- (telemetry) Centralize sentry.org/project tags in resolution functions by @BYK in [#538](https://github.com/getsentry/cli/pull/538)
- Regenerate skill files by @github-actions[bot] in [22b5281d](https://github.com/getsentry/cli/commit/22b5281de8f7833b2a2a5d0f3b771aff0daab2ec)

## 0.19.0

### New Features ✨

#### Dashboard

- Add layout guidance and widget type reference for agents by @betegon in [#521](https://github.com/getsentry/cli/pull/521)
- Add widget add, edit, and delete commands by @betegon in [#407](https://github.com/getsentry/cli/pull/407)

#### Telemetry

- Include user email in Sentry telemetry context by @BYK in [#513](https://github.com/getsentry/cli/pull/513)
- Track TTY vs non-TTY invocations via metric by @betegon in [#482](https://github.com/getsentry/cli/pull/482)

#### Other

- (help) Fuzzy "Did you mean?" suggestions for command typos by @BYK in [#516](https://github.com/getsentry/cli/pull/516)
- (upgrade) Add progress spinners for version check and download phases by @BYK in [#515](https://github.com/getsentry/cli/pull/515)
- External sourcemap upload for compiled binaries by @BYK in [#518](https://github.com/getsentry/cli/pull/518)
- Dynamic cache-backed shell completions with fuzzy matching by @BYK in [#465](https://github.com/getsentry/cli/pull/465)

### Bug Fixes 🐛

- (completions) Populate project cache from listProjects by @betegon in [#517](https://github.com/getsentry/cli/pull/517)
- (help) Hide ASCII banner when stdout is not a TTY by @betegon in [#501](https://github.com/getsentry/cli/pull/501)
- (json) Flatten view command JSON output for --fields filtering by @BYK in [#495](https://github.com/getsentry/cli/pull/495)
- (polling) Throw TimeoutError instead of bare Error on timeout by @BYK in [#503](https://github.com/getsentry/cli/pull/503)
- (project) Fallback to org listing when bare slug matches an organization by @betegon in [#475](https://github.com/getsentry/cli/pull/475)
- (setup) Auto-configure zsh fpath for shell completions by @betegon in [#509](https://github.com/getsentry/cli/pull/509)
- (skill) Include widget subcommands in generated skill files by @betegon in [#519](https://github.com/getsentry/cli/pull/519)
- Isolate multiregion 403 tests from env-var auth tokens by @BYK in [#514](https://github.com/getsentry/cli/pull/514)
- Only mention token scopes in 403 errors for env-var tokens by @BYK in [#512](https://github.com/getsentry/cli/pull/512)
- Suggest similar projects on project-search miss (CLI-A4) by @BYK in [#511](https://github.com/getsentry/cli/pull/511)
- Preserve ApiError type in Seer handler + suggest trial start command (CLI-N, CLI-1D/BW/98) by @BYK in [#510](https://github.com/getsentry/cli/pull/510)
- Add 403 scope guidance to issue list error handling (CLI-97) by @BYK in [#508](https://github.com/getsentry/cli/pull/508)
- Propagate 403 from multi-region fan-out instead of returning empty list (CLI-89) by @BYK in [#507](https://github.com/getsentry/cli/pull/507)
- Lowercase project slug in URL-parsed issue short IDs (CLI-C8 follow-up) by @BYK in [#506](https://github.com/getsentry/cli/pull/506)
- Handle EIO stream errors gracefully in bin.ts by @BYK in [#505](https://github.com/getsentry/cli/pull/505)
- Use fuzzyMatch for similar project suggestions and add tests (CLI-C0) by @BYK in [#504](https://github.com/getsentry/cli/pull/504)
- Use resolved org in numeric issue ID 404 hint (CLI-BT) by @BYK in [#502](https://github.com/getsentry/cli/pull/502)
- Include API endpoint in error messages for better diagnostics (CLI-BS) by @BYK in [#500](https://github.com/getsentry/cli/pull/500)
- Enrich 403 on org listing with token scope guidance (CLI-89) by @BYK in [#498](https://github.com/getsentry/cli/pull/498)
- Add 400 suggestions to org-all issue list path (CLI-BY) by @BYK in [#497](https://github.com/getsentry/cli/pull/497)
- Lowercase project slug in issue arg parsing (CLI-C8) by @BYK in [#496](https://github.com/getsentry/cli/pull/496)
- Enrich short ID 404 with org context and suggestions (CLI-A1) by @BYK in [#494](https://github.com/getsentry/cli/pull/494)
- Suggest similar projects when project not found in org (CLI-C0) by @BYK in [#493](https://github.com/getsentry/cli/pull/493)
- Event 404 hint should suggest different project, not repeat failing command by @BYK in [#492](https://github.com/getsentry/cli/pull/492)
- Enrich event 404 errors with retention and format suggestions (CLI-6F) by @BYK in [#491](https://github.com/getsentry/cli/pull/491)
- Add actionable suggestions for 400 Bad Request on issue list (CLI-BM, CLI-7B) by @BYK in [#489](https://github.com/getsentry/cli/pull/489)
- Detect issue short IDs passed to issue list (CLI-C3) by @BYK in [#488](https://github.com/getsentry/cli/pull/488)
- Add Glob.match() polyfill + improve auto-detect diagnostics (CLI-7T) by @BYK in [#487](https://github.com/getsentry/cli/pull/487)
- Add org-slug pre-check to dispatchOrgScopedList (CLI-9A) by @BYK in [#485](https://github.com/getsentry/cli/pull/485)

### Documentation 📚

- (dashboard) Add documentation for dashboard and widget commands by @betegon in [#520](https://github.com/getsentry/cli/pull/520)

### Internal Changes 🔧

- (init) Run org detection in background during preamble by @MathurAditya724 in [#443](https://github.com/getsentry/cli/pull/443)
- (issue) Skip getProject round-trip in project-search resolution by @betegon in [#473](https://github.com/getsentry/cli/pull/473)
- (resolve) Carry project data through resolution to eliminate redundant getProject calls by @BYK in [#486](https://github.com/getsentry/cli/pull/486)
- (telemetry) Convert is_tty metric to span tag by @betegon in [#499](https://github.com/getsentry/cli/pull/499)
- HTTP latency optimizations — diagnostics, cache warming, concurrency limits by @BYK in [#490](https://github.com/getsentry/cli/pull/490)
- Switch from @sentry/bun to @sentry/node-core/light (~170ms startup savings) by @BYK in [#474](https://github.com/getsentry/cli/pull/474)
- Regenerate skill files by @github-actions[bot] in [b7b240ec](https://github.com/getsentry/cli/commit/b7b240ece3c2b1617b00f4be2cac3fcba6248143)

## 0.18.1

### Bug Fixes 🐛

- (init) Sync wizard feature metadata with supported flags by @MathurAditya724 in [#471](https://github.com/getsentry/cli/pull/471)
- Accept nullable user fields in OAuth token response by @BYK in [#470](https://github.com/getsentry/cli/pull/470)

### Internal Changes 🔧

- Regenerate skill files by @github-actions[bot] in [77603fc3](https://github.com/getsentry/cli/commit/77603fc3fc4464a5507d3db55720bc760c524c48)

## 0.18.0

### New Features ✨

- (span) Make span list dual-mode and add --period flag by @BYK in [#461](https://github.com/getsentry/cli/pull/461)
- Refactor SKILL.md into modular reference files by @BYK in [#458](https://github.com/getsentry/cli/pull/458)

### Bug Fixes 🐛

- (constants) Normalize bare hostnames in SENTRY_HOST/SENTRY_URL by @BYK in [#467](https://github.com/getsentry/cli/pull/467)
- (dsn) Treat EISDIR and ENOTDIR as ignorable file errors by @BYK in [#464](https://github.com/getsentry/cli/pull/464)
- (test) Use os.tmpdir() for test temp directories by @BYK in [#457](https://github.com/getsentry/cli/pull/457)
- Make piped output human-readable instead of raw CommonMark by @BYK in [#462](https://github.com/getsentry/cli/pull/462)
- Clean up upgrade output and hide empty table headers by @BYK in [#459](https://github.com/getsentry/cli/pull/459)
- Improve error messages — fix ContextError/ResolutionError misuse by @BYK in [#456](https://github.com/getsentry/cli/pull/456)

### Documentation 📚

- Add key principles and API schema workflow to agent guidance by @BYK in [#466](https://github.com/getsentry/cli/pull/466)

### Internal Changes 🔧

- (list) Align all list commands to issue list standards by @BYK in [#453](https://github.com/getsentry/cli/pull/453)

## 0.17.0

### New Features ✨

- (dashboard) Add dashboard list, view, and create commands by @betegon in [#406](https://github.com/getsentry/cli/pull/406)
- (upgrade) Add --offline flag and automatic offline fallback by @BYK in [#450](https://github.com/getsentry/cli/pull/450)
- Add distributed tracing for Sentry backend by @BYK in [#455](https://github.com/getsentry/cli/pull/455)
- Add project delete command by @MathurAditya724 in [#397](https://github.com/getsentry/cli/pull/397)
- Add `sentry schema` command for API introspection by @BYK in [#437](https://github.com/getsentry/cli/pull/437)

### Bug Fixes 🐛

- (dsn) Prevent hang during DSN auto-detection in repos with test fixtures by @BYK in [#445](https://github.com/getsentry/cli/pull/445)
- (formatters) Pad priority labels for consistent TRIAGE column alignment by @MathurAditya724 in [#449](https://github.com/getsentry/cli/pull/449)
- (upgrade) Remove hard chain depth cap for nightly delta upgrades by @BYK in [#444](https://github.com/getsentry/cli/pull/444)
- Improve CLI output for auth login and upgrade flows by @BYK in [#454](https://github.com/getsentry/cli/pull/454)

### Internal Changes 🔧

- Cache org listing in listOrganizations + DSN shortcut for issue view by @betegon in [#446](https://github.com/getsentry/cli/pull/446)

## 0.16.0

### New Features ✨

#### Init

- Support org/project positional to pin org and project name by @MathurAditya724 in [#428](https://github.com/getsentry/cli/pull/428)
- Show feedback hint after successful setup by @betegon in [#430](https://github.com/getsentry/cli/pull/430)
- Add --team flag to relay team selection to project creation by @MathurAditya724 in [#403](https://github.com/getsentry/cli/pull/403)
- Enforce canonical feature display order by @betegon in [#388](https://github.com/getsentry/cli/pull/388)
- Accept multiple delimiter formats for --features flag by @betegon in [#386](https://github.com/getsentry/cli/pull/386)
- Add git safety checks before wizard modifies files by @betegon in [#379](https://github.com/getsentry/cli/pull/379)
- Add experimental warning before wizard runs by @betegon in [#378](https://github.com/getsentry/cli/pull/378)
- Add init command for guided Sentry project setup by @betegon in [#283](https://github.com/getsentry/cli/pull/283)

#### Issue List

- Auto-compact when table exceeds terminal height by @BYK in [#395](https://github.com/getsentry/cli/pull/395)
- Redesign table to match Sentry web UI by @BYK in [#372](https://github.com/getsentry/cli/pull/372)

#### Other

- (auth) Allow re-authentication without manual logout by @BYK in [#417](https://github.com/getsentry/cli/pull/417)
- (trial) Auto-prompt for Seer trial + sentry trial list/start commands by @BYK in [#399](https://github.com/getsentry/cli/pull/399)
- Add --json flag to help command for agent introspection by @BYK in [#432](https://github.com/getsentry/cli/pull/432)
- Add `sentry span list` and `sentry span view` commands by @betegon in [#393](https://github.com/getsentry/cli/pull/393)
- Support SENTRY_HOST as alias for SENTRY_URL by @betegon in [#409](https://github.com/getsentry/cli/pull/409)
- Add --dry-run flag to mutating commands by @BYK in [#387](https://github.com/getsentry/cli/pull/387)
- Return-based output with OutputConfig on buildCommand by @BYK in [#380](https://github.com/getsentry/cli/pull/380)
- Add --fields flag for context-window-friendly JSON output by @BYK in [#373](https://github.com/getsentry/cli/pull/373)
- Magic `@` selectors (`@latest`, `@most_frequent`) for issue commands by @BYK in [#371](https://github.com/getsentry/cli/pull/371)
- Input hardening against agent hallucinations by @BYK in [#370](https://github.com/getsentry/cli/pull/370)
- Add response caching for read-only API calls by @BYK in [#330](https://github.com/getsentry/cli/pull/330)

### Bug Fixes 🐛

#### Dsn

- Make code scanner monorepo-aware and extend --fresh to bypass DSN cache by @betegon in [#420](https://github.com/getsentry/cli/pull/420)
- Prevent silent exit during uncached DSN auto-detection (#411) by @BYK in [#414](https://github.com/getsentry/cli/pull/414)

#### Init

- Align multiselect hint lines with clack's visual frame by @MathurAditya724 in [#435](https://github.com/getsentry/cli/pull/435)
- Make URLs clickable with OSC 8 terminal hyperlinks by @MathurAditya724 in [#423](https://github.com/getsentry/cli/pull/423)
- Remove implementation detail from help text by @betegon in [#385](https://github.com/getsentry/cli/pull/385)
- Truncate uncommitted file list to first 5 entries by @MathurAditya724 in [#381](https://github.com/getsentry/cli/pull/381)

#### Other

- (api) Convert --data to query params for GET requests by @BYK in [#383](https://github.com/getsentry/cli/pull/383)
- (docs) Remove double borders and fix column alignment on landing page tables by @betegon in [#369](https://github.com/getsentry/cli/pull/369)
- (help) Hide plural aliases from help output by @betegon in [#441](https://github.com/getsentry/cli/pull/441)
- (trace) Show span IDs in trace view and fix event_id mapping by @betegon in [#400](https://github.com/getsentry/cli/pull/400)
- Show human-friendly names in trial list and surface plan trials by @BYK in [#412](https://github.com/getsentry/cli/pull/412)
- Add trace ID validation to trace view + UUID dash-stripping by @BYK in [#375](https://github.com/getsentry/cli/pull/375)

### Documentation 📚

- (commands) Add alias info to subcommand help output by @betegon in [#442](https://github.com/getsentry/cli/pull/442)
- Update AGENTS.md with patterns from span commands work by @BYK in [#433](https://github.com/getsentry/cli/pull/433)
- Update credential storage docs and remove stale config.json references by @betegon in [#408](https://github.com/getsentry/cli/pull/408)

### Internal Changes 🔧

#### Init

- Remove --force flag by @betegon in [#377](https://github.com/getsentry/cli/pull/377)
- Remove dead determine-pm step label by @betegon in [#374](https://github.com/getsentry/cli/pull/374)

#### Tests

- Consolidate unit tests subsumed by property tests by @BYK in [#422](https://github.com/getsentry/cli/pull/422)
- Remove redundant and low-value tests by @BYK in [#418](https://github.com/getsentry/cli/pull/418)

#### Other

- (lint) Enforce command output conventions via Biome plugins by @BYK in [#439](https://github.com/getsentry/cli/pull/439)
- (log/list) Convert non-follow paths to return CommandOutput by @BYK in [#410](https://github.com/getsentry/cli/pull/410)
- Unified trace-target parsing and resolution by @BYK in [#438](https://github.com/getsentry/cli/pull/438)
- Centralize slug normalization warning in parseOrgProjectArg by @BYK in [#436](https://github.com/getsentry/cli/pull/436)
- Unify commands as generators with HumanRenderer factory, remove stdout plumbing by @BYK in [#416](https://github.com/getsentry/cli/pull/416)
- Convert list command handlers to return data instead of writing stdout by @BYK in [#404](https://github.com/getsentry/cli/pull/404)
- Split api-client.ts into focused domain modules by @BYK in [#405](https://github.com/getsentry/cli/pull/405)
- Migrate non-streaming commands to CommandOutput with markdown rendering by @BYK in [#398](https://github.com/getsentry/cli/pull/398)
- Convert Tier 2-3 commands to return-based output and consola by @BYK in [#394](https://github.com/getsentry/cli/pull/394)
- Convert remaining Tier 1 commands to return-based output by @BYK in [#382](https://github.com/getsentry/cli/pull/382)
- Converge Tier 1 commands to writeOutput helper by @BYK in [#376](https://github.com/getsentry/cli/pull/376)

### Other

- Minify JSON on read and pretty-print on write in init local ops by @MathurAditya724 in [#396](https://github.com/getsentry/cli/pull/396)

## 0.15.0

### New Features ✨

- (project) Display platform suggestions in multi-column tables by @betegon in [#365](https://github.com/getsentry/cli/pull/365)

### Bug Fixes 🐛

- (log-view) Support multiple log IDs and validate hex format by @BYK in [#362](https://github.com/getsentry/cli/pull/362)
- (logs) Harden log schemas against API response format variations by @BYK in [#361](https://github.com/getsentry/cli/pull/361)
- Improve argument parsing for common user mistakes by @BYK in [#363](https://github.com/getsentry/cli/pull/363)

### Internal Changes 🔧

- (delta-upgrade) Lazy chain walk, GHCR retry, parallel I/O, offline cache by @BYK in [#360](https://github.com/getsentry/cli/pull/360)
- Use --timeout CLI flag for model-based test timeouts by @BYK in [#367](https://github.com/getsentry/cli/pull/367)

## 0.14.0

### New Features ✨

#### Trace

- Add cursor pagination to `trace list` by @BYK in [#324](https://github.com/getsentry/cli/pull/324)
- Add `sentry trace logs` subcommand (#247) by @BYK in [#311](https://github.com/getsentry/cli/pull/311)

#### Other

- (api) Add --data/-d flag and auto-detect JSON body in fields by @BYK in [#320](https://github.com/getsentry/cli/pull/320)
- (formatters) Render all terminal output as markdown by @BYK in [#297](https://github.com/getsentry/cli/pull/297)
- (install) Add Sentry error telemetry to install script by @BYK in [#334](https://github.com/getsentry/cli/pull/334)
- (issue-list) Global limit with fair distribution, compound cursor, and richer progress by @BYK in [#306](https://github.com/getsentry/cli/pull/306)
- (log-list) Add --trace flag to filter logs by trace ID by @BYK in [#329](https://github.com/getsentry/cli/pull/329)
- (logger) Add consola-based structured logging with Sentry integration by @BYK in [#338](https://github.com/getsentry/cli/pull/338)
- (project) Add `project create` command by @betegon in [#237](https://github.com/getsentry/cli/pull/237)
- (upgrade) Add binary delta patching via TRDIFF10/bsdiff by @BYK in [#327](https://github.com/getsentry/cli/pull/327)
- Support SENTRY_AUTH_TOKEN and SENTRY_TOKEN env vars for headless auth by @BYK in [#356](https://github.com/getsentry/cli/pull/356)
- Improve markdown rendering styles by @BYK in [#342](https://github.com/getsentry/cli/pull/342)

### Bug Fixes 🐛

#### Api

- Use numeric project ID to avoid "not actively selected" error by @betegon in [#312](https://github.com/getsentry/cli/pull/312)
- Use limit param for issues endpoint page size by @BYK in [#309](https://github.com/getsentry/cli/pull/309)
- Auto-correct ':' to '=' in --field values with a warning by @BYK in [#302](https://github.com/getsentry/cli/pull/302)

#### Formatters

- Expand streaming table to fill terminal width by @betegon in [#314](https://github.com/getsentry/cli/pull/314)
- Fix HTML entities and escaped underscores in table output by @betegon in [#313](https://github.com/getsentry/cli/pull/313)

#### Setup

- Suppress agent skills and welcome messages on upgrade by @BYK in [#328](https://github.com/getsentry/cli/pull/328)
- Suppress shell completion messages on upgrade by @BYK in [#326](https://github.com/getsentry/cli/pull/326)

#### Upgrade

- Detect downgrades and skip delta attempt by @BYK in [#358](https://github.com/getsentry/cli/pull/358)
- Check GHCR for nightly version existence instead of GitHub Releases by @BYK in [#352](https://github.com/getsentry/cli/pull/352)
- Replace Bun.mmap with arrayBuffer on all platforms by @BYK in [#343](https://github.com/getsentry/cli/pull/343)
- Replace Bun.mmap with arrayBuffer on macOS to prevent SIGKILL by @BYK in [#340](https://github.com/getsentry/cli/pull/340)
- Use MAP_PRIVATE mmap to prevent macOS SIGKILL during delta upgrade by @BYK in [#339](https://github.com/getsentry/cli/pull/339)

#### Other

- (ci) Generate JUnit XML to silence codecov-action warnings by @BYK in [#300](https://github.com/getsentry/cli/pull/300)
- (install) Fix nightly digest extraction on macOS by @BYK in [#331](https://github.com/getsentry/cli/pull/331)
- (logger) Inject --verbose and --log-level as proper Stricli flags by @BYK in [#353](https://github.com/getsentry/cli/pull/353)
- (nightly) Push to GHCR from artifacts dir so layer titles are bare filenames by @BYK in [#301](https://github.com/getsentry/cli/pull/301)
- (project create) Auto-correct dot-separated platform to hyphens by @BYK in [#336](https://github.com/getsentry/cli/pull/336)
- (region) Resolve DSN org prefix at resolution layer by @BYK in [#316](https://github.com/getsentry/cli/pull/316)
- (test) Handle 0/-0 in getComparator anti-symmetry property test by @BYK in [#308](https://github.com/getsentry/cli/pull/308)
- (trace-logs) Timestamp_precise is a number, not a string by @BYK in [#323](https://github.com/getsentry/cli/pull/323)

### Documentation 📚

- Document SENTRY_URL and self-hosted setup by @BYK in [#337](https://github.com/getsentry/cli/pull/337)

### Internal Changes 🔧

#### Api

- Upgrade @sentry/api to 0.21.0, remove raw HTTP pagination workarounds by @BYK in [#321](https://github.com/getsentry/cli/pull/321)
- Wire listIssuesPaginated through @sentry/api SDK for type safety by @BYK in [#310](https://github.com/getsentry/cli/pull/310)

#### Other

- (craft) Add sentry-release-registry target by @BYK in [#325](https://github.com/getsentry/cli/pull/325)
- (errors) Return Result type from withAuthGuard, expand auto-login to expired tokens by @BYK in [#359](https://github.com/getsentry/cli/pull/359)
- (project create) Migrate human output to markdown rendering system by @BYK in [#341](https://github.com/getsentry/cli/pull/341)
- (telemetry) Add child spans to delta upgrade for bottleneck identification by @BYK in [#355](https://github.com/getsentry/cli/pull/355)
- (upgrade) Use copy-then-mmap for zero JS heap during delta patching by @BYK in [#344](https://github.com/getsentry/cli/pull/344)

## 0.13.0

### New Features ✨

- (issue-list) Add --period flag, pagination progress, and count abbreviation by @BYK in [#289](https://github.com/getsentry/cli/pull/289)
- (nightly) Distribute via GHCR instead of GitHub Releases by @BYK in [#298](https://github.com/getsentry/cli/pull/298)
- (upgrade) Add nightly release channel by @BYK in [#292](https://github.com/getsentry/cli/pull/292)

### Bug Fixes 🐛

- (brew) Handle root-owned config dir from sudo installs by @BYK in [#288](https://github.com/getsentry/cli/pull/288)
- (ci) Use github context for compressed artifact upload condition by @BYK in [#299](https://github.com/getsentry/cli/pull/299)
- (errors) Add ResolutionError for not-found/ambiguous resolution failures by @BYK in [#293](https://github.com/getsentry/cli/pull/293)
- (issue) Improve numeric issue ID resolution with org context and region routing by @BYK in [#294](https://github.com/getsentry/cli/pull/294)
- (setup) Show actual shell name instead of "unknown" for unsupported shells by @BYK in [#287](https://github.com/getsentry/cli/pull/287)
- Optimized the docs images by @MathurAditya724 in [#291](https://github.com/getsentry/cli/pull/291)

### Internal Changes 🔧

- Correct nightly artifact path in publish-nightly job by @BYK in [#295](https://github.com/getsentry/cli/pull/295)
- Only showing status about changed files in codecov by @MathurAditya724 in [#286](https://github.com/getsentry/cli/pull/286)

## 0.12.0

### New Features ✨

- (event) Resolve ID across all orgs when no project context is available by @BYK in [#285](https://github.com/getsentry/cli/pull/285)
- (release) Add Homebrew install support by @BYK in [#277](https://github.com/getsentry/cli/pull/277)
- (setup) Install bash completions as fallback for unsupported shells by @BYK in [#282](https://github.com/getsentry/cli/pull/282)
- Support SENTRY_ORG and SENTRY_PROJECT environment variables by @BYK in [#280](https://github.com/getsentry/cli/pull/280)

### Bug Fixes 🐛

- (fetch) Preserve Content-Type header for SDK requests on Node.js by @BYK in [#276](https://github.com/getsentry/cli/pull/276)
- (help) Document target patterns and trailing-slash significance by @BYK in [#272](https://github.com/getsentry/cli/pull/272)
- (issue-list) Auto-paginate --limit beyond 100 by @BYK in [#274](https://github.com/getsentry/cli/pull/274)
- (npm) Add Node.js >= 22 version guard to npm bundle by @BYK in [#269](https://github.com/getsentry/cli/pull/269)
- (telemetry) Fix commands importing buildCommand directly from @stricli/core by @BYK in [#275](https://github.com/getsentry/cli/pull/275)
- Support numeric project IDs in project slug resolution by @BYK in [#284](https://github.com/getsentry/cli/pull/284)
- Detect subcommand names passed as positional target patterns by @BYK in [#281](https://github.com/getsentry/cli/pull/281)
- Improve error quality and prevent token leak in telemetry by @BYK in [#279](https://github.com/getsentry/cli/pull/279)

### Internal Changes 🔧

- (org) Use shared list-command constants in org list by @BYK in [#273](https://github.com/getsentry/cli/pull/273)

## 0.11.0

### New Features ✨

#### Build

- Add hole-punch tool to reduce compressed binary size by @BYK in [#245](https://github.com/getsentry/cli/pull/245)
- Add gzip-compressed binary downloads by @BYK in [#244](https://github.com/getsentry/cli/pull/244)

#### Other

- (args) Parse Sentry web URLs as CLI arguments by @BYK in [#252](https://github.com/getsentry/cli/pull/252)
- (auth) Switch to /auth/ endpoint and add whoami command by @BYK in [#266](https://github.com/getsentry/cli/pull/266)
- (list) Add pagination and consistent target parsing to all list commands by @BYK in [#262](https://github.com/getsentry/cli/pull/262)

### Bug Fixes 🐛

#### Telemetry

- Reduce noise from version-check JSON parse errors by @BYK in [#253](https://github.com/getsentry/cli/pull/253)
- Skip Sentry reporting for 4xx API errors by @BYK in [#251](https://github.com/getsentry/cli/pull/251)
- Handle EPIPE errors from piped stdout gracefully by @BYK in [#250](https://github.com/getsentry/cli/pull/250)
- Upgrade Sentry SDK to 10.39.0 and remove custom patches by @BYK in [#249](https://github.com/getsentry/cli/pull/249)

#### Other

- (commands) Support org/project/id as single positional arg by @BYK in [#261](https://github.com/getsentry/cli/pull/261)
- (db) Handle readonly database gracefully instead of crashing by @betegon in [#235](https://github.com/getsentry/cli/pull/235)
- (errors) Show meaningful detail instead of [object Object] in API errors by @BYK in [#259](https://github.com/getsentry/cli/pull/259)
- (issue-list) Propagate original errors instead of wrapping in plain Error by @BYK in [#254](https://github.com/getsentry/cli/pull/254)
- (polyfill) Add exited promise and stdin to Bun.spawn Node.js polyfill by @BYK in [#248](https://github.com/getsentry/cli/pull/248)
- (project-list) Add pagination and flexible target parsing by @BYK in [#221](https://github.com/getsentry/cli/pull/221)
- (test) Prevent mock.module() leak from breaking test:isolated by @BYK in [#260](https://github.com/getsentry/cli/pull/260)
- (upgrade) Remove v prefix from release URLs and work around Bun.write streaming bug by @BYK in [#243](https://github.com/getsentry/cli/pull/243)
- Repair pagination_cursors composite PK and isolate test suites by @BYK in [#265](https://github.com/getsentry/cli/pull/265)

### Internal Changes 🔧

- (build) Replace local hole-punch script with binpunch package by @BYK in [#246](https://github.com/getsentry/cli/pull/246)
- Use @sentry/api client for requests by @MathurAditya724 in [#226](https://github.com/getsentry/cli/pull/226)

## 0.10.0

### New Features ✨

- (formatters) Add Seer fixability score to issue list and detail views by @betegon in [#234](https://github.com/getsentry/cli/pull/234)
- (team) Add `team list` command by @betegon in [#238](https://github.com/getsentry/cli/pull/238)

### Bug Fixes 🐛

#### Telemetry

- Use SDK session integration instead of manual management by @BYK in [#232](https://github.com/getsentry/cli/pull/232)
- Correct runtime context for Bun binary by @BYK in [#231](https://github.com/getsentry/cli/pull/231)

#### Other

- (setup) Use correct auth command in install welcome message by @betegon in [#241](https://github.com/getsentry/cli/pull/241)
- (tests) Centralize test config dir lifecycle to prevent env var pollution by @BYK in [#242](https://github.com/getsentry/cli/pull/242)

## 0.9.1

### New Features ✨

#### Cli

- Add setup command for shell integration by @BYK in [#213](https://github.com/getsentry/cli/pull/213)
- Add plural command aliases for list commands by @betegon in [#209](https://github.com/getsentry/cli/pull/209)

#### Other

- (formatters) Display span duration in span tree by @betegon in [#219](https://github.com/getsentry/cli/pull/219)
- (log) Add view command to display log entry details by @betegon in [#212](https://github.com/getsentry/cli/pull/212)
- (repo) Add repo list command by @betegon in [#222](https://github.com/getsentry/cli/pull/222)
- (setup) Auto-install Claude Code agent skill during setup by @BYK in [#216](https://github.com/getsentry/cli/pull/216)
- (trace) Add trace list and view commands by @betegon in [#218](https://github.com/getsentry/cli/pull/218)

### Bug Fixes 🐛

#### Upgrade

- Handle EPERM in isProcessRunning for cross-user locks by @BYK in [#211](https://github.com/getsentry/cli/pull/211)
- Replace curl pipe with direct binary download by @BYK in [#208](https://github.com/getsentry/cli/pull/208)

#### Other

- (craft) Use regex pattern for binary artifact matching by @BYK in [#230](https://github.com/getsentry/cli/pull/230)
- (deps) Move runtime dependencies to devDependencies by @BYK in [#225](https://github.com/getsentry/cli/pull/225)

### Documentation 📚

- (log) Add documentation for sentry log view command by @betegon in [#214](https://github.com/getsentry/cli/pull/214)
- Add documentation for log command by @betegon in [#210](https://github.com/getsentry/cli/pull/210)

### Internal Changes 🔧

#### Ci

- Auto-commit SKILL.md when stale by @betegon in [#224](https://github.com/getsentry/cli/pull/224)
- Remove merge-artifacts job with Craft 2.21.1 by @BYK in [#215](https://github.com/getsentry/cli/pull/215)

#### Other

- (project) Replace --org flag with org/project positional by @betegon in [#223](https://github.com/getsentry/cli/pull/223)
- (setup) Unify binary placement via setup --install by @BYK in [#217](https://github.com/getsentry/cli/pull/217)
- Rename CI workflow to Build and fix artifact filter by @BYK in [#229](https://github.com/getsentry/cli/pull/229)
- Handle fork PRs in SKILL.md auto-commit by @BYK in [#227](https://github.com/getsentry/cli/pull/227)
- Enable minify for standalone binaries by @BYK in [#220](https://github.com/getsentry/cli/pull/220)

### Other

- release: 0.9.0 by @BYK in [1452e02c](https://github.com/getsentry/cli/commit/1452e02ca3e359388a4e84578e8dad81f63f3f2d)

## 0.9.0

### New Features ✨

#### Cli

- Add setup command for shell integration by @BYK in [#213](https://github.com/getsentry/cli/pull/213)
- Add plural command aliases for list commands by @betegon in [#209](https://github.com/getsentry/cli/pull/209)

#### Other

- (formatters) Display span duration in span tree by @betegon in [#219](https://github.com/getsentry/cli/pull/219)
- (log) Add view command to display log entry details by @betegon in [#212](https://github.com/getsentry/cli/pull/212)
- (repo) Add repo list command by @betegon in [#222](https://github.com/getsentry/cli/pull/222)
- (setup) Auto-install Claude Code agent skill during setup by @BYK in [#216](https://github.com/getsentry/cli/pull/216)
- (trace) Add trace list and view commands by @betegon in [#218](https://github.com/getsentry/cli/pull/218)

### Bug Fixes 🐛

#### Upgrade

- Handle EPERM in isProcessRunning for cross-user locks by @BYK in [#211](https://github.com/getsentry/cli/pull/211)
- Replace curl pipe with direct binary download by @BYK in [#208](https://github.com/getsentry/cli/pull/208)

#### Other

- (deps) Move runtime dependencies to devDependencies by @BYK in [#225](https://github.com/getsentry/cli/pull/225)

### Documentation 📚

- (log) Add documentation for sentry log view command by @betegon in [#214](https://github.com/getsentry/cli/pull/214)
- Add documentation for log command by @betegon in [#210](https://github.com/getsentry/cli/pull/210)

### Internal Changes 🔧

#### Ci

- Auto-commit SKILL.md when stale by @betegon in [#224](https://github.com/getsentry/cli/pull/224)
- Remove merge-artifacts job with Craft 2.21.1 by @BYK in [#215](https://github.com/getsentry/cli/pull/215)

#### Other

- (project) Replace --org flag with org/project positional by @betegon in [#223](https://github.com/getsentry/cli/pull/223)
- (setup) Unify binary placement via setup --install by @BYK in [#217](https://github.com/getsentry/cli/pull/217)
- Rename CI workflow to Build and fix artifact filter by @BYK in [#229](https://github.com/getsentry/cli/pull/229)
- Handle fork PRs in SKILL.md auto-commit by @BYK in [#227](https://github.com/getsentry/cli/pull/227)
- Enable minify for standalone binaries by @BYK in [#220](https://github.com/getsentry/cli/pull/220)

## 0.8.0

### New Features ✨

- (auth) Add token command and remove /users/me/ dependency by @BYK in [#207](https://github.com/getsentry/cli/pull/207)

### Bug Fixes 🐛

- (alias) Fix alias generation and highlighting for prefix-related slugs by @BYK in [#203](https://github.com/getsentry/cli/pull/203)

### Internal Changes 🔧

- (commands) Replace --org/--project flags with positional args for event view by @BYK in [#205](https://github.com/getsentry/cli/pull/205)

### Other

- test: add tests for resolveFromProjectSearch to increase coverage by @BYK in [#206](https://github.com/getsentry/cli/pull/206)
- test: add tests for project-cache and env-file modules by @BYK in [#200](https://github.com/getsentry/cli/pull/200)

## 0.7.0

### New Features ✨

#### Dsn

- Infer project from directory name when DSN detection fails by @BYK in [#178](https://github.com/getsentry/cli/pull/178)
- Add project root detection for automatic DSN discovery by @BYK in [#159](https://github.com/getsentry/cli/pull/159)

#### Other

- (auth) Auto-trigger login flow when authentication required by @betegon in [#170](https://github.com/getsentry/cli/pull/170)
- (commands) Add sentry log command by @betegon in [#160](https://github.com/getsentry/cli/pull/160)
- (db) Add schema repair and `sentry cli fix` command by @BYK in [#197](https://github.com/getsentry/cli/pull/197)
- (issue) Replace --org/--project flags with <org>/ID syntax by @BYK in [#161](https://github.com/getsentry/cli/pull/161)
- (lib) Add anyTrue helper for parallel-with-early-exit pattern by @BYK in [#174](https://github.com/getsentry/cli/pull/174)
- (telemetry) Add withTracing helper to reduce Sentry span boilerplate by @BYK in [#172](https://github.com/getsentry/cli/pull/172)

### Bug Fixes 🐛

- (types) Align schema types with Sentry API by @betegon in [#169](https://github.com/getsentry/cli/pull/169)
- Corrected the codecov action script by @MathurAditya724 in [#201](https://github.com/getsentry/cli/pull/201)
- Improved the plan command by @MathurAditya724 in [#185](https://github.com/getsentry/cli/pull/185)
- Use ASCII arrow for consistent terminal rendering by @BYK in [#192](https://github.com/getsentry/cli/pull/192)
- Corrected the rendering and props for the span tree by @MathurAditya724 in [#184](https://github.com/getsentry/cli/pull/184)
- ParseIssueArg now checks slashes before dashes by @BYK in [#177](https://github.com/getsentry/cli/pull/177)
- Address bugbot review comments on dsn-cache model-based tests by @BYK in [#176](https://github.com/getsentry/cli/pull/176)
- Added nullable in substatus's zod validation by @MathurAditya724 in [#157](https://github.com/getsentry/cli/pull/157)

### Documentation 📚

- Update AGENTS.md with testing guidelines and architecture by @BYK in [#190](https://github.com/getsentry/cli/pull/190)

### Internal Changes 🔧

- (upgrade) Use centralized user-agent for GitHub API requests by @BYK in [#173](https://github.com/getsentry/cli/pull/173)

### Other

- test: add comprehensive tests for resolve-target module by @BYK in [#199](https://github.com/getsentry/cli/pull/199)
- test: add tests for executeUpgrade with unknown method by @BYK in [#198](https://github.com/getsentry/cli/pull/198)
- test: expand version check test coverage by @BYK in [#196](https://github.com/getsentry/cli/pull/196)
- test: add comprehensive tests for DSN errors and resolver by @BYK in [#195](https://github.com/getsentry/cli/pull/195)
- test: add comprehensive tests for human formatter detail functions by @BYK in [#194](https://github.com/getsentry/cli/pull/194)
- test: add comprehensive tests for human formatter utilities by @BYK in [#191](https://github.com/getsentry/cli/pull/191)
- test: add coverage for fetchLatestVersion and versionExists by @BYK in [#189](https://github.com/getsentry/cli/pull/189)
- test: add coverage for UpgradeError and SeerError classes by @BYK in [#188](https://github.com/getsentry/cli/pull/188)
- test: add property tests for sentry-urls.ts (Phase 3) by @BYK in [#186](https://github.com/getsentry/cli/pull/186)
- test: simplify issue-id tests covered by property tests by @BYK in [#183](https://github.com/getsentry/cli/pull/183)
- test: simplify alias and arg-parsing tests covered by property tests by @BYK in [#182](https://github.com/getsentry/cli/pull/182)
- test: add property tests for API command and human formatters by @BYK in [#181](https://github.com/getsentry/cli/pull/181)
- test: remove redundant DB tests covered by model-based tests by @BYK in [#180](https://github.com/getsentry/cli/pull/180)
- test: add property tests for async utilities (Phase 4) by @BYK in [#179](https://github.com/getsentry/cli/pull/179)
- test: add model-based tests for DSN and project cache by @BYK in [#171](https://github.com/getsentry/cli/pull/171)
- test: add model-based and property-based testing with fast-check by @BYK in [#166](https://github.com/getsentry/cli/pull/166)

## 0.6.0

### New Features ✨

- (commands) Use positional args for org/project selection by @BYK in [#155](https://github.com/getsentry/cli/pull/155)
- (feedback) Add command to submit CLI feedback by @betegon in [#150](https://github.com/getsentry/cli/pull/150)
- (telemetry) Add is_self_hosted tag by @BYK in [#153](https://github.com/getsentry/cli/pull/153)
- (upgrade) Add self-update command by @betegon in [#132](https://github.com/getsentry/cli/pull/132)
- Add update available notification by @BYK in [#151](https://github.com/getsentry/cli/pull/151)

### Bug Fixes 🐛

- (telemetry) Capture command errors to Sentry by @betegon in [#145](https://github.com/getsentry/cli/pull/145)
- Update docs URL in help output by @betegon in [#149](https://github.com/getsentry/cli/pull/149)

### Documentation 📚

- (upgrade) Add documentation for upgrade command by @betegon in [#152](https://github.com/getsentry/cli/pull/152)
- Update README and AGENTS.md by @betegon in [#148](https://github.com/getsentry/cli/pull/148)

### Internal Changes 🔧

- Move feedback and upgrade under `sentry cli` command by @BYK in [#154](https://github.com/getsentry/cli/pull/154)

## 0.5.3

### Bug Fixes 🐛

- (telemetry) Enable sourcemap resolution in Sentry by @BYK in [#144](https://github.com/getsentry/cli/pull/144)

## 0.5.2

### Bug Fixes 🐛

- (auth) Display user info on login and status commands by @BYK in [#143](https://github.com/getsentry/cli/pull/143)

### Documentation 📚

- Add agentic usage documentation by @sergical in [#142](https://github.com/getsentry/cli/pull/142)

## 0.5.1

### Bug Fixes 🐛

- (cli) Show clean error messages without stack traces for user-facing errors by @BYK in [#141](https://github.com/getsentry/cli/pull/141)
- (db) Add transaction method to Node SQLite polyfill by @BYK in [#140](https://github.com/getsentry/cli/pull/140)

## 0.5.0

### New Features ✨

#### Api

- Add multi-region support for Sentry SaaS by @BYK in [#134](https://github.com/getsentry/cli/pull/134)
- Add custom User-Agent header to API requests by @BYK in [#125](https://github.com/getsentry/cli/pull/125)

#### Other

- (docs) Add Sentry SDK for error tracking, replay, and metrics by @betegon in [#122](https://github.com/getsentry/cli/pull/122)
- (project) Improve project list and view output by @betegon in [#129](https://github.com/getsentry/cli/pull/129)
- (seer) Add actionable error messages for Seer API errors by @betegon in [#130](https://github.com/getsentry/cli/pull/130)
- (telemetry) Improve Sentry instrumentation by @BYK in [#127](https://github.com/getsentry/cli/pull/127)

### Bug Fixes 🐛

- (issue) Support numeric short suffixes like "15" in issue view by @BYK in [#138](https://github.com/getsentry/cli/pull/138)
- (npx) Suppress Node.js warnings in npm package by @BYK in [#115](https://github.com/getsentry/cli/pull/115)

### Documentation 📚

- (issue) Add command reference for explain and plan by @betegon in [#137](https://github.com/getsentry/cli/pull/137)
- (skill) Add well-known skills discovery endpoint by @sergical in [#135](https://github.com/getsentry/cli/pull/135)

### Internal Changes 🔧

- (db) Add upsert() helper to reduce SQL boilerplate by @BYK in [#139](https://github.com/getsentry/cli/pull/139)
- Allow PRs to merge when CI jobs are skipped by @BYK in [#123](https://github.com/getsentry/cli/pull/123)

### Other

- fix links to commands from /getting-started by @souredoutlook in [#133](https://github.com/getsentry/cli/pull/133)

## 0.4.2

### Bug Fixes 🐛

- (docs) For the mobile screen by @MathurAditya724 in [#116](https://github.com/getsentry/cli/pull/116)

## 0.4.1

### Bug Fixes 🐛

#### Release

- Add Node.js 22 setup for type stripping support by @BYK in [#114](https://github.com/getsentry/cli/pull/114)
- Use Node.js instead of Bun for release scripts by @BYK in [#113](https://github.com/getsentry/cli/pull/113)

#### Other

- Updated the skills plugin details by @MathurAditya724 in [#111](https://github.com/getsentry/cli/pull/111)

### Documentation 📚

- Fix some broken stuff by @MathurAditya724 in [#112](https://github.com/getsentry/cli/pull/112)

## 0.4.0

### New Features ✨

- (docs) Add Open Graph images for social sharing by @betegon in [#109](https://github.com/getsentry/cli/pull/109)
- (install) Auto-add sentry to PATH on install by @betegon in [#108](https://github.com/getsentry/cli/pull/108)
- Auto-generate SKILL.md and extract version bump script by @BYK in [#105](https://github.com/getsentry/cli/pull/105)
- Updated the install button by @MathurAditya724 in [#103](https://github.com/getsentry/cli/pull/103)
- Add global help command using Stricli's defaultCommand by @BYK in [#104](https://github.com/getsentry/cli/pull/104)

### Bug Fixes 🐛

- (ci) Install bun in release workflow by @betegon in [#110](https://github.com/getsentry/cli/pull/110)
- (docs) Mobile styling improvements for landing page by @betegon in [#106](https://github.com/getsentry/cli/pull/106)

## 0.3.3

### Bug Fixes 🐛

- Add shebang to npm bundle for global installs by @BYK in [#101](https://github.com/getsentry/cli/pull/101)

### Documentation 📚

- Add CNAME file for custom domain in build artifact by @BYK in [#102](https://github.com/getsentry/cli/pull/102)

## 0.3.2

### Documentation 📚

- Update base path for cli.sentry.dev domain by @BYK in [#100](https://github.com/getsentry/cli/pull/100)

## 0.3.1

### Bug Fixes 🐛

- (ci) Correct gh-pages.zip structure for Craft publishing by @BYK in [#99](https://github.com/getsentry/cli/pull/99)

## 0.3.0

### New Features ✨

#### Issue

- Add workspace-scoped alias cache by @BYK in [#52](https://github.com/getsentry/cli/pull/52)
- Add short ID aliases for multi-project support by @BYK in [#31](https://github.com/getsentry/cli/pull/31)

#### Other

- (api) Align with gh api and curl conventions by @BYK in [#60](https://github.com/getsentry/cli/pull/60)
- (auth) Add press 'c' to copy URL during login flow by @betegon in [#58](https://github.com/getsentry/cli/pull/58)
- (commands) Rename get commands to view and add -w browser flag by @BYK in [#53](https://github.com/getsentry/cli/pull/53)
- (install) Add install script served from docs site by @betegon in [#95](https://github.com/getsentry/cli/pull/95)
- Add install script for easy CLI installation by @betegon in [#97](https://github.com/getsentry/cli/pull/97)
- Added CLI Skill by @MathurAditya724 in [#69](https://github.com/getsentry/cli/pull/69)
- Added span tree by @MathurAditya724 in [#86](https://github.com/getsentry/cli/pull/86)
- New intro in CLI by @MathurAditya724 in [#84](https://github.com/getsentry/cli/pull/84)
- Added footer formatting function by @MathurAditya724 in [#71](https://github.com/getsentry/cli/pull/71)
- Add explain and plan commands (Seer AI) by @MathurAditya724 in [#39](https://github.com/getsentry/cli/pull/39)
- Add Sentry SDK for error tracking and usage telemetry by @BYK in [#63](https://github.com/getsentry/cli/pull/63)

### Bug Fixes 🐛

#### Issue

- Support short ID aliases in explain and plan commands by @BYK in [#74](https://github.com/getsentry/cli/pull/74)
- Use correct fallback for unrecognized alias-suffix inputs by @BYK in [#72](https://github.com/getsentry/cli/pull/72)
- Handle cross-org project slug collisions in alias generation by @BYK in [#62](https://github.com/getsentry/cli/pull/62)
- Use org-scoped endpoint for latest event + enhanced display by @betegon in [#40](https://github.com/getsentry/cli/pull/40)

#### Other

- (api) Use query params for --field with GET requests by @BYK in [#59](https://github.com/getsentry/cli/pull/59)
- (install) Use correct download URL without 'v' prefix by @betegon in [#94](https://github.com/getsentry/cli/pull/94)
- (telemetry) Patch Sentry SDK to prevent 3-second exit delay by @BYK in [#85](https://github.com/getsentry/cli/pull/85)

### Documentation 📚

- (agents) Update AGENTS.md to reflect current codebase by @betegon in [#93](https://github.com/getsentry/cli/pull/93)
- (issue) Update list command tips to reference view instead of get by @BYK in [#73](https://github.com/getsentry/cli/pull/73)
- (readme) Add installation section by @betegon in [#65](https://github.com/getsentry/cli/pull/65)
- Add install script section to getting started guide by @betegon in [#98](https://github.com/getsentry/cli/pull/98)
- Add documentation website by @betegon in [#77](https://github.com/getsentry/cli/pull/77)
- Update command references from 'get' to 'view' and document -w flag by @BYK in [#54](https://github.com/getsentry/cli/pull/54)

### Internal Changes 🔧

- (config) Migrate storage from JSON to SQLite by @BYK in [#89](https://github.com/getsentry/cli/pull/89)
- (issue) Extract shared parameters for issue commands by @BYK in [#79](https://github.com/getsentry/cli/pull/79)
- (release) Fix changelog-preview permissions by @BYK in [#41](https://github.com/getsentry/cli/pull/41)
- Rename config folder from .sentry-cli-next to .sentry by @BYK in [#50](https://github.com/getsentry/cli/pull/50)

### Other

- test(e2e): use mock HTTP server instead of live API by @BYK in [#78](https://github.com/getsentry/cli/pull/78)

## 0.2.0

- No documented changes.

