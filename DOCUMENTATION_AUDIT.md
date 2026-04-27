# Documentation Audit Report

**Date:** 2026-04-27
**Scope:** Full cross-reference of implementation code against documentation
**CLI Version:** 0.30.0-dev.0

---

## A. Undocumented or Missing Commands/Subcommands

Command docs under `docs/src/content/docs/commands/` are auto-generated from the Stricli route tree via `bun run generate:command-docs`. All top-level routes and their subcommands are covered by the generator. However, hand-written fragments in `docs/src/fragments/commands/` sometimes omit subcommands:

| Missing from fragment | Source file | Fragment file |
|-----------------------|-------------|---------------|
| `release delete` — no bash example | `src/commands/release/delete.ts` | `docs/src/fragments/commands/release.md` |
| `release deploys` — no bash example | `src/commands/release/deploys.ts` | `docs/src/fragments/commands/release.md` |
| `event list` — no bash example (only `event view` has examples) | `src/commands/event/list.ts` | `docs/src/fragments/commands/event.md` |

**Note:** The auto-generated sections include the flag reference for every subcommand, so this gap is limited to the absence of hand-written usage examples and workflow context.

---

## B. Undocumented Flags

Since docs are auto-generated from Stricli command metadata, all non-hidden flags appear in the generated reference section. The gaps below are flags that lack explanation or examples in the hand-written fragments:

| Flag | Command | Notes |
|------|---------|-------|
| `--compact` | `sentry issue list` | Not mentioned in `issue.md` fragment; auto-detects terminal width when omitted |
| `--spans` | `sentry issue view` | Documented in generated section but fragment doesn't explain the depth limit or `"all"`/`"no"` values |
| `--spans` | `sentry trace view` | Same as above — `parseSpanDepth` accepts number, `"all"`, or `"no"` |
| `--full` | `sentry trace view` | Fragment doesn't mention that `--full` auto-enables with `--json` |
| `--offline` | `sentry cli upgrade` | Fragment mentions it exists but doesn't explain the cached-patch mechanism |
| `--cause` | `sentry issue plan` | Fragment doesn't explain when this flag is needed (multiple root causes) |
| `--environment` | `sentry release list` | Not in fragment; variadic/comma-separated filter |
| `--status` | `sentry release list` | Not in fragment; values: `open` (default), `archived` |
| `--refresh` | `sentry dashboard view` | Fragment mentions it but doesn't explain `inferEmpty` behavior (bare `--refresh` defaults to 60s) |
| `--period` | `sentry dashboard view` | Not in dashboard fragment |

---

## C. Missing Usage Examples

Subcommands that have no bash examples anywhere in their fragment file:

| Command | Fragment file | Notes |
|---------|---------------|-------|
| `sentry release delete` | `release.md` | Only mentions create/finalize/deploy/set-commits/propose-version |
| `sentry release deploys` | `release.md` | List deploys for a release — no example |
| `sentry event list` | `event.md` | Fragment only covers `event view`; no `event list` examples |
| `sentry issue events` | `issue.md` | Similar to `event list` but for a specific issue; no dedicated example in issue fragment |
| `sentry auth refresh` | `auth.md` | Has a section header but only a minimal one-liner; no `--force` example |

---

## D. Stale Descriptions

| Location | Doc says | Code says | File |
|----------|----------|-----------|------|
| `features.md` DSN detection priority | "1. Source code, 2. Environment files, 3. Environment variable (`SENTRY_DSN`)" | The resolution priority in `configuration.md` fragment lists 6 levels: explicit args → env vars → `.sentryclirc` → persistent defaults → DSN detection → directory inference. The `features.md` list describes only the DSN sub-priority, not the overall chain, which could confuse readers. | `docs/src/content/docs/features.md` vs `docs/src/fragments/configuration.md` |
| `README.md` Library Usage | Shows `Node.js (≥22)` | `engines.node` is `>=22.12` — the minor version matters because `node:sqlite` was added in 22.5 but stabilized later | `README.md` line 79 vs `package.json` line 60 |
| `contributing.md` Prerequisites | "Bun runtime (v1.0 or later)" | `packageManager` field requires `bun@1.3.13`; the build system uses features not available in 1.0 | `docs/src/content/docs/contributing.md` vs `package.json` line 68 |
| `README.md` Development Prerequisites | "Bun v1.0+" | Same as above — should say Bun 1.3+ or just "Bun (latest)" | `README.md` line 118 |

---

## E. Missing Route Mappings in Skill Generator

The `script/generate-skill.ts` no longer uses a manual `ROUTE_TO_REFERENCE` map. It was replaced by `groupRoutesByReference()` which automatically maps each visible route name to `references/{routeName}.md`. This means **all routes are covered** and this section has **no gaps**.

---

## F. Installation / Distribution Gaps

| Gap | Details | Source | Doc file |
|-----|---------|--------|----------|
| **yarn** not in README | `getting-started.mdx` lists `yarn global add sentry` and `yarn dlx sentry --help`; README omits yarn entirely | `docs/src/content/docs/getting-started.mdx` | `README.md` |
| **Nightly channel** not in README | Install script supports `--version nightly` and `SENTRY_VERSION=nightly`; getting-started.mdx documents it; README only shows basic curl/brew/npm | `install` script, `getting-started.mdx` | `README.md` |
| **`SENTRY_VERSION` env var** not in README | Useful for CI pinning; documented in getting-started.mdx but not README | `install` script | `README.md` |
| **`SENTRY_INSTALL_DIR`** not in getting-started | Install script respects this env var for custom install paths; only in env-registry | `install` script, `src/lib/env-registry.ts` | `docs/src/content/docs/getting-started.mdx` |
| **`SENTRY_INIT=1`** not in docs | Install script supports this to auto-run `sentry init` post-install; not documented anywhere except the script itself | `install` script | None |
| **Windows support** not in docs | Install script handles MINGW/MSYS/CYGWIN on Windows; no docs mention Windows | `install` script | `README.md`, `getting-started.mdx` |
| **musl/Alpine Linux** not in docs | Install script auto-detects musl libc and downloads `-musl` binaries; may install `libstdc++`/`libgcc` on Alpine; undocumented | `install` script | `getting-started.mdx` |
| **`pnpm dlx` / `bunx`** not in README | Getting-started shows these but README only shows `npx` | `getting-started.mdx` | `README.md` |
| **Supported architectures** not explicit | Install script supports x64 and arm64 only; no docs list this | `install` script | `getting-started.mdx` |

---

## G. Undocumented Environment Variables

The `configuration.md` page is auto-generated from `src/lib/env-registry.ts`. Variables in the registry are documented. Gaps are variables referenced in code but **absent from the registry**:

| Variable | Where referenced | Status |
|----------|-----------------|--------|
| `SENTRY_RELEASE` | `src/commands/release/propose-version.ts` — checked first in the version proposal chain | **Not in env-registry**; not in configuration.md |
| `SENTRY_SCAN_DISABLE_WORKERS` | `src/lib/scan/grep.ts` — disables worker threads for scanning | **Not in env-registry** |
| `SENTRY_TEST_*` | `test/preload.ts` — test-only credentials | Test-only; acceptable omission |
| `SENTRY_CLI_BINARY` | `script/eval-skill.ts`, test helpers | Build/test tooling; acceptable omission |
| Various CI env vars in `propose-version.ts` | `GITHUB_SHA`, `CIRCLE_SHA1`, `CODEBUILD_RESOLVED_SOURCE_VERSION`, etc. | These are third-party CI vars, not `SENTRY_*`; documented in `propose-version` fullDescription |

---

## H. Auth / Self-Hosted Gaps

| Gap | Details | Source file | Doc file |
|-----|---------|-------------|----------|
| **`SENTRY_CUSTOM_HEADERS`** missing from self-hosted docs | Env-registry documents it for proxy/IAP auth; self-hosted.md doesn't mention it | `src/lib/env-registry.ts`, `src/lib/oauth.ts` | `docs/src/content/docs/self-hosted.md` |
| **Token precedence** not in self-hosted guide | Stored OAuth > env token by default; `SENTRY_FORCE_ENV_TOKEN` to override; auth fragment covers this but self-hosted.md doesn't cross-reference | `src/lib/db/auth.ts` | `docs/src/content/docs/self-hosted.md` |
| **Self-hosted version requirement** | Self-hosted.md says "Sentry 26.1.0+" for OAuth device flow; not verifiable from code alone, but the claim should be periodically validated | `docs/src/content/docs/self-hosted.md` | — |
| **Multi-region disabled for self-hosted** | Code disables multi-region fan-out when URL is non-SaaS; not documented — users should know only one region is used | `src/lib/region.ts` | `docs/src/content/docs/self-hosted.md` |
| **`.sentryclirc` `[auth] token`** | Works on self-hosted for token-based auth without env vars; not mentioned in self-hosted guide | `src/lib/sentryclirc.ts` | `docs/src/content/docs/self-hosted.md` |

---

## I. Plugin/Skills Gaps

| Gap | Details | Source file | Doc file |
|-----|---------|-------------|----------|
| **Cursor-specific install path** | Code installs to `~/.agents/skills/sentry-cli/` (detected when `~/.agents` exists); agentic-usage.md says "such as Cursor" but doesn't mention the specific directory or that Cursor reads from `~/.agents` | `src/lib/agent-skills.ts` | `docs/src/content/docs/agentic-usage.md` |
| **`~/.claude` detection** | Code detects Claude Code by checking `~/.claude`; creates `~/.claude/skills/sentry-cli/`; doc says "Claude Code" but doesn't mention the directory path | `src/lib/agent-skills.ts` | `docs/src/content/docs/agentic-usage.md` |
| **Upgrade refreshes skills** | agentic-usage.md says "Skills are also refreshed on `sentry cli upgrade`" — matches code (`installAgentSkills` in upgrade flow) but `plugins/README.md` doesn't mention this | `src/commands/cli/upgrade.ts` | `plugins/README.md` |
| **Plugin version** | `plugins/sentry-cli/.claude-plugin/plugin.json` has `version: 0.30.0`; this must be bumped with releases — no automation documented | `.claude-plugin/plugin.json` | `plugins/README.md` |
| **`npx skills add` command** | agentic-usage.md shows `npx skills add https://cli.sentry.dev` for manual install; this is an external tool and may confuse users unfamiliar with it | `docs/src/content/docs/agentic-usage.md` | — |

---

## J. README / DEVELOPMENT.md Drift

| Claim | File | Actual state | Fix |
|-------|------|--------------|-----|
| "Bun v1.0+" | `README.md` line 118 | `packageManager: bun@1.3.13` in package.json | Update to "Bun 1.3+" or "latest Bun" |
| "Node.js (≥22)" for Library Usage | `README.md` line 79 | `engines.node: ">=22.12"` in package.json | Update to "Node.js ≥22.12" |
| No mention of `bun run test:unit` / `bun run test:e2e` | `README.md` line 145 | `test` script maps to `test:unit`; `test:e2e` is separate | Add `bun run test:e2e` to scripts section |
| Missing `generate:docs` from scripts | `README.md` line 140-146 | Key script for doc regeneration | Add to README scripts section |
| DEVELOPMENT.md env var table incomplete | `DEVELOPMENT.md` lines 72-81 | Missing `SENTRY_PLAIN_OUTPUT`, `SENTRY_NO_CACHE`, `SENTRY_MAX_PAGINATION_PAGES`, `SENTRY_CLI_NO_UPDATE_CHECK`, `SENTRY_CLI_NO_AUTO_REPAIR`, `SENTRY_CONFIG_DIR` | Point readers to generated configuration.md for full list |
| DEVELOPMENT.md missing test runner details | `DEVELOPMENT.md` | Tests use `--isolate --parallel`; unit vs e2e distinction; coverage | Add testing section or link to AGENTS.md |
| "Bun runtime (v1.0 or later)" | `contributing.md` line 12 | `packageManager: bun@1.3.13` | Update minimum version |
| Missing `.sentryclirc` config in README | `README.md` | `.sentryclirc` is a supported config format used by legacy `sentry-cli` users | Add brief mention and link to configuration docs |

---

## Top 5 Most Impactful Fixes (Prioritized)

### 1. Add `SENTRY_CUSTOM_HEADERS` to self-hosted documentation
**Impact:** Self-hosted users behind corporate proxies or IAP cannot discover this critical env var without reading source code. This blocks real deployments.
**Files:** `docs/src/content/docs/self-hosted.md`

### 2. Add `SENTRY_RELEASE` to the environment variable registry
**Impact:** `sentry release propose-version` checks `SENTRY_RELEASE` first, but it doesn't appear in the auto-generated configuration page. CI users following the docs may not know they can set this variable to override version detection.
**Files:** `src/lib/env-registry.ts`

### 3. Add missing bash examples for `release delete`, `release deploys`, and `event list` fragments
**Impact:** These are commonly used commands; lack of examples in the hand-written fragments means users only see the dry auto-generated flag reference. Release workflows are especially important for CI/CD integration guides.
**Files:** `docs/src/fragments/commands/release.md`, `docs/src/fragments/commands/event.md`

### 4. Fix Bun/Node version claims across README, DEVELOPMENT.md, and contributing.md
**Impact:** Contributors installing Bun 1.0 will hit build failures. Library users on Node 22.0-22.11 will get confusing errors. Accurate version requirements prevent wasted developer time.
**Files:** `README.md`, `DEVELOPMENT.md`, `docs/src/content/docs/contributing.md`

### 5. Document Windows and musl/Alpine platform support
**Impact:** The install script supports Windows (MINGW/MSYS) and Alpine Linux (musl) but no documentation mentions either. Docker users on Alpine and Windows developers have no guidance.
**Files:** `docs/src/content/docs/getting-started.mdx`, `README.md`
