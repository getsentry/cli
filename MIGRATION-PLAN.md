# Bun → Node.js Migration Plan

Status: In progress. See below for completed and remaining steps.

## Completed

### Phase 4 (early): Package Manager Switch
- [x] Changed `packageManager` from `bun@1.3.13` to `pnpm@10.11.0`
- [x] Moved `patchedDependencies` into `pnpm` config section
- [x] Added `onlyBuiltDependencies: ["esbuild"]`
- [x] Added phantom deps as explicit devDependencies: `@sentry/core`, `@clack/prompts`
- [x] Generated `pnpm-lock.yaml`
- [x] Verified all patches apply (including cross-version: `@stricli/core@1.2.5` patch on `1.2.7`)

### Phase 2, Group D: SQLite Adapter
- [x] Created `src/lib/db/sqlite.ts` — runtime-detecting adapter (bun:sqlite under Bun, node:sqlite under Node.js)
- [x] Updated 4 source files: `db/index.ts`, `schema.ts`, `migration.ts`, `utils.ts`
- [x] Updated 3 test files: `fix.test.ts`, `telemetry.test.ts`, `schema.test.ts`
- [x] Zero `bun:sqlite` imports remain in `src/` or `test/`

## Remaining

### Phase 2: Source Code Migration (replace Bun.* APIs in `src/`)

**Group A: File I/O** — Replace `Bun.file()` / `Bun.write()` with `node:fs/promises`
- `Bun.file(path).text()` → `readFile(path, "utf-8")`
- `Bun.file(path).json()` → `readFile(path, "utf-8")` then `JSON.parse()`
- `Bun.file(path).exists()` → `access(path).then(() => true, () => false)`
- `Bun.write(path, content)` → `writeFile(path, content)`
- Scan all of `src/` for occurrences

**Group B: Process/System APIs** — Replace Bun.which / Bun.spawn / Bun.sleep
- `Bun.which("cmd")` → `which` from a Node.js-compatible package or custom implementation
- `Bun.spawn()` / `Bun.spawnSync()` → `child_process.spawn()` / `spawnSync()`
- `Bun.sleep(ms)` → `setTimeout` promise wrapper

**Group C: Miscellaneous Bun APIs**
- `Bun.Glob` → `tinyglobby` or `picomatch` (already in devDependencies)
- `Bun.randomUUIDv7()` → `uuidv7` package (already in devDependencies)
- `Bun.semver.order()` → `semver.compare()` (already in devDependencies)
- `Bun.zstdCompressSync()` / `Bun.zstdDecompressSync()` → Node.js zlib or `zstd-napi` package

**Group E: Unpolyfilled APIs**
- `bspatch.ts` and `upgrade.ts` — Replace any Bun-specific APIs not covered by node-polyfills.ts

### Phase 3: Test Migration (`bun:test` → Vitest)

- Add `vitest` as devDependency
- Replace `import { ... } from "bun:test"` with Vitest equivalents
- Replace `bun test` scripts with `vitest`
- Key differences:
  - `bun:test`'s `mock.module()` → Vitest's `vi.mock()`
  - `bun:test`'s `spyOn` → Vitest's `vi.spyOn()`
  - Test file discovery patterns may differ
  - `--isolate --parallel` behavior needs Vitest equivalent

### Phase 4: CI & Dev Scripts (remaining)

- Update `package.json` scripts: `bun run` → `pnpm run` where appropriate
- Replace `bun run src/bin.ts` with `tsx src/bin.ts` (add `tsx` devDependency)
- Replace `bun run script/*.ts` with `tsx script/*.ts`
- Replace `bunx` with `pnpm exec`
- Update GitHub Actions workflows to use pnpm + Node.js instead of Bun
- Update `Dockerfile` / build scripts if applicable

### Phase 5: Cleanup

- Remove `@types/bun` from devDependencies
- Remove `bun.lock` (replaced by `pnpm-lock.yaml`)
- Remove or update `script/node-polyfills.ts` (may become unnecessary)
- Update `AGENTS.md` Bun API reference table
- Remove Bun-specific `.cursor/rules/bun-cli.mdc` or update for Node.js
- Clean up any remaining `Bun.*` references in comments/docs

## Known Issues

- `test/lib/index.test.ts` — `sdk.run throws when auth is required but missing` fails under pnpm's strict `node_modules`. The mock fetch returns empty 200s which prevents the expected auth error from being thrown. Pre-existing test fragility, not caused by migration changes.
