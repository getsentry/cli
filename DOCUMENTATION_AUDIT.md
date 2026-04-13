# Sentry CLI Documentation Audit Report

**Date:** 2026-04-13
**Scope:** Cross-reference of code implementation against all documentation surfaces

---

## A. Undocumented or Missing Commands/Subcommands

Command doc pages under `docs/src/content/docs/commands/` are **auto-generated** by `bun run generate:docs` and are **gitignored**, so they are not present in the repo at rest. The hand-written fragments in `docs/src/fragments/commands/` cover all top-level route groups. However, several commands are absent or under-represented in the **root README.md** commands table:

| Command | In code (`src/commands/`) | In README table | In fragments |
|---------|--------------------------|-----------------|-------------|
| `sentry release` (list, view, create, finalize, delete, deploy, deploys, set-commits, propose-version) | Yes | **Missing** | Yes (`release.md`) |
| `sentry repo list` | Yes | **Missing** | Yes (`repo.md`) |
| `sentry team list` | Yes | **Missing** | Yes (`team.md`) |
| `sentry trial` (list, start) | Yes | **Missing from table** | Yes (`trial.md`) |
| `sentry whoami` (top-level alias) | Yes | **Missing** | Covered in `auth.md` |
| `sentry issue events` / `sentry event list` | Yes | **Missing** (only `event view` noted) | Partially in `issue.md` |
| `sentry release deploys` | Yes | **Missing** | Not in `release.md` fragment |
| `sentry dashboard widget` (add, edit, delete) | Yes | Mentioned as "create dashboards with widgets" | Yes (`dashboard.md`) |

**Source files:** `src/app.ts` (route map), `README.md` (lines 69–87)

### Recommendation
Add `sentry release`, `sentry repo`, `sentry team`, and `sentry trial` to the README commands table. Add `sentry whoami` as a note. Mention `issue events` / `event list` in the event command description.

---

## B. Undocumented Flags

The following **non-hidden** flags are defined in code but not mentioned in the corresponding hand-written fragment files. (Auto-generated doc pages would include them, but they are not checked into the repo.)

| Command | Flag | Fragment coverage |
|---------|------|-------------------|
| `sentry auth login` | `--timeout` (default 900) | Not mentioned in `auth.md` |
| `sentry auth login` | `--force` | Not mentioned in `auth.md` |
| `sentry auth status` | `--fresh` | Not mentioned in `auth.md` |
| `sentry auth whoami` | `--fresh` | Not mentioned in `auth.md` |
| `sentry issue view` | `--spans` (span tree depth) | Not mentioned in `issue.md` |
| `sentry issue view` | `--fresh` | Not mentioned in `issue.md` |
| `sentry issue explain` | `--fresh` | Not mentioned in `issue.md` |
| `sentry issue plan` | `--fresh` | Not mentioned in `issue.md` |
| `sentry event view` | `--spans` | Not mentioned in `event.md` |
| `sentry event view` | `--fresh` | Not mentioned in `event.md` |
| `sentry trace view` | `--spans` | Not mentioned in `trace.md` |
| `sentry trace view` | `--fresh` | Not mentioned in `trace.md` |
| `sentry trace logs` | `--fresh` | Not mentioned in `trace.md` |
| `sentry log view` | `--fresh` | Not mentioned in `log.md` |
| `sentry span view` | `--spans`, `--fresh` | Not mentioned in `span.md` |
| `sentry dashboard view` | `--fresh`, `--period` | Not mentioned in `dashboard.md` |
| `sentry release list` | `--environment`, `--period`, `--status` | Not mentioned in `release.md` |
| `sentry release create` | `--ref`, `--url` | Not mentioned in `release.md` |
| `sentry release finalize` | `--released`, `--url` | Not mentioned in `release.md` |
| `sentry release deploy` | `--url`, `--started`, `--finished`, `--time` | Not mentioned in `release.md` |
| `sentry release set-commits` | `--clear`, `--commit`, `--initial-depth` | Not mentioned in `release.md` |
| All list commands | `--fresh` (cache bypass) | Rarely mentioned in fragments |
| All list commands | `--cursor` / `-c` | Mentioned in some fragments (repo, team, span, trace) but not all |
| `sentry sourcemap upload` | `--url-prefix` default is `~/` | Default not documented |

**Source files:** `src/commands/*/` (flag definitions), `docs/src/fragments/commands/` (fragments)

### Recommendation
The auto-generated docs cover these, but fragments should mention important flags like `--spans`, `--fresh`, `--timeout`, and release subcommand flags for discoverability. At minimum, add `--fresh` to the global options section in `docs/src/fragments/commands/index.md`.

---

## C. Missing Usage Examples

All 19 fragment files contain bash examples. This section is **clear** — no command fragment lacks examples entirely. However:

- `sentry release deploys` (list deploys) has no example in `release.md`
- `sentry issue events` / `sentry event list` has no standalone example
- `sentry auth refresh` has only a brief mention, no full example showing the output

---

## D. Stale Descriptions

| Location | Doc description | Code `brief` | Drift? |
|----------|----------------|--------------|--------|
| README: `sentry cli` | "Upgrade, setup, fix, and send feedback" | Routes: upgrade, feedback, fix, setup | Minor: matches |
| README: `sentry event` | "View event details" | Route has `view` + `list` | **Yes**: `event list` exists but README only says "view" |
| README: `sentry project` | "List, view, create, and delete projects" | Matches | OK |
| README: `sentry log` | "List and view logs (with streaming)" | Matches | OK |

**Other observations:**
- `DEVELOPMENT.md` lists OAuth scopes as: `project:read`, `project:write`, `project:admin`, `org:read`, `event:read`, `event:write`, `member:read`, `team:read` — **missing `team:write`** which is in the actual code (`src/lib/oauth.ts`).
- `docs/src/content/docs/self-hosted.md` lists token scopes without `team:write`.

**Source files:** `src/lib/oauth.ts` (line 52–63), `DEVELOPMENT.md` (line 61–67), `self-hosted.md` (line 47)

---

## E. Missing Route Mappings in Skill Generator

The current `script/generate-skill.ts` uses **automatic 1:1 mapping** — every visible route gets its own reference file. There is no manual `ROUTE_TO_REFERENCE` map to go stale. This section is **clear**.

---

## F. Installation / Distribution Gaps

### README.md gaps

| Feature | In code | In README | Gap |
|---------|---------|-----------|-----|
| `yarn` as install method | Yes (getting-started.mdx, upgrade.ts) | **Missing** from package manager examples | Yes |
| `npx` / `pnpm dlx` / `bunx` / `yarn dlx` | Yes (getting-started.mdx) | Only `npx` shown | Minor |
| Nightly builds | Yes (install script `--version nightly`) | **Not mentioned** | Yes |
| `SENTRY_VERSION` env var for install | Yes (install script) | **Not mentioned** | Yes |
| `SENTRY_INIT=1` env var | Yes (install script) | **Not mentioned** anywhere in docs | Yes |
| `SENTRY_INSTALL_DIR` | Yes (binary.ts, install script) | **Not mentioned** in README | Documented in configuration.md |
| `--no-modify-path` / `--no-completions` installer flags | Yes (install script) | **Not mentioned** | Yes |
| Node.js >=22 requirement | Yes (`package.json` engines) | **Not mentioned** in README install section | Only in library-usage.md |
| Supported platforms (darwin/linux/windows, arm64/x64) | Yes (install script) | **Not mentioned** | Yes |

### getting-started.mdx gaps

| Feature | In code | In getting-started.mdx | Gap |
|---------|---------|----------------------|-----|
| `SENTRY_INIT=1` env var | Yes (install script) | **Missing** | Yes |
| `--no-modify-path` / `--no-completions` installer flags | Yes (install script) | **Missing** | Yes |
| Supported platforms/architectures | Yes | **Missing** | Yes |
| Windows support notes (x64 only) | Yes (install script) | **Missing** | Yes |

**Source files:** `install` (bash script), `README.md`, `docs/src/content/docs/getting-started.mdx`

---

## G. Undocumented Environment Variables

The following `SENTRY_*` variables are used in `src/` but **absent** from `docs/src/content/docs/configuration.md`:

| Variable | Usage in code | Documented? |
|----------|---------------|-------------|
| `SENTRY_FORCE_ENV_TOKEN` | Forces env token over stored OAuth | **No** |
| `SENTRY_OUTPUT_FORMAT` | Library mode: `"json"` forces JSON output | **No** |
| `SENTRY_MAX_PAGINATION_PAGES` | Caps pagination loops (default 50) | **No** |
| `SENTRY_CLI_NO_AUTO_REPAIR` | Disables DB auto-repair | **No** |
| `SENTRY_INIT` | Install script: runs `sentry init` after install | **No** (not in configuration.md or getting-started.mdx) |

All other `SENTRY_*` variables (`SENTRY_AUTH_TOKEN`, `SENTRY_TOKEN`, `SENTRY_HOST`, `SENTRY_URL`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_DSN`, `SENTRY_CLIENT_ID`, `SENTRY_CONFIG_DIR`, `SENTRY_VERSION`, `SENTRY_PLAIN_OUTPUT`, `SENTRY_CLI_NO_TELEMETRY`, `SENTRY_LOG_LEVEL`, `SENTRY_CLI_NO_UPDATE_CHECK`, `SENTRY_INSTALL_DIR`, `SENTRY_NO_CACHE`, `NO_COLOR`) are documented.

**Source files:** `src/lib/db/auth.ts`, `src/lib/command.ts`, `src/lib/db/pagination.ts`, `src/lib/db/schema.ts`, `install`

---

## H. Auth / Self-Hosted Gaps

### OAuth scopes mismatch

| Source | Scopes listed |
|--------|---------------|
| Code (`src/lib/oauth.ts`) | `project:read`, `project:write`, `project:admin`, `org:read`, `event:read`, `event:write`, `member:read`, `team:read`, **`team:write`** |
| `DEVELOPMENT.md` | Missing `team:write` |
| `self-hosted.md` | Missing `team:write` |

### Token storage description

- `getting-started.mdx` correctly says "SQLite database at `~/.sentry/`"
- `configuration.md` correctly describes `cli.db` with WAL side-files and mode 600
- **Gap:** Neither doc mentions the `.sentryclirc` **legacy file** fallback for token (`[auth] token`), though `configuration.md` documents the `[defaults]` section. The `[auth]` section is documented but the **precedence** between SQLite-stored OAuth token and `.sentryclirc` token is not explicitly spelled out.

### Self-hosted gaps

- `self-hosted.md` says "Sentry 26.1.0+" for OAuth but the version requirement is not independently verified in the install/upgrade code — it's a documentation-only claim, which is fine.
- The page correctly documents `SENTRY_HOST` + `SENTRY_CLIENT_ID`.
- **Gap:** No mention of the `SENTRY_FORCE_ENV_TOKEN` variable which is relevant for self-hosted users who want env tokens to take priority over stored OAuth.

**Source files:** `src/lib/oauth.ts`, `src/lib/db/auth.ts`, `DEVELOPMENT.md`, `self-hosted.md`

---

## I. Plugin/Skills Gaps

### Supported IDEs

| IDE/Agent | In code/plugins | In `agentic-usage.md` | In `plugins/README.md` |
|-----------|----------------|----------------------|----------------------|
| Claude Code | Yes (skill install targets `~/.claude/`) | Mentioned as example | Yes (full install instructions) |
| Cursor | Yes (`.cursor/skills/` symlink in repo) | **Not mentioned** | Yes ("automatically available") |
| Other agents | Yes (generic copy instructions) | **Not mentioned** | Yes (generic instructions) |

### Agentic usage page gaps

- `agentic-usage.md` only mentions "Claude Code" and a generic "AI coding agents" — **Cursor is not mentioned** despite having first-class support via `.cursor/skills/`.
- The skill installation command shown (`npx skills add https://cli.sentry.dev`) may not match the current plugin installation method (`claude plugin install sentry/cli` in `plugins/README.md`). These appear to be two different systems.
- **Gap:** No mention of `sentry cli setup --no-agent-skills` flag to control skill installation.
- **Gap:** No mention that skills are **embedded at build time** (not fetched from network), which is a meaningful detail for offline/air-gapped environments.

### plugins/README.md accuracy

- Generally accurate and well-structured.
- **Gap:** Does not mention that `sentry cli setup` automatically installs skills (only discusses manual plugin installation).

**Source files:** `src/lib/agent-skills.ts`, `src/commands/cli/setup.ts`, `plugins/README.md`, `docs/src/content/docs/agentic-usage.md`

---

## J. README / DEVELOPMENT.md Drift

### DEVELOPMENT.md

| Claim | Code reality | Drift? |
|-------|-------------|--------|
| OAuth scopes missing `team:write` | Code has `team:write` | **Yes** |
| Environment variables table lists only `SENTRY_CLIENT_ID`, `SENTRY_HOST`, `SENTRY_URL` | Many more variables exist | **Yes** — incomplete but not wrong |
| "No client secret is needed" for device flow | Correct | OK |
| "Install dependencies: `bun install`" | Correct | OK |

### README.md

| Claim | Code reality | Drift? |
|-------|-------------|--------|
| "Bun v1.0+" in prerequisites | `packageManager: bun@1.3.11` in package.json | **Minor** — works with v1.0 but repo pins 1.3.11 |
| Commands table missing `release`, `repo`, `team`, `trial`, `whoami` | All exist in code | **Yes** |
| `sentry event` described as only "View event details" | Also has `event list` | **Yes** |
| No mention of Node.js >=22 for npm users | `engines.node: ">=22"` | **Yes** |
| Library usage shows `signal` as `AbortSignal` to cancel streaming | Correct per `sdk-types.ts` | OK |
| No `yarn` in package manager examples | Supported in getting-started.mdx and code | **Minor** |

### contributing.md

| Claim | Code reality | Drift? |
|-------|-------------|--------|
| Project structure lists only `auth/`, `org/`, `project/`, `issue/`, `event/` under commands | Many more directories exist (trace, span, log, dashboard, cli, release, sourcemap, schema, trial, repo, team, init, api, help) | **Yes** — significantly outdated |
| No mention of `bun run typecheck` | Exists in package.json | **Minor** (it's in the Code Style section) |

**Source files:** `README.md`, `DEVELOPMENT.md`, `docs/src/content/docs/contributing.md`, `package.json`

---

## Top 5 Most Impactful Fixes (Prioritized)

### 1. Add missing commands to README.md commands table
**Impact: High** — The README is the first thing users see. Missing `release`, `repo`, `team`, `trial`, and `whoami` makes the CLI appear less capable than it is. Also update `event` description to include `list`.

### 2. Fix OAuth scope lists (`team:write` missing)
**Impact: High** — `DEVELOPMENT.md` and `self-hosted.md` list OAuth scopes that self-hosted admins copy when creating OAuth apps. Missing `team:write` causes permission errors for team management features.

### 3. Document missing environment variables in configuration.md
**Impact: Medium-High** — `SENTRY_FORCE_ENV_TOKEN`, `SENTRY_OUTPUT_FORMAT`, `SENTRY_MAX_PAGINATION_PAGES`, `SENTRY_CLI_NO_AUTO_REPAIR`, and `SENTRY_INIT` are used in code but absent from the configuration reference. `SENTRY_INIT` is especially useful for CI/CD pipelines.

### 4. Update contributing.md project structure
**Impact: Medium** — The project structure in `contributing.md` lists only 5 command directories when 15+ exist. This misleads new contributors about the codebase scope.

### 5. Add Cursor to agentic-usage.md and document installer flags
**Impact: Medium** — Cursor has first-class skill support but isn't mentioned in the agentic usage docs. The install script accepts `--no-modify-path`, `--no-completions`, and `SENTRY_INIT=1` that are useful for CI but undocumented in getting-started.mdx.
