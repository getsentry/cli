# Documentation Gap Report

Audit date: 2026-05-11
Auditor: Automated analysis of code vs documentation

This report identifies gaps between the Sentry CLI implementation and its documentation across all surfaces: the doc site (`docs/src/content/docs/`), `README.md`, `DEVELOPMENT.md`, `AGENTS.md`, and generated command/configuration pages.

---

## A. Undocumented or Missing Commands/Subcommands

Command docs are auto-generated from code via `generate-command-docs.ts`, so all commands that exist in `src/commands/` get a generated page under `docs/src/content/docs/commands/`. However, **AGENTS.md** has a manually maintained architecture tree that is stale:

| Missing from AGENTS.md | Source |
|-------------------------|--------|
| `replay/` (list, view) | `src/commands/replay/` |
| `explore.ts` | `src/commands/explore.ts` |
| `dashboard/revisions.ts` | `src/commands/dashboard/revisions.ts` |
| `dashboard/restore.ts` | `src/commands/dashboard/restore.ts` |
| `issue/archive.ts` | `src/commands/issue/archive.ts` |

**AGENTS.md lists `issue/` subcommands as:** `list, view, events, explain, plan, resolve, unresolve, merge`
**Actual subcommands:** also includes `archive` (with alias `ignore`).

**AGENTS.md lists `dashboard/` subcommands as:** `list, view, create, widget (add, edit, delete)`
**Actual subcommands:** also includes `revisions` and `restore`.

The generated `contributing.md` tree is correct (it uses `generate-docs-sections.ts`), proving AGENTS.md's tree drifted manually.

---

## B. Undocumented Flags

Since command docs are auto-generated from the Stricli route tree, all non-hidden flags are automatically documented in the generated pages. The system works correctly here. No flags are missing from the generated docs.

However, some **fragment files** (hand-written examples) don't mention newer flags:

| Command | Flag | Fragment Status |
|---------|------|-----------------|
| `sentry dashboard view` | `--refresh <interval>` | Not shown in `dashboard.md` fragment examples |
| `sentry dashboard revisions` | (all flags) | No examples in fragment (revisions/restore are new) |
| `sentry dashboard restore` | `--revision` | No examples in fragment |
| `sentry issue archive` | `--until <spec>` | Extensively documented in `issue.md` fragment — good |
| `sentry log list` | `--follow` with poll interval | Covered in `log.md` fragment — good |
| `sentry cli defaults` | `headers`, `ca-cert` sub-keys | Not documented in `cli.md` fragment |

---

## C. Missing Usage Examples

All 21 command fragment files contain bash examples. No fragment is empty. Coverage is good.

---

## D. Stale Descriptions

Command brief strings and descriptions are auto-generated from code, so no drift exists on the generated pages. The fragment content (hand-written) is additive and doesn't duplicate briefs.

---

## E. Missing Route Mappings in Skill Generator

The old `ROUTE_TO_REFERENCE` constant has been removed. The skill generator now automatically creates one reference file per visible top-level route (excluding `help`). There are no missing mappings — this is fully automated.

---

## F. Installation / Distribution Gaps

### README.md gaps

| Gap | Details |
|-----|---------|
| **Missing `yarn` install method** | `getting-started.mdx` lists `yarn global add sentry` and `yarn dlx sentry --help`, but `README.md` only shows npm, pnpm, bun. |
| **Missing `pnpm dlx` / `bunx` run-without-installing** | `getting-started.mdx` documents `pnpm dlx sentry`, `yarn dlx sentry`, and `bunx sentry`. README only shows `npx sentry@latest`. |
| **Missing nightly channel** | `getting-started.mdx` documents `--version nightly` and `SENTRY_VERSION=nightly`. README doesn't mention nightly at all. |
| **Missing `SENTRY_VERSION` env var for CI pinning** | `getting-started.mdx` shows `SENTRY_VERSION=0.19.0 curl ...`. README doesn't mention this. |
| **Missing `SENTRY_INIT` env var** | The install script accepts `SENTRY_INIT=1` to run the init wizard post-install. Not documented in README or getting-started. |

### getting-started.mdx gaps

| Gap | Details |
|-----|---------|
| **No mention of `SENTRY_INSTALL_DIR`** | The install script reads `SENTRY_INSTALL_DIR` to override the binary location. Not documented in getting-started. Only in the env-registry (which feeds configuration.md). |
| **Installer flags incomplete** | The install script accepts `--no-modify-path`, `--no-completions`, `--no-agent-skills` — none of these are documented in getting-started. They're useful for CI/Docker. |

---

## G. Undocumented Environment Variables

The `ENV_VAR_REGISTRY` in `src/lib/env-registry.ts` is the source of truth for the generated `configuration.md` page. Comparing against all `SENTRY_*` env vars used in code:

| Variable | Used in Code | In ENV_VAR_REGISTRY |
|----------|-------------|---------------------|
| `SENTRY_AUTH_TOKEN` | Yes | Yes |
| `SENTRY_TOKEN` | Yes | Yes |
| `SENTRY_FORCE_ENV_TOKEN` | Yes | Yes |
| `SENTRY_ORG` | Yes | Yes |
| `SENTRY_PROJECT` | Yes | Yes |
| `SENTRY_DSN` | Yes | Yes |
| `SENTRY_RELEASE` | Yes | Yes |
| `SENTRY_HOST` | Yes | Yes |
| `SENTRY_URL` | Yes | Yes |
| `SENTRY_CLIENT_ID` | Yes | Yes |
| `SENTRY_CUSTOM_HEADERS` | Yes | Yes |
| `SENTRY_CONFIG_DIR` | Yes | Yes |
| `SENTRY_INSTALL_DIR` | Yes | Yes (installOnly) |
| `SENTRY_VERSION` | Yes (install script) | Yes (installOnly) |
| `SENTRY_INIT` | Yes (install script) | Yes (installOnly) |
| `SENTRY_PLAIN_OUTPUT` | Yes | Yes |
| `SENTRY_OUTPUT_FORMAT` | Yes | Yes |
| `SENTRY_LOG_LEVEL` | Yes | Yes |
| `SENTRY_CLI_NO_TELEMETRY` | Yes | Yes |
| `SENTRY_CLI_NO_UPDATE_CHECK` | Yes | Yes |
| `SENTRY_NO_CACHE` | Yes | Yes |
| `SENTRY_MAX_PAGINATION_PAGES` | Yes | Yes |
| `SENTRY_CLI_NO_AUTO_REPAIR` | Yes | Yes |
| `NO_COLOR` | Yes | Yes |
| `FORCE_COLOR` | Yes | Yes |
| `NODE_EXTRA_CA_CERTS` | Yes | Yes |
| **`SENTRY_INIT_TUI`** | Yes (`init/ui/factory.ts`) | **No** |
| **`SENTRY_SCAN_DISABLE_WORKERS`** | Yes (`scan/grep.ts`) | **No** |
| `NEXT_PUBLIC_SENTRY_DSN` | Yes (DSN detection) | No (internal) |
| `REACT_APP_SENTRY_DSN` | Yes (DSN detection) | No (internal) |
| `VITE_SENTRY_DSN` | Yes (DSN detection) | No (internal) |
| `EXPO_PUBLIC_SENTRY_DSN` | Yes (DSN detection) | No (internal) |
| `NUXT_PUBLIC_SENTRY_DSN` | Yes (DSN detection) | No (internal) |

**Missing from registry (user-facing):**
- `SENTRY_INIT_TUI` — disables the TUI for the init wizard (`=0`). Useful for CI/scripting.
- `SENTRY_SCAN_DISABLE_WORKERS` — disables worker pool in DSN scanning (`=1`). Debugging tool.

The framework-prefixed DSN variables (`NEXT_PUBLIC_SENTRY_DSN`, etc.) are internal detection helpers, not user-configurable, so omitting them is appropriate.

---

## H. Auth / Self-Hosted Gaps

The auth and self-hosted docs are well-maintained:

| Area | Status |
|------|--------|
| OAuth device flow | Documented in getting-started.mdx, self-hosted.md, auth.md fragment |
| Token login | Documented |
| OAuth scopes | Auto-generated in DEVELOPMENT.md and self-hosted.md |
| Token precedence | Documented in auth.md fragment |
| Self-hosted requirements | Documented (SENTRY_HOST, SENTRY_CLIENT_ID, version 26.1.0+) |
| Token storage (SQLite) | Documented in auth.md fragment and configuration.md fragment |
| `SENTRY_CUSTOM_HEADERS` | Documented in self-hosted.md env var table |
| `NODE_EXTRA_CA_CERTS` | Documented in self-hosted.md env var table |
| `.sentryclirc` support | Documented in configuration.md fragment |

**Minor gaps:**
- `auth login --url` flag for trusting self-hosted URLs is not explicitly documented. The self-hosted guide uses `SENTRY_HOST` env var instead, which works but `--url` is more explicit.
- The `auth login --timeout` flag (OAuth device flow timeout, default 900s) is auto-documented in the generated page but not mentioned in any fragment example.

---

## I. Plugin/Skills Gaps

| Area | Documentation | Status |
|------|--------------|--------|
| Automatic installation | `agentic-usage.md` | Correct: mentions setup, upgrade, `--no-agent-skills` |
| Manual installation | `agentic-usage.md` | Correct: `npx skills add https://cli.sentry.dev` |
| Claude Code support | `agentic-usage.md`, `plugins/README.md` | Correct |
| Cursor support | `agentic-usage.md` | Mentioned as example of `~/.agents` consumer |
| `~/.agents` directory | `agentic-usage.md` | Correct |
| Plugin manifest | `plugins/README.md` | Correct |
| Version in plugin.json | `plugins/sentry-cli/.claude-plugin/plugin.json` | Shows `0.34.0` — should match package.json's version |

**Minor gaps:**
- `agentic-usage.md` doesn't mention that skill installation requires the agent root directories (`~/.agents` or `~/.claude`) to already exist — the installer does NOT create them.
- `plugins/README.md` mentions `.cursor/skills/` as a path, but the workspace `.cursor/` directory doesn't have a `skills/` subtree. This may confuse contributors.

---

## J. README / DEVELOPMENT.md Drift

| Claim | File | Actual Code | Status |
|-------|------|-------------|--------|
| Bun v1.3+ prerequisite | README.md | `packageManager: "bun@1.3.13"` | **Correct** (auto-generated) |
| Node.js ≥22.12 | README.md | `engines.node: ">=22.12"` | **Correct** (auto-generated) |
| `bun run cli` dev command | AGENTS.md | `"cli": "bun run src/bin.ts"` in package.json | **Mismatch** — AGENTS.md shows `bun run dev` while README shows `bun run cli`. Both exist but serve different purposes (`dev` runs generate first). |
| Architecture tree | AGENTS.md | Code has `replay/`, `explore.ts`, `dashboard/revisions`, `dashboard/restore`, `issue/archive` | **Stale** — AGENTS.md tree missing these entries |
| `bun run build:all` | AGENTS.md | Exists in package.json | Correct |
| `bun test --filter` | AGENTS.md | Bun supports this | Correct |
| Build scripts in README | README.md | Auto-generated from curated list | Correct |
| License FSL-1.1-Apache-2.0 | README.md | Matches package.json | Correct |

---

## Top 5 Most Impactful Fixes (Prioritized)

### 1. Update AGENTS.md Architecture Tree
**Impact: High** — AI agents and contributors use AGENTS.md as the primary codebase map. The stale tree causes agents to miss `replay/`, `explore.ts`, `dashboard/revisions`, `dashboard/restore`, and `issue/archive` commands.

### 2. Add Missing Environment Variables to Registry
**Impact: Medium** — `SENTRY_INIT_TUI` is useful for CI/Docker users running `sentry init` non-interactively. Adding it to `env-registry.ts` ensures it appears in the generated `configuration.md`.

### 3. Add `yarn` and Missing Run-Without-Installing Methods to README.md
**Impact: Medium** — The README is the most-viewed surface. Missing `yarn` as an install method and missing `pnpm dlx`/`bunx`/`yarn dlx` as run-without-installing options creates a gap for users of those package managers.

### 4. Document Installer Flags in getting-started.mdx
**Impact: Medium** — `--no-modify-path`, `--no-completions`, `--no-agent-skills` are important for CI/Docker setups. Documenting them in the getting-started page helps DevOps users.

### 5. Add `dashboard revisions`/`restore` and `--refresh` Examples to Fragments
**Impact: Low-Medium** — These are newer features without example coverage in the hand-written fragments. Users discovering them rely on `--help` only.
