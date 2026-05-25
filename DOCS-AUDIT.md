# Documentation Audit Report

Audit of the Sentry CLI repository comparing implementation (`src/`) to documentation
(`README.md`, `DEVELOPMENT.md`, `AGENTS.md`, `docs/src/content/docs/`, `docs/src/fragments/`).

Generated: 2026-05-25

---

## A. Undocumented or Missing Commands/Subcommands

Command docs are auto-generated from code metadata plus hand-written fragments in
`docs/src/fragments/commands/`. The fragment-to-route mapping is CI-enforced and currently
1:1 complete. However, several **subcommands within a route** lack coverage in their fragment:

| Command | Source | Fragment (`docs/src/fragments/commands/`) | Gap |
|---------|--------|-------------------------------------------|-----|
| `sentry issue events` | `src/commands/issue/events.ts` | `issue.md` | No example or mention in fragment; only covered indirectly via `event.md` (`sentry event list`) |
| `sentry dashboard revisions` | `src/commands/dashboard/revisions.ts` | `dashboard.md` | Not mentioned in fragment |
| `sentry dashboard restore` | `src/commands/dashboard/restore.ts` | `dashboard.md` | Not mentioned in fragment |
| `sentry cli import` | `src/commands/cli/import.ts` | `cli.md` | No example in fragment |
| `sentry cli defaults` | `src/commands/cli/defaults.ts` | `cli.md` | No example in fragment (documented only in `configuration.md` fragment) |

**Note:** `sentry cli defaults` being in `configuration.md` may be intentional, but the
`cli.md` fragment has zero mention of it, which is confusing since it's under `sentry cli`.

---

## B. Undocumented Flags

These non-hidden flags are defined in code but not demonstrated or mentioned in their
corresponding fragment. The auto-generated reference tables do include them, but the
hand-written examples and prose do not cover them:

| Command | Flag | Fragment |
|---------|------|----------|
| `sentry auth login` | `--url`, `--timeout`, `--force` | `auth.md` — only env-based self-hosted shown |
| `sentry explore` | `--environment` / `-e` | `explore.md` |
| `sentry explore` | `--dataset replays` | `explore.md` |
| `sentry log list` | `--period` / `-t` | `log.md` |
| `sentry log list` | `--sort` / `-s` | `log.md` |
| `sentry local serve` | `--host` / `-H` | `local.md` |
| `sentry local run` | `--host`, `--port` flags | `local.md` — only bare example shown |
| `sentry local serve` | `--filter ai` value | `local.md` — `ai` not listed as filter option |
| `sentry api` | `--silent`, `--raw-field` / `-f` | `api.md` |
| `sentry dashboard widget add` | `--dataset` | `dashboard.md` — rich docs only in code `fullDescription` |
| `sentry issue view` | `--spans` | `issue.md` |
| `sentry issue archive` | `--until` compound syntax | `issue.md` — basic syntax shown, compound mode underdocumented |

---

## C. Missing Usage Examples

These subcommands exist in the CLI but have no bash examples in any fragment:

| Command | Fragment |
|---------|----------|
| `sentry issue events` | `issue.md` |
| `sentry dashboard revisions` | `dashboard.md` |
| `sentry dashboard restore` | `dashboard.md` |
| `sentry cli import` | `cli.md` |
| `sentry cli defaults` (in `cli.md`) | `cli.md` (examples exist in `configuration.md` only) |

---

## D. Stale Descriptions

| Location | Doc says | Code says | Impact |
|----------|----------|-----------|--------|
| `README.md` (GENERATED:START dev-prereq) | "Bun v1.3+" as prerequisite | Build uses `fossilize` (Node SEA), not Bun. `AGENTS.md` says "built with Node.js". `packageManager` is `pnpm@10.11.0`. | **High** — misleads contributors into installing Bun unnecessarily |
| `DEVELOPMENT.md` line 5 | "Bun installed" as prerequisite | Same as above — Bun not needed for dev or build | **High** |
| `DEVELOPMENT.md` line 91 | "Building the native binary still requires Bun" | Build uses `fossilize` + Node SEA, not Bun | **High** |
| `contributing.md` (GENERATED) | "Bun runtime (v1.3 or later)" | Same | **High** |
| `script/generate-docs-sections.ts` | `generateDevPrereq()` hard-codes Bun | Should reference Node.js ≥22.15 or just pnpm | **Root cause** of all Bun prerequisite mentions |
| `AGENTS.md` line 15 | "Native binaries via Node SEA" | Correct ✓ | N/A |
| `library-usage.md` | "Node.js (≥22.15) or Bun" | Library API works via CJS bundle — Bun runtime support is plausible but untested; `engines` only lists Node | Low |

---

## E. Missing Route Mappings in Skill Generator

The `ROUTE_TO_REFERENCE` map no longer exists in `script/generate-skill.ts`. It was
replaced by a 1:1 `groupRoutesByReference()` function that generates a reference file
per visible route. **All visible routes are covered.** Hidden plural aliases and `whoami`
are correctly excluded.

No gaps found in this section.

---

## F. Installation / Distribution Gaps

| Gap | Source | Doc location | Details |
|-----|--------|--------------|---------|
| **Bun prerequisite is wrong** | `script/generate-docs-sections.ts` → `generateDevPrereq()` | `README.md`, `DEVELOPMENT.md`, `contributing.md` | Build uses fossilize/Node SEA; Bun is not required. The generator falls back to "1.3" when `packageManager` doesn't contain `bun@` |
| `SENTRY_INSTALL_DIR` | `install` script, `src/commands/cli/setup.ts` | Not in `getting-started.mdx` | Install dir override documented only in generated `configuration.md`; should be mentioned in install script docs |
| `SENTRY_INIT` | `install` script | Not in `getting-started.mdx` | Post-install init wizard trigger not mentioned |
| Install script `--no-*` flags | `install` script accepts `--no-modify-path`, `--no-completions`, `--no-agent-skills` | `getting-started.mdx` | Only `--version nightly` shown; skip flags undocumented |
| Install directory precedence | `install` script: `SENTRY_INSTALL_DIR` → `~/.local/bin` → `~/bin` → `~/.sentry/bin` | Not documented | Users may want to control where the binary lands |
| Alpine/musl auto-install | Install script auto-installs `libstdc++ libgcc` on Alpine | Not documented | Affects Docker/CI users on Alpine |
| `yarn global add sentry` | Package manager support in code | `getting-started.mdx` has yarn; `README.md` does not list yarn | Minor inconsistency |
| `pnpm dlx`, `yarn dlx`, `bunx` | Supported in `getting-started.mdx` | `README.md` only shows `npx` | Minor inconsistency |
| Nightly not available via package managers | `upgrade.ts` migrates to curl binary when switching to nightly from npm/pnpm/bun/yarn | Not documented in `getting-started.mdx` | Users switching to nightly may be surprised by binary location change |

---

## G. Undocumented Environment Variables

The environment variable reference is generated from `src/lib/env-registry.ts` into
`docs/src/content/docs/configuration.md` (gitignored). The registry is comprehensive.

**Variables in code but NOT in `env-registry.ts`:**

| Variable | Used in | Notes |
|----------|---------|-------|
| `SENTRY_SPOTLIGHT` | `src/commands/local/run.ts` | Injected by `sentry local run`; not user-facing (internal to Sentry SDK) |
| `SENTRY_TRACES_SAMPLE_RATE` | `src/commands/local/run.ts` | Injected by `sentry local run`; not user-facing |
| `SENTRY_CLIENT_ID_BUILD` | `src/lib/oauth.ts` | Build-time embedded client ID; not user-configurable |
| `SENTRY_OUTPUT_FORMAT` | `src/lib/env-registry.ts` | In registry ✓ but not in `self-hosted.md` env table — probably fine since it's a library API concern |

**Verdict:** The env-registry is well-maintained. The above are internal/build-time variables that appropriately aren't user-documented.

**However**, `docs/src/content/docs/configuration.md` does not exist as a committed file —
it is gitignored and generated. This means the full environment variable reference is only
accessible via the built doc site. Users reading the repo directly cannot find it.

---

## H. Auth / Self-Hosted Gaps

| Gap | Source | Doc location | Details |
|-----|--------|--------------|---------|
| Host trust model | `src/commands/auth/login.ts` — refuses untrusted hosts unless `--url` explicitly passed | `self-hosted.md` | Not explained; users may not understand why login fails without `--url` |
| `auth login --force` flag | `src/commands/auth/login.ts` | `auth.md` fragment, `self-hosted.md` | Not documented in fragments |
| `auth login --timeout` flag | `src/commands/auth/login.ts` (default 900s) | `auth.md` fragment | Not documented |
| `SENTRY_CLIENT_ID_BUILD` fallback | `src/lib/oauth.ts` — committed default client ID for SaaS | Not documented | Intentionally internal; no gap |
| OAuth scope `event:write` | `src/lib/oauth.ts` — in `OAUTH_SCOPES` | `DEVELOPMENT.md`, `self-hosted.md` | Both correctly show the scopes (generated) ✓ |
| Token storage host scoping | `src/lib/db/auth.ts` — tokens bound to host origin | Not mentioned in docs | Defense-in-depth measure not documented; users switching instances may be confused |
| `SENTRY_FORCE_ENV_TOKEN` | `src/lib/db/auth.ts` | `self-hosted.md` ✓, `DEVELOPMENT.md` ✓ | Covered |
| `sentry auth refresh --force` | `src/commands/auth/refresh.ts` | `auth.md` | Fragment has no example for `--force` specifically, but the command is documented |

---

## I. Plugin/Skills Gaps

| Gap | Source | Doc location | Details |
|-----|--------|--------------|---------|
| `~/.agents/` install path | `src/lib/agent-skills.ts` — installs to `~/.agents/skills/sentry-cli/` | `agentic-usage.md` — mentions `~/.agents` | Covered ✓ |
| `~/.claude/` install path | `src/lib/agent-skills.ts` — installs to `~/.claude/skills/sentry-cli/` | `agentic-usage.md` — mentions `~/.claude` | Covered ✓ |
| Cursor IDE support | `plugins/README.md` — `.cursor/skills/sentry-cli/` | `agentic-usage.md` | Says "Cursor" reads from `~/.agents` but doesn't mention `.cursor/skills/` in repo |
| Claude Code marketplace install | `plugins/README.md` — `claude plugin marketplace add getsentry/cli` | `agentic-usage.md` | Not mentioned; only `npx skills add` shown |
| Plugin manifest version | `plugins/sentry-cli/.claude-plugin/plugin.json` — version "0.35.0" | Not documented | Internal detail; no gap |
| `--no-agent-skills` flag | `src/commands/cli/setup.ts` | `agentic-usage.md` ✓ | Covered |
| Skills embedded in binary | `src/lib/agent-skills.ts` — reads from generated `skill-content.ts` | `agentic-usage.md` — says "No network fetch needed" | Covered ✓ |
| Skill refresh on upgrade | `src/commands/cli/upgrade.ts` → spawns `cli setup` | `agentic-usage.md` ✓ | Covered |

---

## J. README / DEVELOPMENT.md Drift

| Claim | File | Reality | Severity |
|-------|------|---------|----------|
| **"Bun v1.3+"** as dev prerequisite | `README.md` (generated section) | Build uses fossilize/Node SEA; runtime is Node.js ≥22.15; `packageManager` is pnpm. Bun is not a prerequisite. | **Critical** |
| **"Bun installed"** as prerequisite | `DEVELOPMENT.md` line 5 | Same as above | **Critical** |
| **"Building the native binary still requires Bun"** | `DEVELOPMENT.md` line 91 | Build uses `fossilize` (Node SEA), esbuild for bundling. No Bun dependency. | **Critical** |
| **"Bun runtime (v1.3 or later)"** | `contributing.md` (generated) | Same as above | **Critical** |
| `pnpm run dev` description | `AGENTS.md` | `package.json` script `dev` runs generate + tsx — correct ✓ | N/A |
| `pnpm test` runs unit tests | `AGENTS.md` | `package.json`: `"test": "pnpm run test:unit"` — correct ✓ | N/A |
| OAuth scopes | `DEVELOPMENT.md` (generated) | Matches `src/lib/oauth.ts` — correct ✓ | N/A |
| License "FSL-1.1-Apache-2.0" | `README.md` | Matches `package.json` ✓ | N/A |
| Node.js engine `>=22.15` | `package.json` | README library usage says "Node.js (≥22.15)" — correct ✓ | N/A |
| `git clone https://github.com/getsentry/cli.git` | `README.md`, `contributing.md` | Matches `package.json` repository URL ✓ | N/A |

---

## Top 5 Most Impactful Fixes (Prioritized)

### 1. Fix Bun prerequisite in doc generator (Critical)

**File:** `script/generate-docs-sections.ts`

The `generateDevPrereq()` function hard-codes "Bun" as a prerequisite. The build
pipeline uses fossilize (Node SEA) + esbuild. The runtime is Node.js. This affects
`README.md`, `DEVELOPMENT.md`, and `contributing.md` via generated sections.

**Fix:** Update `generateDevPrereq()` to reference Node.js ≥22.15 and pnpm instead
of Bun. Update the non-generated parts of `DEVELOPMENT.md` that mention Bun.

### 2. Add missing subcommand examples to fragments (High)

**Files:** `docs/src/fragments/commands/dashboard.md`, `issue.md`, `cli.md`

Three subcommands have zero documentation in fragments:
- `sentry dashboard revisions` / `sentry dashboard restore`
- `sentry issue events`
- `sentry cli import`

### 3. Document `auth login` flags in fragment (High)

**File:** `docs/src/fragments/commands/auth.md`

The `--url`, `--timeout`, and `--force` flags for `sentry auth login` are important
for self-hosted users and automation but have no examples in the auth fragment.

### 4. Document install script flags and env vars in getting-started (Medium)

**File:** `docs/src/content/docs/getting-started.mdx`

The install script accepts `--no-modify-path`, `--no-completions`, `--no-agent-skills`,
and the env vars `SENTRY_INSTALL_DIR` and `SENTRY_INIT`. These are useful for CI/Docker
but undocumented in getting-started.

### 5. Add `@latest` / `@most_frequent` magic selectors to issue fragment (Medium)

**File:** `docs/src/fragments/commands/issue.md`

The issue route's `fullDescription` mentions `@latest` and `@most_frequent` selectors
for `sentry issue view @latest`, but no fragment documents them with examples.
