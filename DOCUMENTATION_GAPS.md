# Documentation Gap Report

Audit date: 2026-05-18
Scope: Full cross-reference of implementation (`src/`) vs documentation (`README.md`, `DEVELOPMENT.md`, `docs/src/`)

---

## A. Undocumented or Missing Commands/Subcommands

The generated command docs (`docs/src/content/docs/commands/`) are gitignored and produced from code metadata + hand-written fragments in `docs/src/fragments/commands/`. Fragments exist for all major command groups. However:

| Command | Source | Fragment Coverage | Gap |
|---------|--------|-------------------|-----|
| `sentry dashboard revisions` | `src/commands/dashboard/revisions.ts` | Not mentioned in `docs/src/fragments/commands/dashboard.md` | Missing examples and description |
| `sentry dashboard restore` | `src/commands/dashboard/restore.ts` | Not mentioned in `docs/src/fragments/commands/dashboard.md` | Missing examples and description |
| `sentry cli defaults` subkeys `headers`, `ca-cert` | `src/commands/cli/defaults.ts` | `docs/src/fragments/commands/cli.md` does not mention `headers` or `ca-cert` keys | Users unaware of proxy/TLS configuration via defaults |
| `sentry issue archive` / `ignore` | `src/commands/issue/archive.ts` | Mentioned in `issue.md` fragment | OK |
| `sentry release propose-version` | `src/commands/release/propose-version.ts` | Mentioned only in subshell example in `release.md` fragment | Missing dedicated section with flag/behavior docs |

**Source:** `src/commands/dashboard/index.ts` defines `revisions` and `restore` routes; `docs/src/fragments/commands/dashboard.md` only covers `list`, `view`, `create`, `widget add/edit/delete`.

---

## B. Undocumented Flags

| Command | Flag | Source | Notes |
|---------|------|--------|-------|
| `sentry auth login` | `--timeout` (default 900s) | `src/commands/auth/login.ts` | Not documented in `auth.md` fragment |
| `sentry auth login` | `--force` | `src/commands/auth/login.ts` | Not documented in `auth.md` fragment |
| `sentry auth login` | `--url` | `src/commands/auth/login.ts` | Not documented in `auth.md` fragment (only shown via env var examples) |
| `sentry issue list` | `--compact` | `src/commands/issue/list.ts` | Not mentioned in `issue.md` fragment |
| `sentry trace view` | `--full` | `src/commands/trace/view.ts` | Not documented in `trace.md` fragment |
| `sentry trace view` | `--spans` | `src/commands/trace/view.ts` | Not documented in `trace.md` fragment |
| `sentry event view` | `--spans` | `src/commands/event/view.ts` | Not documented in `event.md` fragment |
| `sentry issue view` | `--spans` | `src/commands/issue/view.ts` | Not documented in `issue.md` fragment |
| `sentry span view` | `--spans` | `src/commands/span/view.ts` | Not documented in `span.md` fragment |
| `sentry dashboard view` | `--period` | `src/commands/dashboard/view.ts` | Not documented in `dashboard.md` fragment |
| `sentry dashboard view` | `--refresh` | `src/commands/dashboard/view.ts` | Mentioned briefly but flag behavior not documented |
| `sentry sourcemap inject` | `--ignore`, `--ignore-file`, `--allow-empty` | `src/commands/sourcemap/inject.ts` | `--ignore`/`--ignore-file` not in `sourcemap.md` |
| `sentry sourcemap upload` | `--dist`, `--ext`, `--ignore`, `--ignore-file`, `--strip-prefix`, `--strip-common-prefix`, `--no-rewrite` | `src/commands/sourcemap/upload.ts` | Most of these flags not in `sourcemap.md` |
| `sentry release set-commits` | `--initial-depth` (default 520) | `src/commands/release/set-commits.ts` | Not documented in `release.md` fragment |
| `sentry release deploy` | `--started`, `--finished`, `--time`, `--url` | `src/commands/release/deploy.ts` | Not documented in `release.md` fragment |
| `sentry release create` | `--ref`, `--url` | `src/commands/release/create.ts` | Not documented in `release.md` fragment |
| `sentry release finalize` | `--released`, `--url` | `src/commands/release/finalize.ts` | Not documented in `release.md` fragment |
| `sentry cli upgrade` | `--offline` | `src/commands/cli/upgrade.ts` | Not documented in `cli.md` fragment |
| `sentry cli upgrade` | `--method` | `src/commands/cli/upgrade.ts` | Not documented in `cli.md` fragment |
| `sentry init` | `--tui` / `--no-tui` | `src/commands/init.ts` | Not documented in `init.md` fragment |
| `sentry log list` | `--sort` | `src/commands/log/list.ts` | Not documented in `log.md` fragment |
| All `buildListCommand` commands | `--fresh` | `src/lib/list-command.ts` | Not systematically documented in fragments; mentioned in global options only partially |

**Source:** Cross-referenced each command's `parameters.flags` against the corresponding fragment in `docs/src/fragments/commands/`.

---

## C. Missing Usage Examples

| Command / Subcommand | Fragment | Gap |
|---------------------|----------|-----|
| `sentry dashboard revisions` | `dashboard.md` | No section at all |
| `sentry dashboard restore` | `dashboard.md` | No section at all |
| `sentry release propose-version` | `release.md` | Only appears in a subshell (`$(sentry release propose-version)`), no standalone examples |
| `sentry release deploy` (full flags) | `release.md` | Only basic usage shown; `--started`/`--finished`/`--time`/`--url` not exemplified |
| `sentry release finalize` (full flags) | `release.md` | Only `--dry-run` shown; `--released`/`--url` not exemplified |
| `sentry auth login --url` | `auth.md` | No example showing self-hosted login via `--url` flag |
| `sentry auth login --force` | `auth.md` | No example |

---

## D. Stale Descriptions

| Location | Doc Description | Code `brief` | Issue |
|----------|----------------|--------------|-------|
| `docs/src/content/docs/getting-started.mdx` title | "Installation" | N/A | Minor: page `title` says "Installation" but URL slug is `getting-started` — could confuse linking |
| `README.md` Library Usage section | Shows `createSentrySDK` | `src/lib/sdk-invoke.ts` exports this | OK — consistent |
| `agent-guidance.md` "Safety Rules" | Lists `project delete`, `trial start` as destructive | `src/commands/trial/start.ts` has no confirmation guard (no `buildDeleteCommand`) | `trial start` is irreversible but not labeled destructive in code |

No major staleness found in `brief` strings vs docs — the generated doc system keeps them in sync by reading from code metadata.

---

## E. Missing Route Mappings in Skill Generator

Per `script/generate-skill.ts`, the mapping is **automatic 1:1** (`route.name` → `references/<route.name>.md`) for all visible routes except `help`. There is no static `ROUTE_TO_REFERENCE` map to fall out of sync.

However, the following routes are marked `hideRoute: true` in `src/app.ts` and thus excluded from skill generation:

| Route | Purpose | Impact |
|-------|---------|--------|
| `dashboards` | Plural alias → `dashboard list` | Expected; alias only |
| `events` | Plural alias → `event list` | Expected |
| `issues` | Plural alias → `issue list` | Expected |
| `sourcemaps` | Alias → same route as `sourcemap` | Expected |
| `whoami` | Alias → `auth whoami` | Expected |

No actual gaps — hidden routes are aliases, not distinct commands.

---

## F. Installation / Distribution Gaps

| Gap | Source | Doc Location | Issue |
|-----|--------|--------------|-------|
| **`--version nightly` flag** for install script | `install` script (line ~50: `--version`) | `getting-started.mdx` ✓ | Documented |
| **`SENTRY_INSTALL_DIR` env var** | `install` script, `src/lib/binary.ts` | `getting-started.mdx` | **Missing** — not mentioned anywhere in user-facing docs |
| **`SENTRY_INIT=1` env var** for install script | `install` script | `getting-started.mdx` | **Missing** — not documented for users |
| **`--no-modify-path` / `--no-completions` / `--no-agent-skills`** installer flags | `install` script passes to `sentry cli setup` | `getting-started.mdx` | **Missing** — only `--version` documented for the install script |
| **Windows support (Git Bash/MSYS2/WSL)** | `install` script detects `MINGW*`/`MSYS*`/`CYGWIN*` | `getting-started.mdx` platform table ✓ | Documented |
| **musl/Alpine support** | `install` script: `apk add libstdc++ libgcc` | `getting-started.mdx` platform table ✓ | Documented as "glibc and musl (Alpine)" |
| **`yarn global add sentry`** | `docs/src/content/docs/getting-started.mdx` shows yarn | `README.md` | **Missing from README** — README only shows npm/pnpm/bun |
| **`pnpm dlx` / `yarn dlx` / `bunx`** run-without-install | `getting-started.mdx` | `README.md` | **Missing from README** — README only shows `npx` |
| **Node.js ≥22.12 requirement** for npm installs | `package.json` `engines` field | `getting-started.mdx` | **Not mentioned** — users may `npm install -g sentry` on Node 18/20 and get cryptic errors |
| **Offline upgrades (`--offline`)** | `src/commands/cli/upgrade.ts` | `cli.md` fragment | **Missing** |
| **Nightly channel migration behavior** (non-curl installs migrate to standalone binary) | `src/commands/cli/upgrade.ts` | `cli.md` fragment | **Missing** — important for users switching to nightly from npm/brew |

---

## G. Undocumented Environment Variables

The `src/lib/env-registry.ts` defines the canonical list. The following are in the registry but **NOT** in `docs/src/fragments/configuration.md` (the configuration page content):

| Variable | Registry | Config Fragment | Status |
|----------|----------|-----------------|--------|
| `SENTRY_AUTH_TOKEN` | ✓ | Not explicitly listed (only in generated `<!-- GENERATED -->` blocks) | **Gap** — The fragment has no env var reference table |
| `SENTRY_RELEASE` | ✓ (in registry) | ✗ | **Missing** — relevant for CI `release propose-version` |
| `SENTRY_DSN` | ✓ | ✗ (only mentioned conceptually in features.md) | **Missing** from config page |
| `SENTRY_PLAIN_OUTPUT` | ✓ | ✗ | **Missing** |
| `FORCE_COLOR` | ✓ | ✗ | **Missing** |
| `SENTRY_OUTPUT_FORMAT` | ✓ | ✗ | **Missing** |
| `SENTRY_NO_CACHE` | ✓ | ✗ | **Missing** |
| `SENTRY_MAX_PAGINATION_PAGES` | ✓ | ✗ | **Missing** |
| `SENTRY_CLI_NO_UPDATE_CHECK` | ✓ | ✗ | **Missing** |
| `SENTRY_CLI_NO_AUTO_REPAIR` | ✓ | ✗ | **Missing** |
| `SENTRY_VERSION` | ✓ (install-only) | ✗ in config fragment | **Missing** |
| `SENTRY_INIT` | ✓ (install-only) | ✗ | **Missing** |
| `SENTRY_INSTALL_DIR` | ✓ (install-only) | ✗ | **Missing** |
| `SENTRY_SCAN_DISABLE_WORKERS` | Used in `src/lib/scan/grep.ts` | ✗ (not in registry either) | **Internal** — probably OK to omit |

**Note:** The configuration page fragment relies on a `<!-- GENERATED -->` block system for the env var table. The actual generated content (from `env-registry.ts`) likely covers these at build time. The gap is that the **hand-written fragment** has no explicit env var section — it entirely delegates to generation. If generation is working correctly, this section is a non-issue. However, if users read the fragment source (e.g., in the repo), they'd see no env var docs.

---

## H. Auth / Self-Hosted Gaps

| Gap | Source | Doc | Issue |
|-----|--------|-----|-------|
| **`--url` flag on `auth login`** | `src/commands/auth/login.ts` | `self-hosted.md` shows `SENTRY_HOST` env var approach only | **Missing** — `--url` is the canonical flag for self-hosted login but not shown in self-hosted.md examples |
| **Trust anchor behavior** | `login.ts` refuses login to untrusted hosts without `--url` | `self-hosted.md` | **Missing** — users hitting `HostScopeError` won't understand why without docs |
| **Token precedence with `SENTRY_FORCE_ENV_TOKEN`** | `src/lib/db/auth.ts`, `src/lib/sentry-client.ts` | `auth.md` fragment ✓ | Documented |
| **Auto-refresh behavior** | `src/commands/auth/refresh.ts` | `auth.md` fragment mentions it | OK but sparse |
| **`SENTRY_CUSTOM_HEADERS` for IAP/proxy** | `src/lib/custom-headers.ts` | `self-hosted.md` ✓ | Documented in env var table |
| **`NODE_EXTRA_CA_CERTS` for corporate proxies** | `src/lib/env-registry.ts` | `self-hosted.md` ✓ | Documented |
| **`sentry cli defaults ca-cert`** for persistent CA cert config | `src/commands/cli/defaults.ts` | Not in `self-hosted.md` or `cli.md` | **Missing** — self-hosted users behind TLS proxies need this |
| **`sentry cli defaults headers`** for persistent custom headers | `src/commands/cli/defaults.ts` | Not in `self-hosted.md` or `cli.md` | **Missing** |
| **Multi-region disabled for self-hosted** | `src/lib/region.ts` | `self-hosted.md` | **Not mentioned** — helpful for understanding behavior differences |

---

## I. Plugin/Skills Gaps

| Gap | Source | Doc | Issue |
|-----|--------|-----|-------|
| **Cursor support** | `plugins/README.md` mentions `.cursor/skills/` in-repo layout | `agentic-usage.md` says "any agent that reads from `~/.agents` such as Cursor" | **Inconsistency** — Cursor uses in-repo `.cursor/skills/`, not `~/.agents`. The `installAgentSkills` function does NOT write to `.cursor/`. |
| **No `~/.cursor` install path** | `src/lib/agent-skills.ts` only writes to `~/.agents` and `~/.claude` | `agentic-usage.md` says Cursor is supported via `~/.agents` | **Unclear** — Cursor may or may not read `~/.agents`; the in-repo path is what actually works |
| **`npx skills add` command** | `agentic-usage.md` suggests `npx skills add https://cli.sentry.dev` | No code reference to `skills` npm package | **Unverified claim** — cannot confirm this works; appears to reference an external `skills` CLI tool |
| **Plugin marketplace commands for Claude** | `plugins/README.md` mentions `claude plugin marketplace add getsentry/cli` | `agentic-usage.md` does not mention this | **Inconsistency** — two docs describe different install methods |
| **Skill refresh on `sentry cli upgrade`** | `agentic-usage.md` says "Skills are also refreshed on `sentry cli upgrade`" | `src/commands/cli/upgrade.ts` | Need to verify — upgrade may call setup which handles skills |
| **`--no-agent-skills` flag** | `src/commands/cli/setup.ts` | `agentic-usage.md` ✓ | Documented |

---

## J. README / DEVELOPMENT.md Drift

| Claim | Location | Actual (from code) | Issue |
|-------|----------|-------------------|-------|
| **Bun v1.3+** prerequisite | `README.md` (`<!-- GENERATED:START dev-prereq -->`) | `package.json` has no `engines.bun` field; actual min version unknown | **Minor** — version claim is in generated block, likely accurate |
| **`bun run cli --help`** | `README.md` "Running Locally" | `package.json` scripts: `"cli": "bun run --env-file=.env.local src/bin.ts"` | `bun run cli` includes `--env-file` implicitly, so `bun run cli --help` works; the README's suggestion of `bun run --env-file=.env.local cli --help` is redundant with plain `bun run cli --help` | **Minor inconsistency** |
| **`yarn global add sentry`** | `docs/src/content/docs/getting-started.mdx` | Not in README | **Missing from README** |
| **OAuth scopes** | `DEVELOPMENT.md` lists 9 scopes in `<!-- GENERATED -->` block | `src/lib/oauth.ts` has the same 9 scopes | **OK — in sync** |
| **No `SENTRY_CLIENT_SECRET` needed** | `DEVELOPMENT.md` | Correct — device flow is public client | **OK** |
| **`bun run dev`** script | `AGENTS.md` mentions it | `package.json` scripts section | Need to verify script name exists |
| **`packageManager: pnpm@10.11.0`** | `package.json` | Used for lockfile only; bun is runtime | **Not confusing** but could trip up contributors who try `pnpm install` |

---

## Top 5 Most Impactful Fixes (Prioritized)

### 1. Add Node.js ≥22.12 requirement to `getting-started.mdx` and `README.md`
**Impact:** Users installing via npm/pnpm/yarn/bun on older Node versions get cryptic failures. This is the most common footgun for the npm distribution channel.
**Files:** `docs/src/content/docs/getting-started.mdx`, `README.md`

### 2. Document `--url` flag for self-hosted login and trust anchor behavior
**Impact:** Self-hosted users hitting `HostScopeError` have no guidance. The `--url` flag is the primary self-hosted auth mechanism but only env vars are shown in `self-hosted.md`.
**Files:** `docs/src/content/docs/self-hosted.md`, `docs/src/fragments/commands/auth.md`

### 3. Add `dashboard revisions` and `dashboard restore` to docs fragment
**Impact:** Two complete subcommands with no documentation. Users cannot discover dashboard version history/restore without `--help`.
**Files:** `docs/src/fragments/commands/dashboard.md`

### 4. Document undocumented sourcemap flags (`--dist`, `--ignore`, `--ignore-file`, `--strip-prefix`, `--strip-common-prefix`, `--no-rewrite`)
**Impact:** Source map upload is a critical CI workflow. Missing flags force users to guess or read source code. `--dist` in particular is essential for React Native and other multi-distribution setups.
**Files:** `docs/src/fragments/commands/sourcemap.md`

### 5. Document `sentry cli defaults headers` and `sentry cli defaults ca-cert` in self-hosted guide
**Impact:** Self-hosted users behind corporate proxies (IAP, Zscaler, Netskope) need persistent header/CA configuration. These defaults keys exist but are invisible in docs.
**Files:** `docs/src/content/docs/self-hosted.md`, `docs/src/fragments/commands/cli.md`

---

## Additional High-Priority Fixes

6. **Clarify Cursor skill installation** — `agentic-usage.md` implies Cursor reads `~/.agents` but the actual mechanism is in-repo `.cursor/skills/`. Reconcile with `plugins/README.md`.
7. **Document install script flags** (`--no-modify-path`, `--no-completions`, `--no-agent-skills`) in `getting-started.mdx` — useful for CI/Docker.
8. **Add `--spans` flag documentation** across `trace view`, `event view`, `issue view`, and `span view` fragments.
9. **Document `SENTRY_NO_CACHE`, `SENTRY_CLI_NO_UPDATE_CHECK`, and `SENTRY_PLAIN_OUTPUT`** in the configuration page — power-user variables that are only in the code registry.
10. **Document nightly-to-standalone migration** in `cli.md` upgrade section — users switching channels from npm/brew to nightly need to understand the binary swap.
