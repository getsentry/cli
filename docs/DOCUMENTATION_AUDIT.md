# Sentry CLI Documentation Audit Report

**Date:** 2026-06-22
**Scope:** Full cross-reference of implementation code vs. documentation

---

## A. Undocumented or Missing Commands/Subcommands

The command doc fragments cover all visible routes. However, several subcommands
lack explicit documentation in their respective fragments:

| Command | Source file | Fragment file | Gap |
|---------|-----------|---------------|-----|
| `sentry dashboard delete` | `src/commands/dashboard/delete.ts` | `docs/src/fragments/commands/dashboard.md` | Subcommand not mentioned in fragment (only widget delete is shown) |
| `sentry dashboard edit` | `src/commands/dashboard/edit.ts` | `docs/src/fragments/commands/dashboard.md` | No examples for editing a dashboard itself (only widget edit is covered) |
| `sentry proguard upload` | `src/commands/proguard/upload.ts` | `docs/src/fragments/commands/proguard.md` | Fragment only covers `proguard uuid`; upload subcommand is entirely missing |
| `sentry sourcemap resolve` | `src/commands/sourcemap/resolve.ts` | `docs/src/fragments/commands/sourcemap.md` | Covered in fragment (good) |
| `sentry release propose-version` | `src/commands/release/propose-version.ts` | `docs/src/fragments/commands/release.md` | Mentioned only in passing example; no dedicated section or flag docs |
| `sentry bash-hook` | `src/commands/bash-hook.ts` | None | Hidden command, intentionally undocumented — no action needed |

## B. Undocumented Flags

Non-hidden flags present in code but not mentioned in the corresponding doc fragment:

| Command | Flag | Default | Fragment file |
|---------|------|---------|---------------|
| `sentry auth login` | `--read-only` | `false` | `auth.md` — not mentioned |
| `sentry auth login` | `--scope` / `-s` | — | `auth.md` — not mentioned |
| `sentry auth login` | `--timeout` | `900` | `auth.md` — not mentioned |
| `sentry auth login` | `--force` | `false` | `auth.md` — not mentioned |
| `sentry auth login` | `--url` | — | `auth.md` — shows `SENTRY_URL` env only, not the `--url` flag |
| `sentry auth status` | `--show-token` | — | `auth.md` — mentioned briefly |
| `sentry auth status` | `--fresh` / `-f` | — | `auth.md` — not mentioned |
| `sentry auth refresh` | `--force` | — | `auth.md` — not mentioned |
| `sentry auth refresh` | `--read-only` | — | `auth.md` — not mentioned |
| `sentry auth refresh` | `--scope` / `-s` | — | `auth.md` — not mentioned |
| `sentry issue list` | `--compact` | — | `issue.md` — not mentioned |
| `sentry issue list` | `--period` / `-t` | `90d` | `issue.md` — not mentioned |
| `sentry explore` | `--environment` / `-e` | — | `explore.md` — not mentioned |
| `sentry trace view` | `--full` | — | `trace.md` — not mentioned |
| `sentry trace view` | `--spans` | `3` | `trace.md` — not mentioned |
| `sentry trace logs` | `--sort` / `-s` | `newest` | `trace.md` — not mentioned |
| `sentry event view` | `--spans` | `3` | `event.md` — not mentioned |
| `sentry event send` | `--no-environ` | — | `event.md` — not mentioned |
| `sentry event send` | `--logfile` | — | `event.md` — not mentioned |
| `sentry event send` | `--with-categories` | — | `event.md` — not mentioned |
| `sentry event send` | `--timestamp` | — | `event.md` — not mentioned |
| `sentry event send` | `--fingerprint` / `-f` | — | `event.md` — partially documented |
| `sentry monitor run` | `--check-in-margin` | — | `monitor.md` — not mentioned |
| `sentry monitor run` | `--failure-issue-threshold` | — | `monitor.md` — not mentioned |
| `sentry monitor run` | `--recovery-threshold` | — | `monitor.md` — not mentioned |
| `sentry sourcemap inject` | `--ignore` | — | `sourcemap.md` — not mentioned |
| `sentry sourcemap inject` | `--ignore-file` | — | `sourcemap.md` — not mentioned |
| `sentry sourcemap inject` | `--allow-empty` | — | `sourcemap.md` — only mentioned for upload |
| `sentry sourcemap upload` | `--ignore` | — | `sourcemap.md` — not mentioned |
| `sentry sourcemap upload` | `--ignore-file` | — | `sourcemap.md` — not mentioned |
| `sentry sourcemap upload` | `--strip-prefix` | — | `sourcemap.md` — not mentioned |
| `sentry sourcemap upload` | `--strip-common-prefix` | — | `sourcemap.md` — not mentioned |
| `sentry sourcemap upload` | `--no-rewrite` | — | `sourcemap.md` — not mentioned |
| `sentry cli setup` | `--install` | — | `cli.md` — not mentioned (internal flag) |
| `sentry cli setup` | `--method` | — | `cli.md` — not mentioned |
| `sentry cli setup` | `--channel` | — | `cli.md` — not mentioned |
| `sentry cli setup` | `--quiet` | — | `cli.md` — not mentioned |
| `sentry cli upgrade` | `--offline` | — | `cli.md` — not mentioned |
| `sentry cli upgrade` | `--method` | — | `cli.md` — not mentioned |
| `sentry cli uninstall` | `--keep-config` | — | `cli.md` — mentioned |
| `sentry release create` | `--ref` | — | `release.md` — not mentioned |
| `sentry release create` | `--url` | — | `release.md` — not mentioned |
| `sentry release finalize` | `--released` | — | `release.md` — not mentioned |
| `sentry release finalize` | `--url` | — | `release.md` — not mentioned |
| `sentry release deploy` | `--url` | — | `release.md` — not mentioned |
| `sentry release deploy` | `--started` | — | `release.md` — not mentioned |
| `sentry release deploy` | `--finished` | — | `release.md` — not mentioned |
| `sentry release deploy` | `--time` / `-t` | — | `release.md` — not mentioned |
| `sentry release set-commits` | `--initial-depth` | `20` | `release.md` — not mentioned |
| `sentry release list` | `--status` | `open` | `release.md` — not mentioned |
| `sentry release list` | `--environment` / `-e` | — | `release.md` — not mentioned |
| `sentry release list` | `--period` / `-t` | `90d` | `release.md` — not mentioned |
| `sentry replay list` | `--environment` / `-e` | — | `replay.md` — not mentioned |
| `sentry local serve` | `--host` / `-H` | `localhost` | `local.md` — not mentioned |
| `sentry local run` | `--host` | — | `local.md` — not mentioned |
| `sentry local run` | `--verify` / `-V` | — | `local.md` — not mentioned |
| `sentry local run` | `--timeout` / `-t` | `0` | `local.md` — not mentioned |

## C. Missing Usage Examples

Command fragments with no bash examples for specific subcommands:

| Command | Fragment | Missing example for |
|---------|----------|-------------------|
| `sentry dashboard delete` | `dashboard.md` | Top-level dashboard deletion (only widget delete shown) |
| `sentry proguard upload` | `proguard.md` | Entire upload subcommand |
| `sentry release finalize` | `release.md` | Standalone finalize with flags like `--released`, `--url` |
| `sentry release archive/restore` | `release.md` | Examples exist (good) |
| `sentry auth whoami` | `auth.md` | Mentioned but no example showing output |
| `sentry log view` | `log.md` | Has example (good) |

## D. Stale Descriptions

| Command | Code `brief` | Doc description | Issue |
|---------|-------------|-----------------|-------|
| `sentry local` (route) | "Sentry for local development" | Fragment says "runs a local development server that captures Sentry SDK envelopes" | Not stale — fragment is more detailed (OK) |
| `sentry debug-files check` | "Inspect a debug information file" | Fragment covers it | OK |
| `sentry debug-files bundle-jvm` | "Create a JVM source bundle for source context" | Fragment covers it | OK |
| `sentry init` | "Initialize Sentry in your project (experimental)" | Fragment matches | OK |

No meaningfully stale `brief` strings were found. The generated docs are built
from the code `brief`/`fullDescription`, so they cannot drift by design. The
hand-written fragments add examples and context but don't redefine the
descriptions.

## E. Missing Route Mappings in Skill Generator

`ROUTE_TO_REFERENCE` was replaced by automatic 1:1 route-to-file mapping in
`groupRoutesByReference()`. Every visible route produces its own
`references/{routeName}.md`. The `help` route is intentionally excluded.

**No gaps found.** All routes in `src/app.ts` are covered by the automatic
mapping.

## F. Installation / Distribution Gaps

| Topic | Code/Reality | Documentation | Gap |
|-------|-------------|---------------|-----|
| `SENTRY_INSTALL_DIR` env var | Supported by install script and `sentry cli setup` | Not in `getting-started.mdx` | **Missing** from getting-started |
| `SENTRY_INIT` env var | Supported by install script (`SENTRY_INIT=1` runs wizard) | Not in `getting-started.mdx` | **Missing** from getting-started |
| `SENTRY_CLI_NO_TELEMETRY` in installer | Install script respects this for error telemetry | Not mentioned in getting-started | Minor (telemetry opt-out) |
| `--no-modify-path` installer flag | Supported | Not in `getting-started.mdx` | **Missing** (only in `cli.md` fragment) |
| `--no-completions` installer flag | Supported | Not in `getting-started.mdx` | **Missing** |
| `--no-agent-skills` installer flag | Supported | Not in `getting-started.mdx` | **Missing** |
| Musl/Alpine auto-detection | Installer auto-detects musl, installs libstdc++ on Alpine | Not documented | **Missing** (important for Docker users) |
| Gzip-compressed downloads | Installer tries `.gz` first (~60% smaller) | Not documented | Minor |
| `yarn` package manager | `yarn global add sentry` in README, `yarn dlx sentry --help` in README | Missing from `getting-started.mdx` `PackageManagerCode` — only npm/pnpm/bun shown | **Inconsistency**: README includes yarn, `getting-started.mdx` includes yarn (actually it does via the component) |
| Windows support | Install script supports MINGW/MSYS/CYGWIN x64 only | Platform table in getting-started says "Via Git Bash, MSYS2, or WSL" | OK |

## G. Undocumented Environment Variables

The env-registry (`src/lib/env-registry.ts`) is the canonical source. The
generated `configuration.md` (gitignored) includes all registered variables.
However, some env vars used in source code are NOT in the registry:

| Variable | Used in | Purpose | In env registry? |
|----------|---------|---------|-----------------|
| `SENTRY_ENVIRONMENT` | `src/lib/bash-hook/traceback.ts` | Bash hook environment tag | **No** |
| `SENTRY_SPOTLIGHT` | `src/commands/local/run.ts`, `server.ts` | Injected for local dev server | **No** (injected, not read) |
| `SENTRY_TRACES_SAMPLE_RATE` | `src/lib/init/verify-setup.ts`, `local/run.ts` | Injected for init verification | **No** (injected, not read) |
| `SENTRY_MONITOR_SLUG` | `src/commands/monitor/run.ts` | Injected for wrapped command | **No** (injected, not read) |
| `SENTRY_SCAN_DISABLE_WORKERS` | `src/lib/scan/grep.ts` | Debug: disable parallel scanning | **No** |
| `SENTRY_RELEASE` | `src/lib/init/verify-setup.ts` | Injected for verification | **Yes** (registered) |

Variables that are injected into child processes (SPOTLIGHT, TRACES_SAMPLE_RATE,
MONITOR_SLUG) are arguably not user-facing config variables. However,
`SENTRY_ENVIRONMENT` and `SENTRY_SCAN_DISABLE_WORKERS` are read from the
user's environment and could be documented.

## H. Auth / Self-Hosted Gaps

| Topic | Code | Documentation | Gap |
|-------|------|---------------|-----|
| `--url` flag on `auth login` | Registers trust anchor; only way to trust new host | `self-hosted.md` documents it well | OK |
| `--read-only` on `auth login` | Requests read-only OAuth scopes | Not in `self-hosted.md` or `auth.md` examples | **Missing** — useful for self-hosted too |
| `--scope` on `auth login` | Custom OAuth scope selection | Not documented anywhere | **Missing** |
| Token storage in SQLite | `~/.sentry/cli.db`, table `auth`, host-scoped | `getting-started.mdx` says "SQLite database at `~/.sentry/`" | OK |
| `SENTRY_FORCE_ENV_TOKEN` | Forces env token over stored OAuth | `self-hosted.md` env table includes it | OK |
| Host scope refusal | CLI refuses login to untrusted hosts from `.sentryclirc` | `self-hosted.md` mentions `--url` as "most secure way" | OK |
| `.sentryclirc` import | `sentry cli import` migrates legacy config | `cli.md` fragment documents it | OK |
| `NODE_EXTRA_CA_CERTS` | For corporate TLS proxies | `self-hosted.md` documents it | OK |
| `sentry cli defaults ca-cert` | Persists CA cert path | `self-hosted.md` documents it | OK |
| `sentry cli defaults headers` | Persists custom headers | `self-hosted.md` documents it | OK |
| Token precedence (default) | Stored OAuth > `SENTRY_AUTH_TOKEN` > `SENTRY_TOKEN` | `auth.md` fragment documents it | OK, but... |
| Token precedence (auth.md vs library-usage.md) | Same | `auth.md` says "stored OAuth first"; `library-usage.md` says `SENTRY_AUTH_TOKEN` > `SENTRY_TOKEN` > stored | **Inconsistency**: `library-usage.md` lists env vars before stored OAuth, which contradicts the actual default priority |

## I. Plugin/Skills Gaps

| Topic | Code | Documentation | Gap |
|-------|------|---------------|-----|
| Install targets | `~/.agents` and `~/.claude` directories | `agentic-usage.md` says "~/.claude, ~/.agents" | OK |
| Cursor support | Via `~/.agents` path; also `.cursor/skills/` in repo | `plugins/README.md` says "automatically available in `.cursor/skills/`" | OK |
| Claude Code plugin marketplace | `claude plugin marketplace add getsentry/cli` | `plugins/README.md` documents it | OK |
| `npx skills add` | Referenced in `agentic-usage.md` | Works if `skills` CLI is installed | OK |
| Build-time embedding | Skills embedded in binary via `src/generated/skill-content.ts` | `agentic-usage.md` says "No network fetch is needed — skill files are embedded in the binary" | OK |
| `--no-agent-skills` | Supported by install script and `sentry cli setup` | `agentic-usage.md` documents it | OK |
| Uninstall cleanup | `sentry cli uninstall` removes skill directories | Not documented in `agentic-usage.md` | **Missing** — users should know uninstall cleans up |
| Cursor plugin.json | No Cursor-specific plugin manifest exists | `plugins/README.md` doesn't claim one exists | OK |

## J. README / DEVELOPMENT.md Drift

| Claim | Source | Reality | Issue |
|-------|--------|---------|-------|
| README uses `bun` commands | README `## Quick Reference: Commands` in AGENTS.md | `package.json` uses `pnpm` as packageManager; README correctly shows `pnpm` | OK |
| README: "Node.js 22.15+" | README dev prereqs | `package.json` `engines.node: ">=22.15"` | OK |
| DEVELOPMENT.md: "pnpm v10.11+" | DEVELOPMENT.md | `package.json` `packageManager: "pnpm@10.11.0"` | OK |
| AGENTS.md says use `bun` | AGENTS.md throughout | README and DEVELOPMENT.md say `pnpm`; `package.json` `packageManager` is pnpm | **Inconsistency**: AGENTS.md tells agents to use `bun` commands but the project uses `pnpm` |
| AGENTS.md: "Bun as runtime" | AGENTS.md | Build uses esbuild+fossilize (Node SEA), tests use vitest, runtime is Node.js >= 22.15 | **Stale**: AGENTS.md references Bun extensively but the project has migrated to pnpm/Node.js/vitest |
| AGENTS.md: `bun test`, `bun run` | AGENTS.md commands table | `package.json` scripts use `pnpm run`, tests use `vitest` not `bun test` | **Stale** |
| AGENTS.md: `Bun.file()`, `Bun.write()` etc. | AGENTS.md Bun API table | If running under pnpm/Node, Bun APIs are not available | **Potentially stale** — needs verification if Bun shims are still used |
| AGENTS.md: `bun:test` | Testing section header | Tests use `vitest` per `package.json` | **Stale** |
| README: `pnpm install` for setup | README | `package.json` `packageManager: "pnpm@10.11.0"` | OK |
| DEVELOPMENT.md: "build uses esbuild and fossilize" | DEVELOPMENT.md | `script/build.ts` uses esbuild + fossilize | OK |
| README license: "FSL-1.1-Apache-2.0" | README | `package.json`: "FSL-1.1-Apache-2.0" | OK |
| `configuration.md` referenced but not committed | `getting-started.mdx`, `self-hosted.md`, `features.md` | File is generated and gitignored | OK — expected behavior |

### AGENTS.md Bun references in detail

AGENTS.md contains extensive Bun-specific guidance that may be stale:

1. **Quick Bun API Reference table** — Lists `Bun.file()`, `Bun.write()`, `Bun.spawn()`, `Bun.$`, `Bun.which()`, `Bun.Glob()`, `Bun.sleep()` as the preferred APIs
2. **Testing section** — Says "bun:test + fast-check" but tests use vitest
3. **Commands** — Shows `bun test`, `bun run dev`, `bun install` but package.json uses pnpm
4. **Exception notes** — Mentions `Bun.$` shell limitations and node polyfill shims

---

## Top 5 Most Impactful Fixes (Prioritized)

### 1. AGENTS.md: Bun → pnpm/Node.js/vitest migration
**Impact:** High — AI agents following AGENTS.md will use wrong commands (`bun test` instead of `pnpm run test:unit`, `bun install` instead of `pnpm install`)
**Files:** `AGENTS.md`
**Action:** Update all command examples and API references to match the current pnpm/Node.js/vitest toolchain

### 2. `library-usage.md` token precedence inconsistency
**Impact:** Medium-High — Misleads library users about which token takes priority
**Files:** `docs/src/content/docs/library-usage.md`
**Action:** Fix the authentication priority list to match code: stored OAuth > `SENTRY_AUTH_TOKEN` > `SENTRY_TOKEN` (currently lists env vars first)

### 3. Undocumented `--read-only` and `--scope` flags on `auth login`
**Impact:** Medium-High — Security-conscious users and self-hosted admins need scoped tokens
**Files:** `docs/src/fragments/commands/auth.md`
**Action:** Add examples for `--read-only` (read-only agent tokens) and `--scope` (custom scope selection)

### 4. Missing `proguard upload` documentation
**Impact:** Medium — Android developers using ProGuard/R8 cannot find upload docs
**Files:** `docs/src/fragments/commands/proguard.md`
**Action:** Add upload subcommand examples with `--uuid`, `--no-upload`, `--require-one` flags

### 5. Missing install script flags in getting-started
**Impact:** Medium — Docker/CI users need `--no-modify-path`, `--no-completions`, `--no-agent-skills` for clean installs
**Files:** `docs/src/content/docs/getting-started.mdx`
**Action:** Add a section documenting installer flags and the `SENTRY_INSTALL_DIR`/`SENTRY_INIT` env vars
