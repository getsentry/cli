# Documentation Audit Report

Audit performed on 2026-06-08 against commit on branch `cursor/sentry-cli-documentation-audit-ac19`.

---

## A. Undocumented or Missing Commands/Subcommands

Command docs are auto-generated from CLI metadata by `script/generate-command-docs.ts`, so every route in `src/app.ts` gets a page. However, fragment files (hand-written examples in `docs/src/fragments/commands/`) are the committed source of custom content. All routes have fragments, so no commands are entirely undocumented.

**No gaps found** — the generation system covers all visible routes.

---

## B. Undocumented Flags

Since command docs are auto-generated from the Stricli route tree, all non-hidden flags are included in the generated output. The generation script filters out hidden flags and globally-injected flags (`--json`, `--fields`, `--help`, `--helpAll`, `--log-level`).

**No gaps found** for auto-generated content.

However, the **`configuration.md` fragment** (`docs/src/fragments/configuration.md`) documents `--log-level` and `--verbose` as global options but does not mention `--org` and `--project` (hidden global flags injected by `buildCommand`). Since these are hidden, this is by design.

---

## C. Missing Usage Examples

Fragment files provide bash examples for all command groups. Coverage is thin in a few areas:

| Fragment | Issue |
|----------|-------|
| `schema.md` | Only 2 examples; no example for `--all` or `--search` flags |
| `repo.md` | Only basic list examples (3 lines); no `--limit` or `--fresh` usage |
| `team.md` | Only basic list examples (3 lines); no `--limit` or `--fresh` usage |

---

## D. Stale Descriptions

No material discrepancies found between `brief` strings in code and doc fragment content. The generation script uses the code's `brief` directly, so these stay in sync by design.

---

## E. Missing Route Mappings in Skill Generator

The `ROUTE_TO_REFERENCE` map was **removed** in a prior refactor. The current `script/generate-skill.ts` uses a 1:1 route-to-reference mapping (`groupRoutesByReference`), automatically creating one reference file per visible route. **No manual mapping is required, so no gaps exist.**

---

## F. Installation / Distribution Gaps

### F1. Install script `--version` flag undocumented in `getting-started.mdx`

The install script accepts `--version <version>` (aliased as `-v`) to pin a specific version. The getting-started page documents `SENTRY_VERSION` env var and `--version nightly` but does **not** list the full flag syntax:

```
-h, --help         Show usage
-v, --version      Pin version (e.g. 0.19.0) or "nightly"
--no-modify-path   Skip shell config PATH edits
--no-completions   Skip shell completions
--no-agent-skills  Skip agent skill installation
```

Only `--version nightly` is shown. The other flags (`--no-modify-path`, `--no-completions`, `--no-agent-skills`) are not documented in any doc page.

**Source:** `install` script lines ~34-52
**Expected in:** `docs/src/content/docs/getting-started.mdx`

### F2. `SENTRY_INIT` env var undocumented in getting-started

The install script supports `SENTRY_INIT=1` to run `sentry init` after installation. This is documented in `env-registry.ts` but not in `getting-started.mdx`.

**Source:** `install` script, `src/lib/env-registry.ts`
**Expected in:** `docs/src/content/docs/getting-started.mdx`

### F3. `SENTRY_INSTALL_DIR` env var undocumented in getting-started

The install script supports `SENTRY_INSTALL_DIR` to override the install location. Not documented in getting-started.

**Source:** `install` script, `src/lib/env-registry.ts`
**Expected in:** `docs/src/content/docs/getting-started.mdx`

### F4. Alpine/musl auto-dependency installation undocumented

The install script auto-installs `libstdc++` and `libgcc` via `apk` on Alpine Linux when running as root. This is not documented anywhere.

**Source:** `install` script (function `ensure_alpine_deps`)
**Expected in:** `docs/src/content/docs/getting-started.mdx` (Supported Platforms section)

### F5. Windows installation support understated

The getting-started page says Windows is supported "Via Git Bash, MSYS2, or WSL" but does not explain that the installer only supports x64 on Windows. Also, PowerShell is explicitly not supported by the curl installer.

**Source:** `install` script
**Expected in:** `docs/src/content/docs/getting-started.mdx`

### F6. `yarn` missing from README "Run Without Installing"

README shows `npx`, `pnpm dlx`, `yarn dlx`, `bunx` for running without installing, and also shows `yarn global add sentry` in the package managers section. The docs index page does NOT include `yarn` in the install selector component. This is a minor inconsistency.

**Source:** `README.md` line 47, `docs/src/content/docs/index.mdx` InstallSelector
**Expected in:** consistency between README.md and docs index

---

## G. Undocumented Environment Variables

The `env-registry.ts` is the authoritative list. Since `configuration.md` is **generated** from the registry, all registered variables will appear in the generated page. However, several environment variables used in the source code are **not registered** in `env-registry.ts`:

| Variable | Used In | Description |
|----------|---------|-------------|
| `SENTRY_SPOTLIGHT` | `src/commands/local/run.ts` | Spotlight URL injected into child processes |
| `SENTRY_TRACES_SAMPLE_RATE` | `src/commands/local/run.ts` | Trace sample rate injected by `local run` |
| `SENTRY_MONITOR_SLUG` | `src/commands/monitor/run.ts` | Monitor slug passed to wrapped command |

These are **injected** env vars (set by the CLI for child processes) rather than **read** env vars, so excluding them from the configuration page may be intentional. However, `SENTRY_MONITOR_SLUG` is documented in the monitor fragment, while `SENTRY_SPOTLIGHT` and `SENTRY_TRACES_SAMPLE_RATE` are mentioned in the local fragment and agent-guidance.md.

---

## H. Auth / Self-Hosted Gaps

### H1. OAuth scopes: `event:admin` missing from docs

The `OAUTH_SCOPES` array in `src/lib/oauth.ts` includes:
```
project:read, project:write, project:admin, org:read, event:read, event:write, member:read, team:read, team:write
```

The generated sections in `DEVELOPMENT.md` and `self-hosted.md` match. **No gap found** — the docs are generated from the same source.

### H2. Token storage `host` column undocumented

The auth database schema (v16+) includes a `host` column that scopes tokens to specific Sentry instances. The `self-hosted.md` page mentions "Once authenticated, the CLI stores your instance URL" but does not explain the host-scoping security model (that tokens are rejected if the request host doesn't match the stored host).

**Source:** `src/lib/db/auth.ts`
**Expected in:** `docs/src/content/docs/self-hosted.md`

### H3. `--read-only` and `--scope` flags on `auth login` undocumented in getting-started

The `auth login` command supports `--read-only` (request only read scopes) and `--scope` (custom scope list). These are documented in the auto-generated command page but not mentioned in `getting-started.mdx` or `self-hosted.md`.

**Source:** `src/commands/auth/login.ts`
**Expected in:** `docs/src/content/docs/getting-started.mdx`, `docs/src/content/docs/self-hosted.md`

### H4. Login trust anchor security model undocumented

The `--url` flag on `auth login` is described as "the most secure way to authenticate with a new host" in a `:::note` in self-hosted.md, but the full security model (trust anchors, untrusted host refusal, `.sentryclirc` bypass protection) is not explained.

**Source:** `src/commands/auth/login.ts` (`refuseLoginToUntrustedHost`, `applyLoginUrl`)
**Expected in:** `docs/src/content/docs/self-hosted.md`

---

## I. Plugin/Skills Gaps

### I1. Cursor plugin installation not documented in `agentic-usage.md`

The `plugins/README.md` documents Cursor support via `.cursor/skills/` symlink, but `agentic-usage.md` only mentions "Claude Code" and "any agent that reads from `~/.agents` such as Cursor". The Cursor plugin system (via `.cursor/skills/` directory and the skills plugin format) is not described in the agentic-usage page.

**Source:** `plugins/README.md`
**Expected in:** `docs/src/content/docs/agentic-usage.md`

### I2. Claude Code marketplace installation undocumented in `agentic-usage.md`

The `plugins/README.md` describes `claude plugin marketplace add getsentry/cli` for installing via the Claude Code marketplace. This method is not mentioned in `agentic-usage.md`.

**Source:** `plugins/README.md`
**Expected in:** `docs/src/content/docs/agentic-usage.md`

### I3. `npx skills add` command may be outdated

The `agentic-usage.md` page suggests `npx skills add https://cli.sentry.dev` for manual installation. The actual skill install mechanism in code (`src/lib/agent-skills.ts`) writes files directly to `~/.agents/skills/` or `~/.claude/skills/` directories. The `npx skills add` command is an external tool not part of this repository. If this external tool no longer exists or works differently, this advice could be stale.

**Source:** `docs/src/content/docs/agentic-usage.md`

---

## J. README / DEVELOPMENT.md / AGENTS.md Drift

### J1. **CRITICAL: AGENTS.md references Bun throughout, but the project uses pnpm + Node.js + vitest**

This is the **single largest documentation drift** in the repository. AGENTS.md contains extensive Bun-specific guidance that no longer matches the codebase:

| AGENTS.md Claim | Actual Codebase |
|-----------------|-----------------|
| "Built with Bun" | Built with pnpm + esbuild + fossilize |
| "Use Bun as runtime" | Uses Node.js 22.15+ as runtime |
| `bun install` | `pnpm install` |
| `bun run dev` | `pnpm run dev` |
| `bun test` | `vitest` via `pnpm run test:unit` |
| `bun run lint` | `pnpm run lint` |
| `Bun.file(path).text()` | Standard Node.js `fs` APIs |
| `Bun.write(path, content)` | Standard Node.js `fs` APIs |
| `Bun.spawn()` | `child_process` / `execSync` |
| `Bun.which()` | Not used |
| `Bun.Glob()` | Not used |
| `Bun.sleep(ms)` | Not used |
| `bun:test` imports | `vitest` imports |
| `bun add -d <package>` | `pnpm add -d <package>` |
| "Native binaries via Bun" | Native binaries via esbuild + fossilize (Node SEA) |
| `bun run --env-file=.env.local` | `dotenv` / `export $(cat .env.local)` |
| "Bun's test runner uses `--isolate --parallel`" | vitest uses `isolate: true, pool: "forks"` |
| `BUN_TEST_WORKER_ID` | Not applicable (vitest) |

The Quick Bun API Reference table, the exception notes about `Bun.$`, and numerous inline references to Bun APIs are all stale.

**Source:** `AGENTS.md` throughout, vs. `package.json`, `vitest.config.ts`, `src/**/*.ts`

### J2. AGENTS.md test commands are wrong

| AGENTS.md | Actual (`package.json`) |
|-----------|------------------------|
| `bun test` | `pnpm run test:unit` (runs vitest) |
| `bun test path/to/file.test.ts` | `pnpm run test:unit -- test/path/file.test.ts` |
| `bun test --watch` | `pnpm run test:unit -- --watch` |
| `bun test --filter "test name"` | `pnpm run test:unit -- --filter "test name"` |
| `bun run test:unit` | `pnpm run test:unit` |
| `bun run test:e2e` | `pnpm run test:e2e` |

### J3. AGENTS.md "Testing (bun:test + fast-check)" section header is wrong

Should be "Testing (vitest + fast-check)". All test imports use `from "vitest"` not `from "bun:test"`.

### J4. README and DEVELOPMENT.md are correct

Both README.md and DEVELOPMENT.md correctly use `pnpm` and reference Node.js 22.15+. Their generated sections are maintained by `script/generate-docs-sections.ts`. **No drift found in these files.**

### J5. No additional drift found in DEVELOPMENT.md

Both README.md and DEVELOPMENT.md correctly use `pnpm`, reference Node.js 22.15+, and `.env.example` exists as referenced in contributing.md.

---

## Top 5 Most Impactful Fixes (Prioritized)

1. **Fix AGENTS.md Bun→pnpm/Node/vitest migration** (J1-J3): AGENTS.md is the primary guidance for AI agents working on the codebase. Every Bun reference leads agents to write incorrect code, use wrong commands, and import from non-existent modules. This affects every agent interaction.

2. **Add install script flags to getting-started.mdx** (F1): Users/CI pipelines need `--no-modify-path`, `--no-completions`, `--no-agent-skills` for non-interactive installs but can't discover them from the docs.

3. **Expand bash examples in schema.md fragment** (C): The schema command has the thinnest example coverage relative to its feature set (`--all`, `--search` flags).

4. **Document Cursor plugin installation in agentic-usage.md** (I1-I2): Cursor is a widely-used IDE; the current doc only mentions Claude Code and generic `~/.agents`.

5. **Document host-scoping security model in self-hosted.md** (H2): Users running self-hosted Sentry don't understand why tokens are rejected when the request host doesn't match the stored host.
