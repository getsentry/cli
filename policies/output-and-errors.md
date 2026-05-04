# Output And Errors

## Human Output
- Non-trivial human output goes through the markdown rendering pipeline.
- Build markdown with helpers such as `mdKvTable()`, `colorTag()`, `escapeMarkdownCell()`, and `renderMarkdown()`.
- Do not put raw `muted()` or chalk calls inside output strings.
- Tree output that cannot go through markdown should use the plain-safe muted pattern.

## JSON Output
- The command wrapper owns `--json` and `--fields`.
- `output.human` receives the same data object that JSON serialization receives.
- Do not branch on `flags.json` inside command bodies.
- List JSON envelopes preserve pagination fields such as `hasMore`, `hasPrev`, and `nextCursor`.

## Errors
- All CLI errors extend `CliError` from `src/lib/errors.ts`.
- Use `ContextError` when the user omitted required context.
- Use `ResolutionError` when a provided value was not found.
- Use `ValidationError` when input is malformed.
- Use `EXIT.*` constants in error definitions; do not hardcode exit codes elsewhere.
- `ContextError.command` must be one single-line usage example.

## Diagnostics
- Production `catch` blocks must log, rethrow, or explain the fallback with `log.debug()` / `log.warn()`.
- Use `logger.withTag("command-name")` in command files.
- Use fuzzy suggestions for user-provided names when listing every candidate would be noisy.
- Auto-recover wrong entity types when intent is unambiguous; warn and return a hint.
