# Runtime And Dependencies

## Intent
The CLI ships as bundled Bun binaries and an npm/node distribution. Runtime choices must work in both paths.

## Dependency Policy
- All packages go in `devDependencies`, never `dependencies`.
- Add packages with `bun add -d <package>`.
- Run `bun run check:deps` after dependency changes.
- Use types from `@sentry/api` when the SDK exposes the API response shape.

## Bun APIs
| Task | Prefer | Avoid |
|------|--------|-------|
| Read file | `await Bun.file(path).text()` | `fs.readFileSync()` |
| Write file | `await Bun.write(path, content)` | `fs.writeFileSync()` |
| Check file exists | `await Bun.file(path).exists()` | `fs.existsSync()` |
| Spawn process | `Bun.spawn()` | `child_process.spawn()` |
| Find executable | `Bun.which("git")` | `which` package |
| Glob files | `new Bun.Glob()` | `glob` / `fast-glob` |
| Sleep | `await Bun.sleep(ms)` | Promise-wrapped `setTimeout` |
| Parse JSON file | `await Bun.file(path).json()` | read + `JSON.parse` |

## Exceptions
- Use `node:fs` for directory creation that needs permissions: `mkdirSync(dir, { recursive: true, mode: 0o700 })`.
- Do not use `Bun.$` in code that must run in the npm/node distribution; `script/node-polyfills.ts` does not shim it.
- For shell commands that must work under both runtimes, use `execSync` from `node:child_process`.
- `Bun.$` is acceptable in Bun-only scripts.
