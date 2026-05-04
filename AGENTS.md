# Agent Instructions

## Project
- Sentry CLI is a Bun + Stricli command-line client for Sentry.
- Keep agent-facing docs concise. Put durable details in `policies/`, repeatable workflows in `playbooks/`, and design plans in `specs/`.
- Prefer editing existing policy/playbook/spec files over expanding this file.

## Package Manager
- Use **Bun**: `bun install`, `bun run dev`, `bun run test`, `bun run typecheck`.
- Add packages with `bun add -d <package>` only; this repo does not use runtime `dependencies`.

## Commit Attribution
- AI commits MUST include:

```text
Co-Authored-By: OpenAI Codex <codex@openai.com>
```

## Common Commands
| Task | Command |
|------|---------|
| Install | `bun install` |
| Run CLI in dev | `bun run dev -- <args>` |
| Run CLI with env | `bun run --env-file=.env.local src/bin.ts <args>` |
| Build current platform | `bun run build` |
| Build all platforms | `bun run build:all` |
| Typecheck | `bun run typecheck` |
| Lint | `bun run lint` |
| Fix lint/format | `bun run lint:fix` |
| Unit tests | `bun run test:unit` |
| E2E tests | `bun run test:e2e` |

## File-Scoped Commands
| Task | Command |
|------|---------|
| Test file | `bun test path/to/file.test.ts --timeout 15000 --isolate` |
| Changed tests | `bun run test:changed` |
| Format/lint changed code | `bun run lint:fix` |
| Validate fragments | `bun run check:fragments` |
| Validate errors | `bun run check:errors` |
| Validate deps | `bun run check:deps` |

## Read First
| Work | Read |
|------|------|
| Any code change | `policies/README.md`, `policies/code-comments.md` |
| Runtime APIs or packages | `policies/runtime-and-deps.md` |
| Commands or routes | `policies/cli-command-design.md` |
| Human/JSON output or errors | `policies/output-and-errors.md` |
| List commands | `policies/pagination.md` |
| Tests | `policies/testing.md` |
| Generated docs or skills | `policies/generated-artifacts.md` |
| Local CLI smoke testing | `playbooks/local-cli-testing.md` |

## Policy Index
| File | Purpose |
|------|---------|
| `policies/README.md` | How to write and size repo policies |
| `policies/TEMPLATE.md` | Template for new concise policy docs |
| `policies/code-comments.md` | Comment, docstring, and JSDoc defaults |
| `policies/runtime-and-deps.md` | Bun APIs, dependency rules, Node distribution exceptions |
| `policies/cli-command-design.md` | Stricli wrappers, command shape, mutation helpers |
| `policies/output-and-errors.md` | Markdown output, JSON output, error classes, logging |
| `policies/pagination.md` | Cursor-stack pagination and list command expectations |
| `policies/testing.md` | Bun tests, property/model-based tests, config isolation |
| `policies/generated-artifacts.md` | Generated command docs, skills, fragments, schemas |

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

## File Locations
| Work | Location |
|------|----------|
| Commands | `src/commands/<domain>/` |
| Command routes | `src/commands/<domain>/index.ts` |
| API modules | `src/lib/api/` |
| Formatters | `src/lib/formatters/` |
| Shared command helpers | `src/lib/command.ts`, `src/lib/list-command.ts`, `src/lib/mutate-command.ts` |
| Org/project resolution | `src/lib/resolve-target.ts`, `src/lib/org-list.ts` |
| DSN detection | `src/lib/dsn/` |
| SQLite/cache code | `src/lib/db/` |
| Types and schemas | `src/types/` |
| Unit tests | `test/` mirroring `src/` |
| Property tests | `test/lib/*.property.test.ts` |
| Model-based tests | `test/lib/**/*.model-based.test.ts` |
| E2E tests | `test/e2e/` |
| Test helpers | `test/helpers.ts`, `test/model-based/helpers.ts` |
| Command doc fragments | `docs/src/fragments/commands/` |
| Generated plugin skill | `plugins/sentry-cli/skills/sentry-cli/` |

## Specs And Playbooks
- Add specs under `specs/` for material design changes, migrations, and unresolved tradeoffs.
- Add playbooks under `playbooks/` for repeatable procedures with commands and expected checks.
- Keep both short, task-scoped, and linked from this file only when broadly useful.
