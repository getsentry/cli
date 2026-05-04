# CLI Command Design

## Intent
Commands should follow `gh`-style ergonomics while preserving consistent telemetry, JSON output, and error handling.

## Command Wrappers
- Import `buildCommand` from `src/lib/command.ts`.
- Import `buildRouteMap` from `src/lib/route-map.ts`.
- Do not import either wrapper directly from `@stricli/core`.
- The wrappers inject telemetry, `--json`, `--fields`, output rendering, and standard route aliases.

## Command Shape
- Command `func` implementations are `async *` generators.
- Yield `new CommandOutput(data)` for data output.
- Return `{ hint }` for follow-up guidance.
- Keep command files focused on argument parsing, API orchestration, and output dispatch.
- Put rendering logic in `src/lib/formatters/<domain>.ts`.
- Avoid command files over roughly 400 lines; extract helpers when command logic stops being scannable.

## Arguments And Routes
- Required identifiers are positional args, not flags.
- Use `parseSlashSeparatedArg` and `parseOrgProjectArg` for `[<org>/<project>/]<id>`.
- Use `"date"` for timestamp sort values, not `"time"`.
- Route aliases for `list`, `view`, `delete`, and `create` are auto-injected by `buildRouteMap`.

## Mutations
- Delete commands use `buildDeleteCommand()` from `src/lib/mutate-command.ts`.
- Create commands reuse `DRY_RUN_FLAG` and `DRY_RUN_ALIASES` when dry-run is supported.
- Destructive commands require explicit targets unless a helper policy says otherwise.

## Shared Helpers
- Check existing `src/lib/*` modules before adding new utilities.
- Extend an existing helper when it covers most of the need.
- Use `upsert()` / `runUpsert()` from `src/lib/db/utils.ts` for SQLite UPSERTs.
- Use shared hex validators from `src/lib/hex-id.ts` and `src/lib/trace-id.ts`.
