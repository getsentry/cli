# Documentation Gap Report

_Generated: 2026-04-06 | Branch: `cursor/sentry-cli-docs-gaps-3d35`_

This report identifies gaps between the Sentry CLI implementation and its documentation across all surfaces: the Astro doc site (`docs/src/content/docs/`), `README.md`, `DEVELOPMENT.md`, and `AGENTS.md`.

---

## A. Undocumented or Missing Commands/Subcommands

### Missing from `ROUTE_TO_REFERENCE` in `script/generate-skill.ts`

The `release` and `sourcemap` routes in `src/app.ts` are **not present** in the `ROUTE_TO_REFERENCE` map. This means they fall through to the default (`route.name` used as-is), producing reference files named `release.md` and `sourcemap.md` instead of being grouped with a `REFERENCE_TITLES` entry.

| Route | Expected in `ROUTE_TO_REFERENCE`? | Has `REFERENCE_TITLES` entry? | Generated ref file |
|-------|-----------------------------------|-------------------------------|--------------------|
| `release` | **No** — missing | **No** — no title like "Release Commands" | `release.md` (untitled group) |
| `sourcemap` | **No** — missing | **No** — no title | `sourcemap.md` (untitled group) |

**Source:** `script/generate-skill.ts` lines 94–111 (map), lines 114–127 (titles)  
**Impact:** Generated skill reference files for releases and sourcemaps have no descriptive title, just a fallback.

### `sentry release propose-version` — No bash example in docs

The `release.md` doc page covers `propose-version` in the command table, but the examples section does show a usage example: `sentry release create $(sentry release propose-version)`. This is adequate.

### `sentry issue events` — Not in README command table

The README `Commands` table lists `sentry issue` as "List, view, explain, and plan issues" but does **not mention** the `events` subcommand. The doc site's `issue.md` does document it.

**Source:** `README.md` line 76; `src/commands/issue/events.ts`  
**Doc file:** `docs/src/content/docs/commands/issue.md` (covered); `README.md` (gap)

### `sentry dashboard widget` subcommands — Not in README command table

The README lists `sentry dashboard` as "List, view, and create dashboards with widgets" but omits the `widget add`, `widget edit`, and `widget delete` subcommands from the description.

**Source:** `README.md` line 81; `src/commands/dashboard/widget/`

### Missing from README: `sentry release`, `sentry repo`, `sentry team`

The README command table is missing the following command groups that exist in both code and docs:

| Command | In code? | In doc site? | In README? |
|---------|----------|--------------|------------|
| `sentry release` | Yes | Yes (`release.md`) | **No** |
| `sentry repo` | Yes | Yes (`repo.md`) | **No** |
| `sentry team` | Yes | Yes (`team.md`) | **No** |

**Source:** `src/app.ts` routes; `README.md` lines 69–87

---

## B. Undocumented Flags

### `sentry auth login --force`

The code defines a `force` flag (boolean, brief: "Re-authenticate without prompting"). The doc page at `auth.md` documents `--force` correctly. **No gap.**

### `sentry cli feedback` — brief differs

- **Code brief:** `"Send feedback to the Sentry team"`
- **Doc brief:** `"Send feedback about the CLI"`

Minor wording difference. Not a functional gap.

### `sentry log list` — `--cursor` flag

The `log list` command sets `noCursorFlag: true`, so it does **not** have a `--cursor` flag. The doc page correctly omits it. **No gap.**

### `sentry log list` — `-f` alias for `--fresh`

The code assigns `-f` to `--follow` (not `--fresh`) for `log list`. The `--fresh` flag exists but has **no short alias**. The doc page shows `--fresh` with no alias, which is correct.

### `sentry org list` — no `--cursor` flag

`org list` does not define a `--cursor` flag. The doc page correctly omits it. **No gap.**

### `sentry sourcemap upload` — missing `--org` / `--project` docs

The `sourcemap upload` command resolves org/project via `resolveOrgAndProject()`, but the doc page only shows `--release` and `--url-prefix` flags. The positional `<directory>` is documented. Users may need to specify org/project via env vars or positional when auto-detect fails, but the docs don't explain this resolution path.

**Source:** `src/commands/sourcemap/upload.ts`  
**Doc file:** `docs/src/content/docs/commands/sourcemap.md`

---

## C. Missing Usage Examples

### `sentry release deploy` — no example with optional flags

The doc page shows basic `sentry release deploy 1.0.0 production` examples, but does not show examples for `--url`, `--started`, `--finished`, or `--time` flags.

**Source:** `src/commands/release/deploy.ts`  
**Doc file:** `docs/src/content/docs/commands/release.md`

### `sentry release deploys` — no example

The doc page lists the command but has no dedicated bash example. The general examples section covers it indirectly but doesn't show the `deploys` subcommand standalone.

### `sentry release delete` — no example

No bash example for `sentry release delete`. The examples only show create/finalize/deploy workflow.

**Doc file:** `docs/src/content/docs/commands/release.md`

---

## D. Stale Descriptions

### `sentry cli feedback`

| Source | Brief |
|--------|-------|
| Code (`cli/feedback.ts`) | `"Send feedback to the Sentry team"` |
| Doc (`cli.md`) | `"Send feedback about the CLI"` |

Minor wording difference, but the code version is more accurate.

### `sentry dashboard` description in `commands/index.md`

| Source | Description |
|--------|-------------|
| `commands/index.md` | "Manage Sentry dashboards" |
| Code route brief | "Manage Sentry dashboards" |

**No gap** for this one.

### `sentry init` — description in `commands/index.md`

| Source | Description |
|--------|-------------|
| `commands/index.md` | "Initialize Sentry in your project (experimental)" |
| Code brief | "Initialize Sentry in your project (experimental)" |

**No gap.**

---

## E. Missing Route Mappings in Skill Generator

The `ROUTE_TO_REFERENCE` map in `script/generate-skill.ts` is **missing**:

| Route in `src/app.ts` | Present in `ROUTE_TO_REFERENCE`? | Generated file |
|------------------------|----------------------------------|----------------|
| `release` | **No** | Falls back to `release.md` (no title in `REFERENCE_TITLES`) |
| `sourcemap` | **No** | Falls back to `sourcemap.md` (no title in `REFERENCE_TITLES`) |
| `help` | **No** | Falls back to `help.md` (acceptable — help is special) |

The `release` and `sourcemap` routes should be added to both `ROUTE_TO_REFERENCE` and `REFERENCE_TITLES` for proper generated skill documentation.

**Source:** `script/generate-skill.ts` lines 94–127

---

## F. Installation / Distribution Gaps

### 1. Installer flags not fully documented

The `install` bash script accepts these flags:

| Flag | Documented in getting-started.mdx? | Documented in README? |
|------|-------------------------------------|----------------------|
| `--version <version>` | Yes | Yes (inline) |
| `--no-modify-path` | **No** | **No** |
| `--no-completions` | **No** | **No** |
| `-h` / `--help` | **No** | **No** |

**Source:** `install` script usage function  
**Doc file:** `docs/src/content/docs/getting-started.mdx`, `README.md`

### 2. `SENTRY_CLI_NO_TELEMETRY` suppresses installer error reporting

The install script checks `SENTRY_CLI_NO_TELEMETRY=1` to disable fire-and-forget error reporting. This is documented in `configuration.md` but not mentioned in the getting-started page's install script section.

### 3. Windows support not mentioned in docs

The install script supports Windows (MINGW/MSYS/CYGWIN detection), but **none of the documentation** mentions Windows as a supported platform. The install script, `.craft.yml`, and build scripts all produce Windows x64 binaries.

**Source:** `install` script lines 128–151; `script/build.ts` targets  
**Doc file:** `getting-started.mdx`, `README.md` (no mention)

### 4. `pnpm dlx`, `yarn dlx`, `bunx` run-without-installing not in README

The getting-started page shows `pnpm dlx`, `yarn dlx`, `bunx` via the `PackageManagerCode` component, but the README only shows `npx sentry@latest`. Missing alternatives.

**Source:** `docs/src/content/docs/getting-started.mdx` line 58–63  
**Doc file:** `README.md` line 43

### 5. `yarn` as install method mentioned in getting-started but not README

The getting-started page includes `yarn global add sentry`, but the README does not list yarn.

---

## G. Undocumented Environment Variables

The following `SENTRY_*` variables are referenced in `src/` but **not documented** in `docs/src/content/docs/configuration.md`:

| Variable | Location in code | Purpose |
|----------|-----------------|---------|
| `SENTRY_RELEASE` | `src/commands/release/propose-version.ts` | Used by `release propose-version` to get release version from env |
| `SENTRY_MAX_PAGINATION_PAGES` | `src/lib/api/infrastructure.ts` | Override max pagination pages (default: 50) |
| `SENTRY_CLI_NO_AUTO_REPAIR` | `src/lib/db/schema.ts` | Disable automatic SQLite schema repair |
| `SENTRY_OUTPUT_FORMAT` | `src/lib/command.ts`, `src/lib/sdk-invoke.ts` | Internal: forces JSON output (used by SDK invoke) |

### Already documented (for completeness):

| Variable | In `configuration.md`? |
|----------|----------------------|
| `SENTRY_AUTH_TOKEN` | Yes |
| `SENTRY_TOKEN` | Yes |
| `SENTRY_HOST` | Yes |
| `SENTRY_URL` | Yes |
| `SENTRY_ORG` | Yes |
| `SENTRY_PROJECT` | Yes |
| `SENTRY_DSN` | Yes |
| `SENTRY_CLIENT_ID` | Yes |
| `SENTRY_CONFIG_DIR` | Yes |
| `SENTRY_VERSION` | Yes |
| `SENTRY_PLAIN_OUTPUT` | Yes |
| `NO_COLOR` | Yes |
| `SENTRY_CLI_NO_TELEMETRY` | Yes |
| `SENTRY_LOG_LEVEL` | Yes |
| `SENTRY_CLI_NO_UPDATE_CHECK` | Yes |
| `SENTRY_INSTALL_DIR` | Yes |
| `SENTRY_NO_CACHE` | Yes |

---

## H. Auth / Self-Hosted Gaps

### 1. OAuth scopes: `team:write` missing from DEVELOPMENT.md

The code requests these scopes (`src/lib/oauth.ts` line 53–63):
```
project:read, project:write, project:admin, org:read, event:read, event:write, member:read, team:read, team:write
```

But `DEVELOPMENT.md` lists only:
```
project:read, project:write, project:admin, org:read, event:read, event:write, member:read, team:read
```

**Missing: `team:write`** — required for team management operations.

**Source:** `src/lib/oauth.ts` line 62  
**Doc file:** `DEVELOPMENT.md` line 63

### 2. Self-hosted doc missing minimum version for `--token` fallback

`docs/src/content/docs/self-hosted.md` documents that OAuth requires Sentry 26.1.0+, and offers `--token` as fallback for older instances. However, it does not specify any minimum version requirement for the token-based flow, which could mislead users of very old instances.

### 3. `SENTRY_HOST` vs `SENTRY_URL` precedence not in self-hosted.md table

The self-hosted doc's environment variable table says `SENTRY_HOST` "takes precedence over `SENTRY_URL`" but doesn't make this explicit for the `SENTRY_CLIENT_ID` flow. The code in `constants.ts` reads `SENTRY_HOST` first, then `SENTRY_URL`, which is correctly described in `configuration.md` but could be clearer in the self-hosted guide.

### 4. Token storage path shown as `~/.sentry/` but actual file is `~/.sentry/cli.db`

`README.md` says "Credentials are stored in `~/.sentry/`" (line 92), and `auth.md` says "Auth tokens are stored in a SQLite database at `~/.sentry/cli.db`" (line 139). The README should mention the specific filename for clarity.

---

## I. Plugin/Skills Gaps

### 1. Cursor support: `agent-skills.ts` only auto-installs for Claude Code

The code (`src/lib/agent-skills.ts`) only auto-installs skills for **Claude Code** (detects `~/.claude` directory). It does **not** auto-install for Cursor or any other IDE.

However, `plugins/README.md` states that skills are "automatically available in `.cursor/skills/`" for Cursor users, suggesting the repo layout provides them — but the actual `.cursor/skills/` directory is **not present** in the current repository tree. Only `.cursor/rules/` exists.

**Source:** `src/lib/agent-skills.ts`; `plugins/README.md`

### 2. `agentic-usage.md` says "Claude Code" but setup actually supports any `~/.claude` user

The `agentic-usage.md` page mentions "AI coding agents like Claude Code" and says to use `npx skills add https://cli.sentry.dev`. This is a different installation path than what `sentry cli setup` does internally (which embeds skills, no HTTP fetch).

The doc should distinguish between:
- **`sentry cli setup`** → auto-installs embedded skills for Claude Code
- **`npx skills add`** → external tool for any agent that supports the skills protocol

### 3. `plugins/README.md` references `claude plugin marketplace add` — undocumented elsewhere

The `plugins/README.md` describes Claude Code marketplace installation:
```
claude plugin marketplace add getsentry/cli
claude plugin install sentry/cli
```

This is not mentioned in `agentic-usage.md`, `README.md`, or any doc site page.

### 4. Plugin manifest version stale

`plugins/sentry-cli/.claude-plugin/plugin.json` has `"version": "0.25.0"` while `package.json` has `"version": "0.25.0-dev.0"`. These should stay in sync. The version in the plugin manifest lacks the `-dev.0` suffix, but more importantly, it should be updated when releases are cut.

---

## J. README / DEVELOPMENT.md Drift

### 1. `DEVELOPMENT.md` OAuth scopes missing `team:write`

As noted in Section H.1, the scopes list in `DEVELOPMENT.md` is missing `team:write`. The code requests 9 scopes; the doc lists 8.

**Source:** `DEVELOPMENT.md` line 63; `src/lib/oauth.ts` lines 53–63

### 2. `DEVELOPMENT.md` environment variable table missing `SENTRY_AUTH_TOKEN`

The `DEVELOPMENT.md` environment variable table only lists `SENTRY_CLIENT_ID`, `SENTRY_HOST`, and `SENTRY_URL`. It does not mention `SENTRY_AUTH_TOKEN` or `SENTRY_TOKEN`, which are the primary authentication mechanisms for CI/CD and are documented in `configuration.md`.

**Source:** `DEVELOPMENT.md` lines 70–74

### 3. `README.md` — `bun add -g sentry` vs `bun install -g sentry`

The README uses `bun add -g sentry` (line 36), which is correct Bun syntax. The `cli.md` docs page mentions `bun install -g sentry` in the detection table (line 126), which is an alias but less canonical.

### 4. `README.md` — missing `sentry release`, `sentry repo`, `sentry team` from command table

As noted in Section A, three command groups present in code and docs are missing from the README command table.

### 5. `README.md` — Bun version claim

README says "Bun v1.0+" as prerequisite (line 135). `package.json` declares `"packageManager": "bun@1.3.11"`. While v1.0 may work as a minimum, the actual development version is significantly newer.

---

## Top 5 Most Impactful Fixes

1. **Add `release` and `sourcemap` to `ROUTE_TO_REFERENCE` in skill generator** — These are major command groups (8+ subcommands for release) that lack proper titles and grouping in generated skill files. Affects AI agent usability.

2. **Add missing `SENTRY_*` env vars to `configuration.md`** — `SENTRY_RELEASE`, `SENTRY_MAX_PAGINATION_PAGES`, and `SENTRY_CLI_NO_AUTO_REPAIR` are all user-facing environment variables that are undocumented. `SENTRY_RELEASE` is especially important for the `propose-version` command.

3. **Fix OAuth scopes in `DEVELOPMENT.md`** — Missing `team:write` means contributors creating OAuth apps will have insufficient permissions, causing mysterious 403 errors on team operations.

4. **Add `sentry release`, `sentry repo`, `sentry team` to README command table** — These are production-ready commands that users won't discover from the README. Release management is a critical CI/CD workflow.

5. **Document installer `--no-modify-path` and `--no-completions` flags** — These are essential for CI/CD and Docker environments where PATH modification and shell completion are unwanted. Currently only discoverable via `install --help`.
