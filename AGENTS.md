# Agent Instructions

## Project
- Sentry CLI is a Bun + Stricli command-line client for Sentry.
- Product goals: zero-config project detection, `gh`-style UX, reliable JSON for agents, fast bundled binaries, and Seer-powered debugging flows.
- Major surfaces: DSN/project auto-detection, multi-region Sentry APIs, SQLite-backed auth/cache/defaults, OAuth device auth, generated command docs/skills, and the npm/node distribution.
- Keep this file concise. Put durable details in `policies/`, repeatable workflows in `playbooks/`, and design plans in `specs/`.
- Prefer editing existing policy/playbook/spec files over expanding this file.

## Package Manager
- Use **Bun**: `bun install`, `bun run dev`, `bun run test`, `bun run typecheck`.
- Add packages with `bun add -d <package>` only; this repo does not use runtime `dependencies`.

## Commit Attribution
AI commits MUST include:

```text
Co-Authored-By: OpenAI Codex <codex@openai.com>
```

## Commands
- Setup/dev: `bun install`; `bun run dev -- <args>`; `bun run --env-file=.env.local src/bin.ts <args>`
- Build: `bun run build`; `bun run build:all`
- Check code: `bun run typecheck`; `bun run lint`; `bun run lint:fix`
- Test: `bun run test:unit`; `bun run test:e2e`; `bun run test:changed`
- Test one file: `bun test path/to/file.test.ts --timeout 15000 --isolate`
- Validate repo metadata: `bun run check:fragments`; `bun run check:errors`; `bun run check:deps`

## Read First
- Any code change: `policies/code-comments.md`
- Runtime APIs or packages: `policies/runtime-and-deps.md`
- Commands or routes: `policies/cli-command-design.md`
- Human/JSON output or errors: `policies/output-and-errors.md`
- List commands: `policies/pagination.md`
- Tests: `policies/testing.md`
- Generated docs or skills: `policies/generated-artifacts.md`
- Local CLI smoke testing: `playbooks/local-cli-testing.md`
- SDK patching or dependency runtime changes: `policies/runtime-and-deps.md`, `package.json` `patchedDependencies`

## Critical Rules
- Import `buildCommand` from `src/lib/command.ts`, never from `@stricli/core`.
- Import `buildRouteMap` from `src/lib/route-map.ts`, never from `@stricli/core`.
- Command `func` bodies are `async *` generators that yield `new CommandOutput(data)`.
- Do not add a command-owned `--json`; the command wrapper injects `--json` and `--fields`.
- Do not write directly to stdout/stderr in command files. Use `CommandOutput` and `logger`.
- Delete commands use `buildDeleteCommand()` from `src/lib/mutate-command.ts`.
- List commands with API pagination use the shared cursor-stack helpers and `paginationHint()`.
- Required entity IDs are positional args, not flags.
- Use `ValidationError`, `ContextError`, `ResolutionError`, and other `CliError` subclasses from `src/lib/errors.ts`.
- Silent `catch` blocks are not allowed in production code; log, rethrow, or explain the fallback.
- Local ESM imports use `.js` extensions and type-only imports use `import type`.
- Use `@sentry/api` response types when available instead of duplicating API schemas.
- Keep comments brief and intent-focused. Follow `policies/code-comments.md`.
- Config/auth helpers are async; always await them.
- Use shared validators in `src/lib/hex-id.ts` and `src/lib/trace-id.ts` for trace, span, event, and log IDs.
- Use `upsert()` / `runUpsert()` from `src/lib/db/utils.ts` for SQLite UPSERTs.
- For project filtering, verify the endpoint contract first; Discover uses query text, replay uses `projectSlugs`, and issue endpoints vary by mode.

## File Locations
- Commands: `src/commands/<domain>/`
- Command routes: `src/commands/<domain>/index.ts`
- API modules: `src/lib/api/`
- Formatters: `src/lib/formatters/`
- Shared command helpers: `src/lib/command.ts`, `src/lib/list-command.ts`, `src/lib/mutate-command.ts`
- Org/project resolution: `src/lib/resolve-target.ts`, `src/lib/org-list.ts`
- DSN detection: `src/lib/dsn/`
- SQLite/cache code: `src/lib/db/`
- Types and schemas: `src/types/`
- Unit tests: `test/` mirroring `src/`
- Property tests: `test/lib/*.property.test.ts`
- Model-based tests: `test/lib/**/*.model-based.test.ts`
- E2E tests: `test/e2e/`
- Test helpers: `test/helpers.ts`, `test/model-based/helpers.ts`
- Command doc fragments: `docs/src/fragments/commands/`
- Generated plugin skill: `plugins/sentry-cli/skills/sentry-cli/`
- Build scripts: `script/`

## Long-Term Concerns
- Issue flows: `issue resolve --in` accepts versions, `@next`, `@commit`, and `@commit:<repo>@<sha>`; split explicit commit specs on the last `@` and send `{commit, repository}` to the API. For issue merge, dedupe by resolved numeric IDs, reject unresolved orgs in cross-org checks, and treat `--into` as a preference.
- Repository lookup: `repo_cache` backs offline Sentry repo matching for `@commit`; use paginated `listAllRepositories()` and tolerate read-only cache writes.
- Response cache: cached synthetic `Response` objects carry no marker; `authenticatedFetch()` owns `lastCacheHitAgeMs`, and `buildCommand()` appends cache hints only when a command returns a `CommandReturn`.
- JSON and markdown output: `collapse=organization` can drop nested org fields, so `jsonTransform` must rehydrate needed fields, apply `filterFields()`, and handle exclusions itself. Tests run non-TTY and usually assert raw CommonMark.
- API SDK fetch: `@sentry/api` may pass a `Request` without `init`; preserve request headers, use `unwrapPaginatedResult()` when headers matter, and guard empty responses with `Array.isArray()`.
- API and command tests: API tests that mock `globalThis.fetch` need `useTestConfigDir()` plus `setAuthToken()`. Test command `func` bodies via `await cmd.loader()` and `.call(mockContext, flags, ...args)`; keep `mock.module()` pollution in isolated test files.
- Multi-region orgs: in `listOrganizationsUncached()`, track any fulfilled region separately from result count so empty 200s are not treated as all-region 403 failures.
- Seer and init: `bin.ts` layers auth outside Seer trial prompting; trial start uses the server-provided category and treats self-hosted 404s gracefully. `MastraClient` has no dispose API; pass and abort an `AbortController`, and preserve `init.signal` in custom fetch wrappers.
- TTY and upgrade/build: macOS Bun TTY reopening uses `/dev/tty` plus `tty.ReadStream`; keep the explicit exit safety net and skip it under `NODE_ENV=test`. Windows upgrade verification polls file visibility before spawn. Patched Bun cross-compile omits `compile.target` and requires `SENTRY_CLIENT_ID`.
- npm/node distribution: `dist/bin.cjs` requires Node.js >= 22 because the SQLite polyfill uses `node:sqlite`; double-escape newline continuations in esbuild banner template strings.
- SDK tree-shaking: Sentry SDK patches come from `bun patch`; import `@sentry/node-core/light` subpaths and regenerate patches instead of hand-editing diffs.
- Lint and coverage traps: use named imports instead of namespace imports, define top-level `noop()` helpers instead of empty arrows, and run `bun run lint` after `lint:fix`. Bun `--isolate --parallel` coverage may count comments, type lines, and braces.
- Hidden globals: hidden `--org` / `--project` compatibility flags are merged in `buildCommand()` and applied before auth; no short aliases because `-p` conflicts.
- Error reporting and telemetry: preserve `ApiError` status when rethrowing so 4xx API errors stay silenced; pass `field` to `ValidationError`. Graceful fallbacks should use `withTracingSpan()` plus named `captureException` imports at warning level; user-visible fallbacks use `log.warn()`.
- Dashboard and project lookup: normalize dashboard dataset aliases once, pass normalized flags through replacement builders, and use grouped-widget limit auto-defaulting only when the user omitted `--limit`. On exact project slug misses, `findProjectsByPattern()` is the failure-path suggestion mechanism.
- Bot review triage: when bot feedback conflicts with mirrored upstream SDK behavior, verify against the SDK source and explain the precedent instead of diverging silently.

## Specs And Playbooks
- Add specs under `specs/` for material design changes, migrations, and unresolved tradeoffs.
- Add playbooks under `playbooks/` for repeatable procedures with commands and expected checks.
- Keep both short, task-scoped, and linked from this file only when broadly useful.
