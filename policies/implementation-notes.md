# Implementation Notes

Load this only when touching one of the listed areas. These notes capture edge
cases that are too specific for always-loaded agent instructions.

## Domain Notes
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
