# Changelog

<!-- Craft will auto-populate this file -->
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

