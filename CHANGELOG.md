# Changelog

<!-- Craft will auto-populate this file -->
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

