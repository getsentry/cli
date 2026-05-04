# Local CLI Testing

## Goal
Run the CLI locally with the smallest command that exercises the changed behavior.

## Fast Path
```bash
bun run --env-file=.env.local src/bin.ts <command> <args>
```

Examples:
```bash
bun run --env-file=.env.local src/bin.ts auth whoami
bun run --env-file=.env.local src/bin.ts issue list <org>/<project> --limit 5
bun run --env-file=.env.local src/bin.ts trace view <trace-id> --json
```

## Dev Script
Use this when generated docs/schema/sdk must be refreshed first:

```bash
bun run dev -- <command> <args>
```

## Built Binary Smoke Test
Use this for packaging, startup, or Node-distribution-sensitive changes:

```bash
bun run build
./dist/bin.cjs <command> <args>
```

## Auth And Env
- Put local OAuth client config in `.env.local`.
- Use `SENTRY_AUTH_TOKEN` for non-interactive API smoke tests.
- Use `SENTRY_HOST` for self-hosted testing.
- Use `SENTRY_LOG_LEVEL=debug` when checking diagnostics.

## Output Checks
```bash
bun run --env-file=.env.local src/bin.ts <command> --json
bun run --env-file=.env.local src/bin.ts <command> --fields id,slug --json
SENTRY_PLAIN_OUTPUT=1 bun run --env-file=.env.local src/bin.ts <command>
```

## Test Selection
| Change | Start With |
|--------|------------|
| Command parser or output | `bun test test/commands/<domain>/<file>.test.ts --timeout 15000 --isolate` |
| Shared lib | `bun test test/lib/<file>.test.ts --timeout 15000 --isolate` |
| Parsing/validation invariant | matching `*.property.test.ts` |
| DB/cache behavior | matching `*.model-based.test.ts` |
| Full CLI behavior | `bun run test:e2e` |

## Final Checks
```bash
bun run typecheck
bun run lint
```
