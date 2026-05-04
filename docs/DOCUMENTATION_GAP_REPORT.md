# Documentation Gap Report

Audit of the Sentry CLI repository comparing implementation against documentation.
Generated: 2026-05-04.

---

## A. Undocumented or Missing Commands/Subcommands

All commands registered in `src/app.ts` have corresponding documentation fragments in `docs/src/fragments/commands/`. No fully undocumented command groups were found.

However, the following subcommands exist in code but have **thin or missing examples** in their fragments:

| Command | Source | Fragment Coverage |
|---------|--------|-------------------|
| `sentry cli defaults` | `src/commands/cli/defaults.ts` | Fragment (`cli.md`) only shows `sentry cli setup` and `sentry cli upgrade`; `defaults` subcommands (org, project, url, telemetry, headers, ca-cert, clear) are referenced in `configuration.md` fragment but NOT in `cli.md` |
| `sentry cli fix` | `src/commands/cli/fix.ts` | One-liner in `cli.md`; no example output or flags documented |
| `sentry dashboard widget` (nested route) | `src/commands/dashboard/widget/index.ts` | Covered well in `dashboard.md` |
| `sentry issue events` | `src/commands/issue/events.ts` | Mentioned only in `issue.md` full description but no dedicated examples section |
| `sentry release propose-version` | `src/commands/release/propose-version.ts` | Only shown inline in `release.md` as `$(sentry release propose-version)` |
| `sentry release deploys` | `src/commands/release/deploys.ts` | Brief mention in fragment |

---

## B. Undocumented Flags

The following non-hidden flags in command implementations are NOT mentioned in their corresponding doc fragments:

| Command | Flag | Source File |
|---------|------|-------------|
| `sentry issue list` | `--sort` (values: `date`, `priority`, `freq`, `user`, `trend`) | `src/commands/issue/list.ts` |
| `sentry issue list` | `--period` / `-t` | `src/commands/issue/list.ts` |
| `sentry issue explain` | `--force` (force fresh analysis) | `src/commands/issue/explain.ts` — mentioned in fragment |
| `sentry issue plan` | `--cause` (select root cause index) | `src/commands/issue/plan.ts` — mentioned in fragment |
| `sentry trace list` | `--period` / `-t` | `src/commands/trace/list.ts` — mentioned in agent-guidance.md but NOT in `trace.md` |
| `sentry span list` | `--period` / `-t` | `src/commands/span/list.ts` — mentioned in agent-guidance.md |
| `sentry log list` | `--follow` / `-f` (streaming mode) | `src/commands/log/list.ts` — covered in fragment |
| `sentry log list` | `--period` / `-t` | `src/commands/log/list.ts` |
| `sentry event list` | `--full` (include full event bodies) | `src/commands/event/list.ts` — covered |
| `sentry event list` | `--period` / `-t` | `src/commands/event/list.ts` |
| `sentry explore` | `--dataset` | `src/commands/explore.ts` — covered |
| `sentry explore` | `--where` | `src/commands/explore.ts` — NOT in fragment |
| `sentry replay list` | `--sort` (values: `started_at`, `duration`, `errors`, etc.) | `src/commands/replay/list.ts` — NOT in fragment |
| `sentry replay list` | `--period` / `-t` | `src/commands/replay/list.ts` — NOT in fragment |
| `sentry sourcemap inject` | `--ext` (file extensions) | `src/commands/sourcemap/inject.ts` — covered |
| `sentry sourcemap upload` | `--allow-empty` | `src/commands/sourcemap/upload.ts` — covered |
| `sentry sourcemap upload` | `--url-prefix` | `src/commands/sourcemap/upload.ts` — covered |
| `sentry sourcemap upload` | `--release` | `src/commands/sourcemap/upload.ts` — covered |
| `sentry cli upgrade` | `--offline` | `src/commands/cli/upgrade.ts` — NOT in fragment |
| `sentry cli setup` | `--no-modify-path` | `src/commands/cli/setup.ts` — covered |
| `sentry cli setup` | `--no-completions` | `src/commands/cli/setup.ts` — covered |
| `sentry auth login` | `--url` | `src/commands/auth/login.ts` — NOT in auth.md fragment (only shown via env var) |
| `sentry dashboard view` | `--refresh` (auto-refresh interval) | — covered in fragment |
| `sentry dashboard list` | name filter positional | — covered |
| `sentry release create` | `--finalize` | `src/commands/release/create.ts` — covered |
| `sentry release set-commits` | `--auto` / `--local` | — covered |
| `sentry init` | `--features` | `src/commands/init.ts` — covered |

**Key gaps:**

1. **`sentry auth login --url`** — The `--url` flag for self-hosted is critical but only described via environment variables in `auth.md`. The flag-based approach should be documented explicitly.
2. **`sentry cli upgrade --offline`** — Offline upgrade mode not in cli.md fragment.
3. **`sentry replay list --sort` and `--period`** — Missing from replay.md fragment.
4. **`sentry explore --where`** — Filter flag not in explore.md fragment.

---

## C. Missing Usage Examples

Commands with NO bash examples in their doc fragments:

| Command | Fragment |
|---------|----------|
| `sentry cli fix` | `cli.md` — one-liner, no example output |
| `sentry cli defaults` | Referenced in `configuration.md` not in `cli.md` |
| `sentry issue events` | `issue.md` — no dedicated examples for this subcommand |

All other commands have at least one bash example in their fragments.

---

## D. Stale Descriptions

No significant divergence was found between code `brief` strings and documentation descriptions. The generate-command-docs system ensures briefs are synchronized.

Minor observation:
- `explore` command brief in code is `"Query aggregate event data (Explore)"` but the fragment title/examples don't mention "Explore" by name in the heading context — users may not discover it exists without reading the full command list.

---

## E. Missing Route Mappings in Skill Generator

The `script/generate-skill.ts` uses `groupRoutesByReference()` which creates a 1:1 route-to-reference-file mapping by iterating all visible routes. This is **dynamic** — no manual `ROUTE_TO_REFERENCE` map exists (it was removed in favor of the auto-mapping). Therefore, **no routes are missing from the skill generator**.

All visible routes in `src/app.ts` produce reference files automatically.

---

## F. Installation / Distribution Gaps

### Documented but partially covered:

| Item | Code | Docs | Gap |
|------|------|------|-----|
| **`yarn` support** | Listed in `setup.ts` as valid `--method` value | `getting-started.mdx` lists `yarn global add sentry` and `yarn dlx sentry` | **README.md** omits yarn — only lists npm, pnpm, bun |
| **`SENTRY_VERSION` env var for install script** | `install` script checks `$SENTRY_VERSION` | `getting-started.mdx` documents it | README.md does NOT mention it |
| **`SENTRY_INIT` env var** | `install` script runs `sentry init` when set | `env-registry.ts` documents it | Not in getting-started.mdx or README |
| **`SENTRY_INSTALL_DIR` env var** | Used by `upgrade.ts` for binary location | `env-registry.ts` documents it | Not in getting-started.mdx |
| **Windows support details** | `install` script handles Windows via Git Bash/MSYS2/WSL; `.craft.yml` produces Windows x64 binary | Platform table in `getting-started.mdx` says "Via Git Bash, MSYS2, or WSL" | Accurate |
| **`--version nightly` vs `SENTRY_VERSION=nightly`** | Both supported | Documented in getting-started.mdx | Accurate |
| **Node.js >= 22.12 requirement** | `package.json` `engines.node: ">=22.12"` | Not mentioned in `getting-started.mdx` or README for npm installs | **Gap**: Users installing via npm need to know this |
| **Nightly channel only via curl** | Upgrade code migrates package-manager installs to standalone for nightly | cli.md fragment documents this | Accurate |

### Key gaps:

1. **README.md omits `yarn`** as an installation method (present in getting-started.mdx but not README).
2. **Node.js version requirement** (`>=22.12`) is not mentioned in installation docs for npm/pnpm/bun users.
3. **`SENTRY_INIT=1`** env var for the install script is undocumented in user-facing docs.

---

## G. Undocumented Environment Variables

The `src/lib/env-registry.ts` serves as the canonical registry. Comparing it with what appears in the doc fragments:

| Variable | In env-registry.ts | In configuration.md fragment | In self-hosted.md | In DEVELOPMENT.md |
|----------|-------------------|------------------------------|-------------------|--------------------|
| `SENTRY_AUTH_TOKEN` | Yes | Yes (via generator) | No | Yes |
| `SENTRY_TOKEN` | Yes | Yes | No | No |
| `SENTRY_FORCE_ENV_TOKEN` | Yes | Yes | Yes | Yes |
| `SENTRY_ORG` | Yes | Yes | Yes | No |
| `SENTRY_PROJECT` | Yes | Yes | Yes | No |
| `SENTRY_DSN` | Yes | Yes | No | No |
| `SENTRY_RELEASE` | Yes | Yes | No | No |
| `SENTRY_HOST` | Yes | Yes | Yes | Yes |
| `SENTRY_URL` | Yes | Yes | Yes | Yes |
| `SENTRY_CLIENT_ID` | Yes | Yes | Yes | Yes |
| `SENTRY_CUSTOM_HEADERS` | Yes | Yes | Yes | No |
| `SENTRY_CONFIG_DIR` | Yes | Yes | No | Yes |
| `SENTRY_INSTALL_DIR` | Yes (installOnly) | Yes | No | No |
| `SENTRY_VERSION` | Yes (installOnly) | Yes | No | No |
| `SENTRY_INIT` | Yes (installOnly) | Yes | No | No |
| `NODE_EXTRA_CA_CERTS` | Yes | Yes | Yes | No |
| `SENTRY_PLAIN_OUTPUT` | Yes | Yes | No | No |
| `NO_COLOR` | Yes | Yes | No | No |
| `FORCE_COLOR` | Yes | Yes | No | No |
| `SENTRY_OUTPUT_FORMAT` | Yes | Yes | No | No |
| `SENTRY_LOG_LEVEL` | Yes | Yes | No | Yes |
| `SENTRY_CLI_NO_TELEMETRY` | Yes | Yes | No | Yes |
| `SENTRY_CLI_NO_UPDATE_CHECK` | Yes | Yes | No | No |
| `SENTRY_NO_CACHE` | Yes | Yes | No | No |
| `SENTRY_MAX_PAGINATION_PAGES` | Yes | Yes | No | No |
| `SENTRY_CLI_NO_AUTO_REPAIR` | Yes | Yes | No | No |

The configuration page is **generated** from `env-registry.ts`, so there are **no undocumented env vars** in the generated configuration page. The env-registry.ts is the source of truth and the generator ensures completeness.

However, the **`features.md`** page references `SENTRY_DSN` without explaining it's also auto-detected from `.env` files (this is covered in the full description in the registry, so it's a minor context gap in that specific doc page).

---

## H. Auth / Self-Hosted Gaps

| Area | Code | Documentation | Gap |
|------|------|---------------|-----|
| **`--url` flag on `auth login`** | Critical for self-hosted; documented in code as the ONLY trusted way to log in to new hosts | `self-hosted.md` only shows env-var approach (`SENTRY_HOST=... sentry auth login`) | **Gap**: `--url` flag is more secure (registers trust anchor) but undocumented in self-hosted page |
| **OAuth scopes** | `project:read`, `project:write`, `project:admin`, `org:read`, `event:read`, `event:write`, `member:read`, `team:read`, `team:write` | Generated into self-hosted.md and DEVELOPMENT.md | Accurate |
| **Token storage path** | SQLite at `~/.sentry/cli.db` | Mentioned in auth.md fragment ("SQLite database at `~/.sentry/cli.db`") | Accurate |
| **Sentry 26.1.0+ requirement** | Implied by device flow support | self-hosted.md states "Sentry 26.1.0 or later" | Accurate |
| **Host-scoping security model** | Tokens are scoped to the host they were issued against; trust anchors prevent credential leaks to untrusted hosts | Not documented for end users | Minor (implementation detail) |
| **`sentry cli defaults url`** | Can persist self-hosted URL | Only in configuration.md fragment | `self-hosted.md` could mention this |
| **Custom CA certificates** | `NODE_EXTRA_CA_CERTS` + `sentry cli defaults ca-cert` | self-hosted.md lists `NODE_EXTRA_CA_CERTS` | `sentry cli defaults ca-cert` NOT mentioned in self-hosted.md |

---

## I. Plugin/Skills Gaps

| Area | Code | Documentation | Gap |
|------|------|---------------|-----|
| **Supported agent roots** | `~/.agents` and `~/.claude` (in `agent-skills.ts`) | `agentic-usage.md` mentions "Claude Code" and "any agent that reads from `~/.agents` such as Cursor" | Accurate |
| **Auto-install triggers** | Runs during `sentry cli setup` (which runs post-install and post-upgrade) | `agentic-usage.md` says "automatically installs agent skills... on install, setup, and upgrade" | Accurate |
| **`--no-agent-skills` flag** | On `sentry cli setup` | Documented in both `agentic-usage.md` and `cli.md` fragment | Accurate |
| **Network-free installation** | Skills are embedded at build time via `src/generated/skill-content.ts` | `agentic-usage.md` says "No network fetch is needed — skill files are embedded in the binary" | Accurate |
| **Manual install (`npx skills add`)** | Exists as alternative | Documented in `agentic-usage.md` | Accurate |
| **Claude plugin marketplace** | `plugins/README.md` shows `claude plugin marketplace add getsentry/cli` then `claude plugin install sentry/cli` | NOT mentioned in `agentic-usage.md` or README | **Gap**: Plugin marketplace installation path undocumented in main docs |
| **Cursor `.cursor/skills/` path** | `.cursor/skills/sentry-cli/SKILL.md` exists as symlink in repo | `plugins/README.md` mentions it; NOT in `agentic-usage.md` | **Gap**: Cursor-specific path undocumented in main docs |
| **Plugin version** | `plugin.json` shows version `0.32.0` | No user-facing version documentation | Minor |
| **Skill content auto-commit** | CI auto-commits when stale | Only in `AGENTS.md` and `plugins/README.md` | Not user-facing |

---

## J. README / DEVELOPMENT.md Drift

| Claim | File | Actual Code | Status |
|-------|------|-------------|--------|
| "Bun v1.3+" prerequisite | README.md | `package.json` has `packageManager: "bun@1.3.13"` | **Accurate** |
| `bun run build` builds for current platform | README.md | Correct per package.json scripts | Accurate |
| `bun run test:unit` runs unit tests | README.md | Correct | Accurate |
| `bun run generate:docs` regenerates docs and skills | README.md | Correct | Accurate |
| `git clone https://github.com/getsentry/cli.git` | README.md | Assumes repo name is `cli` | Accurate (per repo) |
| OAuth scopes in DEVELOPMENT.md | DEVELOPMENT.md (generated) | Matches `oauth.ts` OAUTH_SCOPES | Accurate |
| Node.js version not mentioned for npm users | README.md | `engines.node: ">=22.12"` in package.json | **Gap** (npm users need to know) |
| Library usage shows `Node.js (≥22.12) or Bun` | README.md | Matches code | Accurate |
| `bun run build:all` builds all platforms | README.md & AGENTS.md | Present in package.json scripts | Accurate |
| Architecture diagram in AGENTS.md lists `replay/` | AGENTS.md | `src/commands/replay/` exists with `list.ts`, `view.ts` | **Gap**: AGENTS.md architecture section does NOT list `replay/` in the commands tree |
| Architecture diagram lists `explore` | AGENTS.md | `src/commands/explore.ts` exists at top level | **Gap**: AGENTS.md does NOT list `explore.ts` in the commands tree |

---

## Top 5 Most Impactful Fixes (Prioritized)

### 1. Add `--url` flag documentation to self-hosted guide
**Impact: High (security + usability)**
The `--url` flag on `auth login` is the secure, recommended way to authenticate with self-hosted instances (registers a trust anchor that prevents phishing). Currently `self-hosted.md` only shows the env-var approach. Adding `sentry auth login --url https://sentry.example.com` as the primary recommended method would improve both security posture and discoverability.

**Files**: `docs/src/content/docs/self-hosted.md`, `docs/src/fragments/commands/auth.md`

### 2. Document Node.js >= 22.12 requirement for npm installs
**Impact: High (user confusion)**
Users installing via npm/pnpm/bun/yarn will get cryptic errors on Node < 22 due to the `node:sqlite` polyfill. This should be prominently noted in `getting-started.mdx` and `README.md` next to the package manager installation commands.

**Files**: `docs/src/content/docs/getting-started.mdx`, `README.md`

### 3. Add `yarn` to README.md installation methods
**Impact: Medium (completeness)**
The README lists npm, pnpm, and bun but omits yarn, which is supported (documented in getting-started.mdx and recognized by the CLI's install detection).

**Files**: `README.md`

### 4. Update AGENTS.md architecture tree to include `replay/` and `explore.ts`
**Impact: Medium (developer onboarding)**
The architecture diagram in AGENTS.md (which is also embedded in the workspace rules) is missing `replay/` from the commands directory and `explore.ts` from the top-level commands. This causes confusion for contributors and AI agents.

**Files**: `AGENTS.md`

### 5. Document Claude plugin marketplace install path in agentic-usage.md
**Impact: Medium (agent ecosystem)**
The Claude Code plugin marketplace installation (`claude plugin marketplace add getsentry/cli`) is only documented in `plugins/README.md`. Users of Claude Code who don't browse the plugins directory won't discover this path. Adding it to `agentic-usage.md` would improve discoverability.

**Files**: `docs/src/content/docs/agentic-usage.md`

---

## Additional Notable Gaps (Lower Priority)

6. **`sentry cli defaults ca-cert`** should be mentioned in `self-hosted.md` alongside `NODE_EXTRA_CA_CERTS`
7. **`sentry cli upgrade --offline`** flag not documented in cli.md fragment
8. **`sentry replay list --sort` and `--period`** flags missing from replay.md fragment
9. **`sentry explore --where`** filter flag missing from explore.md fragment
10. **`SENTRY_INIT=1`** install-script env var not in user-facing getting-started docs
