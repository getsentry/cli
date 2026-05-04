# Agent Instructions

## Project
- Sentry CLI is a Bun + Stricli command-line client for Sentry.
- Product goals: zero-config project detection, `gh`-style UX, reliable JSON for agents, fast bundled binaries, and Seer-powered debugging flows.
- Keep this file as the always-loaded router. Put large durable context in `policies/`, repeatable workflows in `playbooks/`, and design plans in `specs/`.

## Package Manager
- Use **Bun**: `bun install`, `bun run dev`, `bun run test`, `bun run typecheck`.
- Add packages with `bun add -d <package>` only; this repo does not use runtime `dependencies`.

## Commands
| Task | Command |
|------|---------|
| Setup | `bun install` |
| Run CLI | `bun run dev -- <args>` |
| Run with local env | `bun run --env-file=.env.local src/bin.ts <args>` |
| Typecheck | `bun run typecheck` |
| Lint | `bun run lint` / `bun run lint:fix` |
| Unit tests | `bun run test:unit` |
| E2E tests | `bun run test:e2e` |
| One test file | `bun test path/to/file.test.ts --timeout 15000 --isolate` |
| Metadata checks | `bun run check:fragments`; `bun run check:errors`; `bun run check:deps` |

## Task References
| Need | File |
|------|------|
| Runtime APIs, packages, Node distribution | `policies/runtime-and-deps.md` |
| Commands, routes, mutations | `policies/cli-command-design.md` |
| Human output, JSON output, errors | `policies/output-and-errors.md` |
| Cursor pagination for list commands | `policies/pagination.md` |
| Test style and isolation | `policies/testing.md` |
| Generated docs, skills, schemas | `policies/generated-artifacts.md` |
| Local CLI smoke testing | `playbooks/local-cli-testing.md` |
| Edge-case implementation notes | `policies/implementation-notes.md` |

## Key Conventions
- Command code uses repo wrappers: `buildCommand`, `buildListCommand`, `buildDeleteCommand`, and `buildRouteMap`.
- Command output goes through `CommandOutput`; the wrappers own `--json` and `--fields`.
- Required entity IDs are positional args, not flags.
- Use shared `CliError` subclasses from `src/lib/errors.ts`.
- Production `catch` blocks must log, rethrow, or explain the fallback.
- Local ESM imports use `.js` extensions; type-only imports use `import type`.
- Prefer `@sentry/api` response types when available instead of duplicating API schemas.

## File Map
| Area | Path |
|------|------|
| Commands | `src/commands/<domain>/` |
| API modules | `src/lib/api/` |
| Formatters | `src/lib/formatters/` |
| Shared command helpers | `src/lib/command.ts`, `src/lib/list-command.ts`, `src/lib/mutate-command.ts` |
| Org/project resolution | `src/lib/resolve-target.ts`, `src/lib/org-list.ts` |
| DSN detection | `src/lib/dsn/` |
| SQLite/cache code | `src/lib/db/` |
| Types and schemas | `src/types/` |
| Tests | `test/` mirrors `src/` |
| Command doc fragments | `docs/src/fragments/commands/` |
| Generated plugin skill | `plugins/sentry-cli/skills/sentry-cli/` |

## Commit Attribution
AI commits MUST include:

```text
Co-Authored-By: OpenAI Codex <codex@openai.com>
```
