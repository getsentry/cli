# AGENTS.md

Guidelines for AI agents working in this codebase.

## Project Overview

**Sentry CLI** is a command-line interface for [Sentry](https://sentry.io), built with [Bun](https://bun.sh) and [Stricli](https://bloomberg.github.io/stricli/).

### Goals

- **Zero-config experience** - Auto-detect project context from DSNs in source code and env files
- **AI-powered debugging** - Integrate Seer AI for root cause analysis and fix plans
- **Developer-friendly** - Follow `gh` CLI conventions for intuitive UX
- **Agent-friendly** - JSON output and predictable behavior for AI coding agents
- **Fast** - Native binaries via Bun, SQLite caching for API responses

### Key Features

- **DSN Auto-Detection** - Scans `.env` files and source code (JS, Python, Go, Java, Ruby, PHP) to find Sentry DSNs
- **Project Root Detection** - Walks up from CWD to find project boundaries using VCS, language, and build markers
- **Directory Name Inference** - Fallback project matching using bidirectional word boundary matching
- **Multi-Region Support** - Automatic region detection with fan-out to regional APIs (us.sentry.io, de.sentry.io)
- **Monorepo Support** - Generates short aliases for multiple projects
- **Seer AI Integration** - `issue explain` and `issue plan` commands for AI analysis
- **OAuth Device Flow** - Secure authentication without browser redirects

## Cursor Rules (Important!)

Before working on this codebase, read the Cursor rules:

- **`.cursor/rules/bun-cli.mdc`** - Bun API usage, file I/O, process spawning, testing
- **`.cursor/rules/ultracite.mdc`** - Code style, formatting, linting rules

## Quick Reference: Commands

> **Note**: Always check `package.json` for the latest scripts.

```bash
# Development
bun install                              # Install dependencies
bun run dev                              # Run CLI in dev mode
bun run --env-file=.env.local src/bin.ts # Dev with env vars

# Build
bun run build                            # Build for current platform
bun run build:all                        # Build for all platforms

# Type Checking
bun run typecheck                        # Check types

# Linting & Formatting
bun run lint                             # Check for issues
bun run lint:fix                         # Auto-fix issues (run before committing)

# Testing
bun test                                 # Run all tests
bun test path/to/file.test.ts            # Run single test file
bun test --watch                         # Watch mode
bun test --filter "test name"            # Run tests matching pattern
bun run test:unit                        # Run unit tests only
bun run test:e2e                         # Run e2e tests only
```

## Rules: No Runtime Dependencies

**CRITICAL**: All packages must be in `devDependencies`, never `dependencies`. Everything is bundled at build time via esbuild. CI enforces this with `bun run check:deps`.

When adding a package, always use `bun add -d <package>` (the `-d` flag).

When the `@sentry/api` SDK provides types for an API response, import them directly from `@sentry/api` instead of creating redundant Zod schemas in `src/types/sentry.ts`.

## Rules: Use Bun APIs

**CRITICAL**: This project uses Bun as runtime. Always prefer Bun-native APIs over Node.js equivalents.

Read the full guidelines in `.cursor/rules/bun-cli.mdc`.

**Bun Documentation**: https://bun.sh/docs - Consult these docs when unsure about Bun APIs.

### Quick Bun API Reference

| Task | Use This | NOT This |
|------|----------|----------|
| Read file | `await Bun.file(path).text()` | `fs.readFileSync()` |
| Write file | `await Bun.write(path, content)` | `fs.writeFileSync()` |
| Check file exists | `await Bun.file(path).exists()` | `fs.existsSync()` |
| Spawn process | `Bun.spawn()` | `child_process.spawn()` |
| Shell commands | `Bun.$\`command\`` ⚠️ | `child_process.exec()` |
| Find executable | `Bun.which("git")` | `which` package |
| Glob patterns | `new Bun.Glob()` | `glob` / `fast-glob` packages |
| Sleep | `await Bun.sleep(ms)` | `setTimeout` with Promise |
| Parse JSON file | `await Bun.file(path).json()` | Read + JSON.parse |

**Exception**: Use `node:fs` for directory creation with permissions:
```typescript
import { mkdirSync } from "node:fs";
mkdirSync(dir, { recursive: true, mode: 0o700 });
```

**Exception**: `Bun.$` (shell tagged template) has no shim in `script/node-polyfills.ts` and will crash on the npm/node distribution. Until a shim is added, use `execSync` from `node:child_process` for shell commands that must work in both runtimes:
```typescript
import { execSync } from "node:child_process";
const result = execSync("id -u username", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
```

## Architecture

```
cli/
├── src/
│   ├── bin.ts              # Entry point
│   ├── app.ts              # Stricli application setup
│   ├── context.ts          # Dependency injection context
│   ├── commands/           # CLI commands
│   │   ├── auth/           # login, logout, refresh, status, token, whoami
│   │   ├── cli/            # defaults, feedback, fix, setup, upgrade
│   │   ├── dashboard/      # list, view, create, widget (add, edit, delete)
│   │   ├── event/          # list, view
│   │   ├── issue/          # list, view, events, explain, plan, resolve, unresolve, merge
│   │   ├── log/            # list, view
│   │   ├── org/            # list, view
│   │   ├── project/        # list, view, create, delete
│   │   ├── release/        # list, view, create, finalize, delete, deploy, deploys, set-commits, propose-version
│   │   ├── repo/           # list
│   │   ├── sourcemap/      # inject, upload
│   │   ├── span/           # list, view
│   │   ├── team/           # list
│   │   ├── trace/          # list, view, logs
│   │   ├── trial/          # list, start
│   │   ├── api.ts          # Direct API access command
│   │   ├── help.ts         # Help command
│   │   ├── init.ts         # Initialize Sentry in your project (experimental)
│   │   └── schema.ts       # Browse the Sentry API schema
│   ├── lib/                # Shared utilities
│   │   ├── command.ts      # buildCommand wrapper (telemetry + output)
│   │   ├── api-client.ts   # Barrel re-export for API modules
│   │   ├── api/            # Domain API modules
│   │   │   ├── infrastructure.ts # Shared helpers, types, raw requests
│   │   │   ├── organizations.ts
│   │   │   ├── projects.ts
│   │   │   ├── issues.ts
│   │   │   ├── events.ts
│   │   │   ├── traces.ts      # Trace + span listing
│   │   │   ├── logs.ts
│   │   │   ├── seer.ts
│   │   │   └── trials.ts
│   │   ├── region.ts       # Multi-region resolution
│   │   ├── telemetry.ts    # Sentry SDK instrumentation
│   │   ├── sentry-urls.ts  # URL builders for Sentry
│   │   ├── hex-id.ts       # Hex ID validation (32-char + 16-char span)
│   │   ├── trace-id.ts     # Trace ID validation wrapper
│   │   ├── db/             # SQLite database layer
│   │   │   ├── instance.ts     # Database singleton
│   │   │   ├── schema.ts       # Table definitions
│   │   │   ├── migration.ts    # Schema migrations
│   │   │   ├── utils.ts        # SQL helpers (upsert)
│   │   │   ├── auth.ts         # Token storage
│   │   │   ├── user.ts         # User info cache
│   │   │   ├── regions.ts      # Org→region URL cache
│   │   │   ├── defaults.ts     # Default org/project
│   │   │   ├── pagination.ts   # Cursor pagination storage
│   │   │   ├── dsn-cache.ts    # DSN resolution cache
│   │   │   ├── project-cache.ts    # Project data cache
│   │   │   ├── project-root-cache.ts # Project root cache
│   │   │   ├── project-aliases.ts  # Monorepo alias mappings
│   │   │   └── version-check.ts    # Version check cache
│   │   ├── dsn/            # DSN detection system
│   │   │   ├── detector.ts     # High-level detection API
│   │   │   ├── scanner.ts      # File scanning logic
│   │   │   ├── code-scanner.ts # Code file DSN extraction
│   │   │   ├── project-root.ts # Project root detection
│   │   │   ├── parser.ts       # DSN parsing utilities
│   │   │   ├── resolver.ts     # DSN to org/project resolution
│   │   │   ├── fs-utils.ts     # File system helpers
│   │   │   ├── env.ts          # Environment variable detection
│   │   │   ├── env-file.ts     # .env file parsing
│   │   │   ├── errors.ts       # DSN-specific errors
│   │   │   ├── types.ts        # Type definitions
│   │   │   └── languages/      # Per-language DSN extractors
│   │   │       ├── javascript.ts
│   │   │       ├── python.ts
│   │   │       ├── go.ts
│   │   │       ├── java.ts
│   │   │       ├── ruby.ts
│   │   │       └── php.ts
│   │   ├── formatters/     # Output formatting
│   │   │   ├── human.ts    # Human-readable output
│   │   │   ├── json.ts     # JSON output
│   │   │   ├── output.ts   # Output utilities
│   │   │   ├── seer.ts     # Seer AI response formatting
│   │   │   ├── colors.ts   # Terminal colors
│   │   │   ├── markdown.ts # Markdown → ANSI renderer
│   │   │   ├── trace.ts    # Trace/span formatters
│   │   │   ├── time-utils.ts # Shared time/duration utils
│   │   │   ├── table.ts    # Table rendering
│   │   │   └── log.ts      # Log entry formatting
│   │   ├── oauth.ts            # OAuth device flow
│   │   ├── errors.ts           # Error classes
│   │   ├── resolve-target.ts   # Org/project resolution
│   │   ├── resolve-issue.ts    # Issue ID resolution
│   │   ├── issue-id.ts         # Issue ID parsing utilities
│   │   ├── arg-parsing.ts      # Argument parsing helpers
│   │   ├── alias.ts            # Alias generation
│   │   ├── promises.ts         # Promise utilities
│   │   ├── polling.ts          # Polling utilities
│   │   ├── upgrade.ts          # CLI upgrade functionality
│   │   ├── version-check.ts    # Version checking
│   │   ├── browser.ts          # Open URLs in browser
│   │   ├── clipboard.ts        # Clipboard access
│   │   └── qrcode.ts           # QR code generation
│   └── types/              # TypeScript types and Zod schemas
│       ├── sentry.ts       # Sentry API types
│       ├── config.ts       # Configuration types
│       ├── oauth.ts        # OAuth types
│       └── seer.ts         # Seer AI types
├── test/                   # Test files (mirrors src/ structure)
│   ├── lib/                # Unit tests for lib/
│   │   ├── *.test.ts           # Standard unit tests
│   │   ├── *.property.test.ts  # Property-based tests
│   │   └── db/
│   │       ├── *.test.ts           # DB unit tests
│   │       └── *.model-based.test.ts # Model-based tests
│   ├── model-based/        # Model-based testing helpers
│   │   └── helpers.ts      # Isolated DB context, constants
│   ├── commands/           # Unit tests for commands/
│   ├── e2e/                # End-to-end tests
│   ├── fixtures/           # Test fixtures
│   └── mocks/              # Test mocks
├── docs/                   # Documentation site (Astro + Starlight)
├── script/                 # Build and utility scripts
├── .cursor/rules/          # Cursor AI rules (read these!)
└── biome.jsonc             # Linting config (extends ultracite)
```

## Key Patterns

### CLI Commands (Stricli)

Commands use [Stricli](https://bloomberg.github.io/stricli/docs/getting-started/principles) wrapped by `src/lib/command.ts`.

**CRITICAL**: Import `buildCommand` from `../../lib/command.js`, **NEVER** from `@stricli/core` directly — the wrapper adds telemetry, `--json`/`--fields` injection, and output rendering.

Pattern:

```typescript
import { buildCommand } from "../../lib/command.js";
import type { SentryContext } from "../../context.js";
import { CommandOutput } from "../../lib/formatters/output.js";

export const myCommand = buildCommand({
  docs: {
    brief: "Short description",
    fullDescription: "Detailed description",
  },
  output: {
    human: formatMyData,                // (data: T) => string
    jsonTransform: jsonTransformMyData, // optional: (data: T, fields?) => unknown
    jsonExclude: ["humanOnlyField"],    // optional: strip keys from JSON
  },
  parameters: {
    flags: {
      limit: { kind: "parsed", parse: Number, brief: "Max items", default: 10 },
    },
  },
  async *func(this: SentryContext, flags) {
    const data = await fetchData();
    yield new CommandOutput(data);
    return { hint: "Tip: use --json for machine-readable output" };
  },
});
```

**Key rules:**
- Functions are `async *func()` generators — yield `new CommandOutput(data)`, return `{ hint }`.
- `output.human` receives the same data object that gets serialized to JSON — no divergent-data paths.
- The wrapper auto-injects `--json` and `--fields` flags. Do NOT add your own `json` flag.
- Do NOT use `stdout.write()` or `if (flags.json)` branching — the wrapper handles it.

### Command File Structure

Command files in `src/commands/` should focus on three concerns:
1. **Argument parsing** — positional args, flags, URL detection
2. **API orchestration** — fetching data, error handling, enrichment
3. **Output dispatch** — `yield new CommandOutput(data)`

Formatting and rendering logic belongs in `src/lib/formatters/<domain>.ts`. If a command file exceeds ~400 lines, extract formatting helpers into a dedicated formatter module.

Reference: `src/lib/formatters/replay.ts` (extracted from `replay/view.ts`), `src/lib/formatters/trace.ts`, `src/lib/formatters/human.ts`.

Lint enforcement: `stderr.write()` is banned in command files (GritQL rule). Use `logger` for diagnostics and `CommandOutput` for data output.

### Route Maps (Stricli)

Route groups use Stricli's `buildRouteMap` wrapped by `src/lib/route-map.ts`.

**CRITICAL**: Import `buildRouteMap` from `../../lib/route-map.js`, **NEVER** from `@stricli/core` directly — the wrapper auto-injects standard subcommand aliases based on which route keys exist:

| Route    | Auto-aliases   |
|----------|----------------|
| `list`   | `ls`           |
| `view`   | `show`         |
| `delete` | `remove`, `rm` |
| `create` | `new`          |

Manually specified aliases in `aliases` are merged with (and take precedence over) auto-generated ones. Do NOT manually add aliases that are already in the standard set above.

```typescript
import { buildRouteMap } from "../../lib/route-map.js";

export const myRoute = buildRouteMap({
  routes: {
    list: listCommand,
    view: viewCommand,
    create: createCommand,
  },
  defaultCommand: "view",
  // No need for aliases — ls, show, and new are auto-injected.
  // Only add aliases for non-standard mappings:
  // aliases: { custom: "list" },
  docs: {
    brief: "Manage my resources",
  },
});
```

### Positional Arguments

Use `parseSlashSeparatedArg` from `src/lib/arg-parsing.ts` for the standard `[<org>/<project>/]<id>` pattern. Required identifiers (trace IDs, span IDs) should be **positional args**, not flags.

```typescript
import { parseSlashSeparatedArg, parseOrgProjectArg } from "../../lib/arg-parsing.js";

// "my-org/my-project/abc123" → { id: "abc123", targetArg: "my-org/my-project" }
const { id, targetArg } = parseSlashSeparatedArg(first, "Trace ID", USAGE_HINT);
const parsed = parseOrgProjectArg(targetArg);
// parsed.type: "auto-detect" | "explicit" | "project-search" | "org-all"
```

Reference: `span/list.ts`, `trace/view.ts`, `event/view.ts`

### Markdown Rendering

All non-trivial human output must use the markdown rendering pipeline:

- Build markdown strings with helpers: `mdKvTable()`, `colorTag()`, `escapeMarkdownCell()`, `renderMarkdown()`
- **NEVER** use raw `muted()` / chalk in output strings — use `colorTag("muted", text)` inside markdown
- Tree-structured output (box-drawing characters) that can't go through `renderMarkdown()` should use the `plainSafeMuted` pattern: `isPlainOutput() ? text : muted(text)`
- `isPlainOutput()` precedence: `SENTRY_PLAIN_OUTPUT` > `NO_COLOR` > `FORCE_COLOR` (TTY only) > `!isTTY`
- `isPlainOutput()` lives in `src/lib/formatters/plain-detect.ts` (re-exported from `markdown.ts` for compat)

Reference: `formatters/trace.ts` (`formatAncestorChain`), `formatters/human.ts` (`plainSafeMuted`)

### Create & Delete Command Standards

Mutation (create/delete) commands use shared infrastructure from `src/lib/mutate-command.ts`,
paralleling `list-command.ts` for list commands.

**Delete commands** MUST use `buildDeleteCommand()` instead of `buildCommand()`. It:
1. Auto-injects `--yes`, `--force`, `--dry-run` flags with `-y`, `-f`, `-n` aliases
2. Runs a non-interactive safety guard before `func()` — refuses to proceed if
   stdin is not a TTY and `--yes`/`--force` was not passed (dry-run bypasses)
3. Options to skip specific injections (`noForceFlag`, `noDryRunFlag`, `noNonInteractiveGuard`)

```typescript
import { buildDeleteCommand, confirmByTyping, isConfirmationBypassed, requireExplicitTarget } from "../../lib/mutate-command.js";

export const deleteCommand = buildDeleteCommand({
  // Same args as buildCommand — flags/aliases auto-injected
  async *func(this: SentryContext, flags, target) {
    requireExplicitTarget(parsed, "Entity", "sentry entity delete <target>");
    if (flags["dry-run"]) { yield preview; return; }
    if (!isConfirmationBypassed(flags)) {
      if (!await confirmByTyping(expected, promptMessage)) return;
    }
    await doDelete();
  },
});
```

**Create commands** import `DRY_RUN_FLAG` and `DRY_RUN_ALIASES` for consistent dry-run support:

```typescript
import { DRY_RUN_FLAG, DRY_RUN_ALIASES } from "../../lib/mutate-command.js";

// In parameters:
flags: { "dry-run": DRY_RUN_FLAG, team: { ... } },
aliases: { ...DRY_RUN_ALIASES, t: "team" },
```

**Key utilities** in `mutate-command.ts`:
- `isConfirmationBypassed(flags)` — true if `--yes` or `--force` is set
- `guardNonInteractive(flags)` — throws in non-interactive mode without `--yes`
- `confirmByTyping(expected, message)` — type-out confirmation prompt
- `requireExplicitTarget(parsed, entityType, usage)` — blocks auto-detect for safety
- `DESTRUCTIVE_FLAGS` / `DESTRUCTIVE_ALIASES` — spreadable bundles for manual use

### List Command Pagination

All list commands with API pagination MUST use the shared cursor-stack
infrastructure for **bidirectional** pagination (`-c next` / `-c prev`):

```typescript
import { LIST_CURSOR_FLAG } from "../../lib/list-command.js";
import {
  buildPaginationContextKey, resolveCursor,
  advancePaginationState, hasPreviousPage,
} from "../../lib/db/pagination.js";

export const PAGINATION_KEY = "my-entity-list";

// In buildCommand:
flags: { cursor: LIST_CURSOR_FLAG },
aliases: { c: "cursor" },

// In func():
const contextKey = buildPaginationContextKey("entity", `${org}/${project}`, {
  sort: flags.sort, q: flags.query,
});
const { cursor, direction } = resolveCursor(flags.cursor, PAGINATION_KEY, contextKey);
const { data, nextCursor } = await listEntities(org, project, { cursor, ... });
advancePaginationState(PAGINATION_KEY, contextKey, direction, nextCursor);
const hasPrev = hasPreviousPage(PAGINATION_KEY, contextKey);
const hasMore = !!nextCursor;
```

**Cursor stack model:** The DB stores a JSON array of page-start cursors
plus a page index. Each entry is an opaque string — plain API cursors,
compound cursors (issue list), or extended cursors with mid-page bookmarks
(dashboard list). `-c next` increments the index, `-c prev` decrements it,
`-c first` resets to 0. The stack truncates on back-then-forward to avoid
stale entries. `"last"` is a silent alias for `"next"`.

**Hint rules:** Show `-c prev` when `hasPreviousPage()` returns true.
Show `-c next` when `hasMore` is true. Include both `nextCursor` and
`hasPrev` in the JSON envelope.

**Navigation hint generation:** Use `paginationHint()` from
`src/lib/list-command.ts` to build bidirectional navigation strings.
Pass it pre-built `prevHint`/`nextHint` command strings and it returns
the combined `"Prev: X | Next: Y"` string (or single-direction, or `""`).
Do NOT assemble `navParts` arrays manually — the shared helper ensures
consistent formatting across all list commands.

```typescript
import { paginationHint } from "../../lib/list-command.js";

const nav = paginationHint({
  hasPrev,
  hasMore,
  prevHint: `sentry entity list ${org}/ -c prev`,
  nextHint: `sentry entity list ${org}/ -c next`,
});
if (items.length === 0 && nav) {
  hint = `No entities on this page. ${nav}`;
} else if (hasMore) {
  header = `Showing ${items.length} entities (more available)\n${nav}`;
} else if (nav) {
  header = `Showing ${items.length} entities\n${nav}`;
}
```

**Three abstraction levels for list commands** (prefer the highest level
that fits your use case):

1. **`buildOrgListCommand`** (team/repo list) — Fully automatic. Pagination
   hints, cursor management, JSON envelope, and human formatting are all
   handled internally. New simple org-scoped list commands should use this.

2. **`dispatchOrgScopedList` with overrides** (project/issue list) — Automatic
   for most modes; custom `"org-all"` override calls `resolveCursor` +
   `advancePaginationState` + `paginationHint` manually.

3. **`buildListCommand` with manual pagination** (trace/span/dashboard list) —
   Command manages its own pagination loop. Must call `resolveCursor`,
   `advancePaginationState`, `hasPreviousPage`, and `paginationHint` directly.

**Auto-pagination for large limits:**

When `--limit` exceeds `API_MAX_PER_PAGE` (100), list commands MUST transparently
fetch multiple pages to fill the requested limit. Cap `perPage` at
`Math.min(flags.limit, API_MAX_PER_PAGE)` and loop until `results.length >= limit`
or pages are exhausted. This matches the `listIssuesAllPages` pattern.

```typescript
const perPage = Math.min(flags.limit, API_MAX_PER_PAGE);
for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
  const { data, nextCursor } = await listPaginated(org, { perPage, cursor });
  results.push(...data);
  if (results.length >= flags.limit || !nextCursor) break;
  cursor = nextCursor;
}
```

Never pass a `per_page` value larger than `API_MAX_PER_PAGE` to the API — the
server silently caps it, causing the command to return fewer items than requested.

Reference template: `trace/list.ts`, `span/list.ts`, `dashboard/list.ts`

### ID Validation

Use shared validators from `src/lib/hex-id.ts`:
- `validateHexId(value, label)` — 32-char hex IDs (trace IDs, log IDs). Auto-strips UUID dashes.
- `validateSpanId(value)` — 16-char hex span IDs. Auto-strips dashes.
- `validateTraceId(value)` — thin wrapper around `validateHexId` in `src/lib/trace-id.ts`.

All normalize to lowercase. Throw `ValidationError` on invalid input.

### Sort Convention

Use `"date"` for timestamp-based sort (not `"time"`). Export sort types from the API layer (e.g., `SpanSortValue` from `api/traces.ts`), import in commands. This matches `issue list`, `trace list`, and `span list`.

### Generated Docs & Skills

All command docs and skill files are generated via `bun run generate:docs` (which runs `generate:command-docs` then `generate:skill`). This runs automatically as part of `dev`, `build`, `typecheck`, and `test` scripts.

- **Command docs** (`docs/src/content/docs/commands/*.md`) are **gitignored** and generated from CLI metadata + hand-written fragments in `docs/src/fragments/commands/`.
- **Skill files** (`plugins/sentry-cli/skills/sentry-cli/`) are **committed** (consumed by external plugin systems) and auto-committed by CI when stale.
- Edit fragments in `docs/src/fragments/commands/` for custom examples and guides.
- `bun run check:fragments` validates fragment ↔ route consistency.
- Positional `placeholder` values must be descriptive: `"org/project/trace-id"` not `"args"`.

### Zod Schemas for Validation

All config and API types use Zod schemas:

```typescript
import { z } from "zod";

export const MySchema = z.object({
  field: z.string(),
  optional: z.number().optional(),
});

export type MyType = z.infer<typeof MySchema>;

// Validate data
const result = MySchema.safeParse(data);
if (result.success) {
  // result.data is typed
}
```

### Type Organization

- Define Zod schemas alongside types in `src/types/*.ts`
- Key type files: `sentry.ts` (API types), `config.ts` (configuration), `oauth.ts` (auth flow), `seer.ts` (Seer AI)
- Re-export from `src/types/index.ts`
- Use `type` imports: `import type { MyType } from "../types/index.js"`

### SQL Utilities

Use the `upsert()` helper from `src/lib/db/utils.ts` to reduce SQL boilerplate:

```typescript
import { upsert, runUpsert } from "../db/utils.js";

// Generate UPSERT statement
const { sql, values } = upsert("table", { id: 1, name: "foo" }, ["id"]);
db.query(sql).run(...values);

// Or use convenience wrapper
runUpsert(db, "table", { id: 1, name: "foo" }, ["id"]);

// Exclude columns from update
const { sql, values } = upsert(
  "users",
  { id: 1, name: "Bob", created_at: now },
  ["id"],
  { excludeFromUpdate: ["created_at"] }
);
```

### Error Handling

All CLI errors extend the `CliError` base class from `src/lib/errors.ts`:

```typescript
// Error hierarchy in src/lib/errors.ts
// Exit codes are defined in the EXIT constant object — use EXIT.* constants
// when constructing errors, never hardcode numeric exit codes outside errors.ts.
CliError (base, exitCode=1)
├── HostScopeError (exitCode=13)
├── ApiError (exitCode=30 — HTTP/API failures)
├── AuthError (exitCode=10–12 by reason — 'not_authenticated' | 'expired' | 'invalid')
├── ConfigError (exitCode=20 — configuration/DSN)
├── OutputError (exitCode=60 — data rendered, but operation failed)
├── ContextError (exitCode=22 — missing context)
├── ResolutionError (exitCode=23 — value provided but not found)
├── ValidationError (exitCode=21 — input validation)
├── DeviceFlowError (exitCode=51 — OAuth flow)
├── SeerError (exitCode=40–42 by reason — 'not_enabled' | 'no_budget' | 'ai_disabled')
├── TimeoutError (exitCode=31 — operation timed out)
├── UpgradeError (exitCode=50 — upgrade failures)
└── WizardError (exitCode=61–64 by workflow step — init wizard error)
```

> Exit code ranges: 1x=auth, 2x=input/config, 3x=API/network, 4x=feature/billing,
> 5x=operations, 6x=command-specific. See `EXIT` in `src/lib/errors.ts` and
> https://cli.sentry.dev/exit-codes/ for the full reference.

**Choosing between ContextError, ResolutionError, and ValidationError:**

| Scenario | Error Class | Example |
|----------|-------------|---------|
| User **omitted** a required value | `ContextError` | No org/project provided |
| User **provided** a value that wasn't found | `ResolutionError` | Project 'cli' not found |
| User input is **malformed** | `ValidationError` | Invalid hex ID format |

**ContextError rules:**
- `command` must be a **single-line** CLI usage example (e.g., `"sentry org view <slug>"`)
- Constructor throws if `command` contains `\n` (catches misuse in tests)
- Pass `alternatives: []` when defaults are irrelevant (e.g., for missing Trace ID, Event ID)
- Use `" and "` in `resource` for plural grammar: `"Trace ID and span ID"` → "are required"

**CI enforcement:** `bun run check:errors` scans for `ContextError` with multiline commands and `CliError` with ad-hoc "Try:" strings.

```typescript
// Usage examples
throw new ContextError("Organization", "sentry org view <org-slug>");
throw new ContextError("Trace ID", "sentry trace view <trace-id>", []); // no alternatives
throw new ResolutionError("Project 'cli'", "not found", "sentry issue list <org>/cli", [
  "No project with this slug found in any accessible organization",
]);
throw new ValidationError("Invalid trace ID format", "traceId");
```

**Fuzzy suggestions in resolution errors:**

When a user-provided name/title doesn't match any entity, use `fuzzyMatch()` from
`src/lib/fuzzy.ts` to suggest similar candidates instead of listing all entities
(which can be overwhelming). Show at most 5 fuzzy matches.

Reference: `resolveDashboardId()` in `src/commands/dashboard/resolve.ts`.

### Catch Block Logging

Silent `catch` blocks are prohibited in `src/` production code. Biome's `noEmptyBlockStatements` catches syntactically empty `catch {}` blocks, but blocks with only a `return` statement and no logging are equally problematic — errors vanish silently, making debugging impossible.

Every `catch` block must either:
1. Re-throw the error
2. Log with `log.debug()` or `log.warn()` for diagnostic visibility
3. Return a fallback value **with** a `log.debug()` call explaining the suppression

```typescript
// WRONG — error vanishes silently
try { data = await fetchOptionalData(); }
catch { return []; }

// RIGHT — error is visible in debug logs
try { data = await fetchOptionalData(); }
catch (error) {
  log.debug("Failed to fetch optional data", error);
  return [];
}
```

Use `logger.withTag("command-name")` for tagged logging in command files.

### Auto-Recovery for Wrong Entity Types

When a user provides the wrong type of identifier (e.g., an issue short ID
where a trace ID is expected), commands should **auto-recover** when the
user's intent is unambiguous:

1. **Detect** the actual entity type using helpers like `looksLikeIssueShortId()`,
   `SPAN_ID_RE`, `HEX_ID_RE`, or non-hex character checks.
2. **Resolve** the input to the correct type (e.g., issue → latest event → trace ID).
3. **Warn** via `log.warn()` explaining what happened.
4. **Show** the result with a return `hint` nudging toward the correct command.

When recovery is **ambiguous or impossible**, keep the existing error but add
entity-aware suggestions (e.g., "This looks like a span ID").

**Detection helpers:**
- `looksLikeIssueShortId(value)` — uppercase dash-separated (e.g., `CLI-G5`)
- `SPAN_ID_RE.test(value)` — 16-char hex (span ID)
- `HEX_ID_RE.test(value)` — 32-char hex (trace/event/log ID)
- `/[^0-9a-f]/.test(normalized)` — non-hex characters → likely a slug/name

**Reference implementations:**
- `event/view.ts` — issue short ID → latest event redirect
- `span/view.ts` — `traceId/spanId` slash format → auto-split
- `trace/view.ts` — issue short ID → issue's trace redirect
- `hex-id.ts` — entity-aware error hints in `validateHexId`/`validateSpanId`

### Async Config Functions

All config operations are async. Always await:

```typescript
const token = await getAuthToken();
const isAuth = await isAuthenticated();
await setAuthToken(token, expiresIn);
```

### Adding New Utility Files

Before creating a new `src/lib/*.ts` utility file, check whether existing shared modules already cover your use case:

| If you need... | Check first... |
|----------------|---------------|
| Duration formatting | `src/lib/formatters/time-utils.ts` (`formatDurationCompact`, `formatDurationVerbose`) |
| Hex ID validation/normalization | `src/lib/hex-id.ts` (`validateHexId`, `tryNormalizeHexId`, `normalizeHexId`) |
| Relative time display | `src/lib/formatters/time-utils.ts` (`formatRelativeTime`) |
| Table/markdown output | `src/lib/formatters/` directory |
| Pagination | `src/lib/db/pagination.ts`, `src/lib/list-command.ts` |
| Error classes | `src/lib/errors.ts` (never create ad-hoc error types) |
| Search query building | `src/lib/search-query.ts`, `src/lib/arg-parsing.ts` |

If an existing module covers ≥80% of what you need, extend it with new exported functions rather than creating a new file. New files are appropriate when the domain is genuinely new (e.g., `replay-search.ts` for replay-specific field resolution).

Every new `src/lib/**/*.ts` file must start with a module-level JSDoc comment describing the module's purpose.

### Imports

- Use `.js` extension for local imports (ESM requirement)
- Group: external packages first, then local imports
- Use `type` keyword for type-only imports

```typescript
import { z } from "zod";
import { buildCommand } from "../../lib/command.js";
import type { SentryContext } from "../../context.js";
import { getAuthToken } from "../../lib/config.js";
```

### List Command Infrastructure

Two abstraction levels exist for list commands:

1. **`src/lib/list-command.ts`** — `buildOrgListCommand` factory + shared Stricli parameter constants (`LIST_TARGET_POSITIONAL`, `LIST_JSON_FLAG`, `LIST_CURSOR_FLAG`, `buildListLimitFlag`). Use this for simple entity lists like `team list` and `repo list`.

2. **`src/lib/org-list.ts`** — `dispatchOrgScopedList` with `OrgListConfig` and a 4-mode handler map: `auto-detect`, `explicit`, `org-all`, `project-search`. Complex commands (`project list`, `issue list`) call `dispatchOrgScopedList` with an `overrides` map directly instead of using `buildOrgListCommand`.

Key rules when writing overrides:
- Each mode handler receives a `HandlerContext<T>` with the narrowed `parsed` plus shared I/O (`stdout`, `cwd`, `flags`). Access parsed fields via `ctx.parsed.org`, `ctx.parsed.projectSlug`, etc. — no manual `Extract<>` casts needed.
- Commands with extra fields (e.g., `stderr`, `setContext`) spread the context and add them: `(ctx) => handle({ ...ctx, flags, stderr, setContext })`. Override `ctx.flags` with the command-specific flags type when needed.
- `resolveCursor()` must be called **inside** the `org-all` override closure, not before `dispatchOrgScopedList`, so that `--cursor` validation errors fire correctly for non-org-all modes.
- `handleProjectSearch` errors must use `"Project"` as the `ContextError` resource, not `config.entityName`.
- Always set `orgSlugMatchBehavior` on `dispatchOrgScopedList` to declare how bare-slug org matches are handled. Use `"redirect"` for commands where listing all entities in the org makes sense (e.g., `project list`, `team list`, `issue list`). Use `"error"` for commands where org-all redirect is inappropriate. The pre-check uses cached orgs to avoid N API calls — when the cache is cold, the handler's own org-slug check serves as a safety net (throws `ResolutionError` with a hint).

3. **Standalone list commands** (e.g., `span list`, `trace list`) that don't use org-scoped dispatch wire pagination directly in `func()`. See the "List Command Pagination" section above for the pattern.

### Project Filtering in API Calls

Different Sentry API endpoints use different project filtering mechanisms. Never apply both simultaneously:

| API Endpoint | Project filter | Helper |
|-------------|---------------|--------|
| Discover/Events (`queryEvents`) | `project:<slug>` in query string | `buildProjectQuery()` |
| Replay index (`listReplays`) | `projectSlugs` parameter | Direct parameter |
| Issue index (`listIssuesPaginated`) | `project` parameter or query string | Varies by mode |

When adding a new dataset to `explore`, verify which filtering mechanism the underlying API expects and handle it in `resolveDatasetConfig`. The `explore` command centralizes dataset-specific behavior (sort, query, fetch, field validation) in `resolveDatasetConfig` — add new datasets there rather than scattering `if (dataset === ...)` checks through the `func` body.

## Commenting & Documentation (JSDoc-first)

### Default Rule
- **Prefer JSDoc over inline comments.**
- Code should be readable without narrating what it already says.

### Required: JSDoc
Add JSDoc comments on:
- **Every exported function, class, and type** (and important internal ones).
- **Types/interfaces**: document each field/property (what it represents, units, allowed values, meaning of `null`, defaults).

Include in JSDoc:
- What it does
- Key business rules / constraints
- Assumptions and edge cases
- Side effects
- Why it exists (when non-obvious)

### Inline Comments (rare)
Inline comments are **allowed only** when they add information the code cannot express:
- **"Why"** - business reason, constraint, historical context
- **Non-obvious behavior** - surprising edge cases
- **Workarounds** - bugs in dependencies, platform quirks
- **Hardcoded values** - why hardcoded, what would break if changed

Inline comments are **NOT allowed** if they just restate the code:
```typescript
// Bad:
if (!person) // if no person  
i++          // increment i   
return result // return result 

// Good:
// Required by GDPR Article 17 - user requested deletion
await deleteUserData(userId)
```

### Prohibited Comment Styles
- **ASCII art section dividers** - Do not use decorative box-drawing characters like `─────────` to create section headers. Use standard JSDoc comments or simple `// Section Name` comments instead.

### Goal
Minimal comments, maximum clarity. Comments explain **intent and reasoning**, not syntax.

## Testing (bun:test + fast-check)

**Prefer property-based and model-based testing** over traditional unit tests. These approaches find edge cases automatically and provide better coverage with less code.

**fast-check Documentation**: https://fast-check.dev/docs/core-blocks/arbitraries/

### Testing Hierarchy (in order of preference)

1. **Model-Based Tests** - For stateful systems (database, caches, state machines)
2. **Property-Based Tests** - For pure functions, parsing, validation, transformations
3. **Unit Tests** - Only for trivial cases or when properties are hard to express

### Test File Naming

| Type | Pattern | Location |
|------|---------|----------|
| Property-based | `*.property.test.ts` | `test/lib/` |
| Model-based | `*.model-based.test.ts` | `test/lib/db/` |
| Unit tests | `*.test.ts` | `test/` (mirrors `src/`) |
| E2E tests | `*.test.ts` | `test/e2e/` |

### Test Environment Isolation (CRITICAL)

Tests that need a database or config directory **must** use `useTestConfigDir()` from `test/helpers.ts`. This helper:
- Creates a unique temp directory in `beforeEach`
- Sets `SENTRY_CONFIG_DIR` to point at it
- **Restores** (never deletes) the env var in `afterEach`
- Closes the database and cleans up temp files

**NEVER** do any of these in test files:
- `delete process.env.SENTRY_CONFIG_DIR` — This pollutes other test files that load after yours
- `const baseDir = process.env[CONFIG_DIR_ENV_VAR]!` at module scope — This captures a value that may be stale
- Manual `beforeEach`/`afterEach` that sets/deletes `SENTRY_CONFIG_DIR`

**Why**: Bun's test runner uses `--isolate --parallel` (see `test:unit` in `package.json`), so each test file runs in a fresh global environment within a worker process. That bounds most cross-file leaks to a single worker, but `process.env` is still shared within a file's lifecycle — if your `afterEach` deletes the env var, the next describe/test's module-level code (or a beforeEach that re-reads env) gets `undefined`, causing `TypeError: The "paths[0]" property must be of type string`. Also, `TEST_TMP_DIR` is namespaced by `BUN_TEST_WORKER_ID` in `test/constants.ts` so parallel workers don't wipe each other's temp state during preload.

```typescript
// CORRECT: Use the helper
import { useTestConfigDir } from "../helpers.js";

const getConfigDir = useTestConfigDir("my-test-prefix-");

// If you need the directory path in a test:
test("example", () => {
  const dir = getConfigDir();
});

// WRONG: Manual env var management
beforeEach(() => { process.env.SENTRY_CONFIG_DIR = tmpDir; });
afterEach(() => { delete process.env.SENTRY_CONFIG_DIR; }); // BUG!
```

### Property-Based Testing

Use property-based tests when verifying invariants that should hold for **any valid input**.

```typescript
import { describe, expect, test } from "bun:test";
import { constantFrom, assert as fcAssert, property, tuple } from "fast-check";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

// Define arbitraries (random data generators)
const slugArb = array(constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
  minLength: 1,
  maxLength: 15,
}).map((chars) => chars.join(""));

describe("property: myFunction", () => {
  test("is symmetric", () => {
    fcAssert(
      property(slugArb, slugArb, (a, b) => {
        // Properties should always hold regardless of input
        expect(myFunction(a, b)).toBe(myFunction(b, a));
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("round-trip: encode then decode returns original", () => {
    fcAssert(
      property(validInputArb, (input) => {
        const encoded = encode(input);
        const decoded = decode(encoded);
        expect(decoded).toEqual(input);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
```

**Good candidates for property-based testing:**
- Parsing functions (DSN, issue IDs, aliases)
- Encoding/decoding (round-trip invariant)
- Symmetric operations (a op b = b op a)
- Idempotent operations (f(f(x)) = f(x))
- Validation functions (valid inputs accepted, invalid rejected)

**See examples:** `test/lib/dsn.property.test.ts`, `test/lib/alias.property.test.ts`, `test/lib/issue-id.property.test.ts`

### Model-Based Testing

Use model-based tests for **stateful systems** where sequences of operations should maintain invariants.

```typescript
import { describe, expect, test } from "bun:test";
import {
  type AsyncCommand,
  asyncModelRun,
  asyncProperty,
  commands,
  assert as fcAssert,
} from "fast-check";
import { createIsolatedDbContext, DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

// Define a simplified model of expected state
type DbModel = {
  entries: Map<string, string>;
};

// Define commands that operate on both model and real system
class SetCommand implements AsyncCommand<DbModel, RealDb> {
  constructor(readonly key: string, readonly value: string) {}
  
  check = () => true;
  
  async run(model: DbModel, real: RealDb): Promise<void> {
    // Apply to real system
    await realSet(this.key, this.value);
    
    // Update model
    model.entries.set(this.key, this.value);
  }
  
  toString = () => `set("${this.key}", "${this.value}")`;
}

class GetCommand implements AsyncCommand<DbModel, RealDb> {
  constructor(readonly key: string) {}
  
  check = () => true;
  
  async run(model: DbModel, real: RealDb): Promise<void> {
    const realValue = await realGet(this.key);
    const expectedValue = model.entries.get(this.key);
    
    // Verify real system matches model
    expect(realValue).toBe(expectedValue);
  }
  
  toString = () => `get("${this.key}")`;
}

describe("model-based: database", () => {
  test("random sequences maintain consistency", () => {
    fcAssert(
      asyncProperty(commands(allCommandArbs), async (cmds) => {
        const cleanup = createIsolatedDbContext();
        try {
          await asyncModelRun(
            () => ({ model: { entries: new Map() }, real: {} }),
            cmds
          );
        } finally {
          cleanup();
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
```

**Good candidates for model-based testing:**
- Database operations (auth, caches, regions)
- Stateful caches with invalidation
- Systems with cross-cutting invariants (e.g., clearAuth also clears regions)

**See examples:** `test/lib/db/model-based.test.ts`, `test/lib/db/dsn-cache.model-based.test.ts`

### Test Helpers

Use `test/model-based/helpers.ts` for shared utilities:

```typescript
import { createIsolatedDbContext, DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

// Create isolated DB for each test run (prevents interference)
const cleanup = createIsolatedDbContext();
try {
  // ... test code
} finally {
  cleanup();
}

// Use consistent number of runs across tests
fcAssert(property(...), { numRuns: DEFAULT_NUM_RUNS }); // 50 runs
```

### When to Use Unit Tests

Use traditional unit tests only when:
- Testing trivial logic with obvious expected values
- Properties are difficult to express or would be tautological
- Testing error messages or specific output formatting
- Integration with external systems (E2E tests)

### Avoiding Unit/Property Test Duplication

When a `*.property.test.ts` file exists for a module, **do not add unit tests that re-check the same invariants** with hardcoded examples. Before adding a unit test, check whether the companion property file already generates random inputs for that invariant.

**Unit tests that belong alongside property tests:**
- Edge cases outside the property generator's range (e.g., self-hosted DSNs when the arbitrary only produces SaaS ones)
- Specific output format documentation (exact strings, column layouts, rendered vs plain mode)
- Concurrency/timing behavior that property tests cannot express
- Integration tests exercising multiple functions together (e.g., `writeJsonList` envelope shape)

**Unit tests to avoid when property tests exist:**
- "returns true for valid input" / "returns false for invalid input" — the property test already covers this with random inputs
- Basic round-trip assertions — property tests check `decode(encode(x)) === x` for all `x`
- Hardcoded examples of invariants like idempotency, symmetry, or subset relationships

When adding property tests for a function that already has unit tests, **remove the unit tests that become redundant**. Add a header comment to the unit test file noting which invariants live in the property file:

```typescript
/**
 * Note: Core invariants (round-trips, validation, ordering) are tested via
 * property-based tests in foo.property.test.ts. These tests focus on edge
 * cases and specific output formatting not covered by property generators.
 */
```

```typescript
import { describe, expect, test, mock } from "bun:test";

describe("feature", () => {
  test("should return specific value", async () => {
    expect(await someFunction("input")).toBe("expected output");
  });
});

// Mock modules when needed
mock.module("./some-module", () => ({
  default: () => "mocked",
}));
```

## File Locations

| What | Where |
|------|-------|
| Add new command | `src/commands/<domain>/` |
| Add API types | `src/types/sentry.ts` |
| Add config types | `src/types/config.ts` |
| Add Seer types | `src/types/seer.ts` |
| Add utility | `src/lib/` |
| Add DSN language support | `src/lib/dsn/languages/` |
| Add DB operations | `src/lib/db/` |
| Build scripts | `script/` |
| Add property tests | `test/lib/<name>.property.test.ts` |
| Add model-based tests | `test/lib/db/<name>.model-based.test.ts` |
| Add unit tests | `test/` (mirror `src/` structure) |
| Add E2E tests | `test/e2e/` |
| Test helpers | `test/model-based/helpers.ts` |
| Add documentation | `docs/src/content/docs/` |
| Hand-written command doc content | `docs/src/fragments/commands/` |

<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/loreai) -->
## Long-term Knowledge

### Architecture

<!-- lore:019df992-599e-7bad-bf86-248dfda9c24b -->
* **sentry local command uses getParsedEnvelope() for envelope item dispatch**: \`src/commands/local.ts\` receives raw Sentry envelopes via a Hono HTTP server, pushes them into a Spotlight \`MessageBuffer\<EventContainer>\`, then in the subscriber calls \`container.getParsedEnvelope()\` to get \`\[header, items\[]]\`. Each item's \`\[itemHeader, itemPayload]\` is dispatched: \`event\`/\`error\` types → \`formatErrorItem\`, \`transaction\` → \`formatTransactionItem\`, \`log\` → \`formatLogItem\` (returns multiple lines), all others fall back to a minimal \`timestamp • type\` line. Formatters are inline in \`local.ts\` and use the CLI's color helpers.

<!-- lore:019da6b7-1d7b-70b0-adf8-769712f5c577 -->
* **Issue resolve --in grammar: release + @next + @commit sentinels**: \*\*Issue resolve --in grammar + repo\_cache SQLite table\*\*: \`sentry issue resolve --in\` grammar: (a) omitted→immediate, (b) \`\<version>\`→\`inRelease\`, (c) \`@next\`→\`inNextRelease\`, (d) \`@commit\`→auto-detect git HEAD via \`src/lib/git.ts\`, (e) \`@commit:\<repo>@\<sha>\`→explicit. \`parseResolveSpec\` splits on LAST \`@\` for scoped names. API requires \`statusDetails.inCommit: {commit, repository}\` — not bare SHA. Repo matching uses \`listRepositoriesCached(org)\` (7-day SQLite cache in \`repo\_cache\` table, schema v14). Always use \`listAllRepositories\` (paginated via \`API\_MAX\_PER\_PAGE\`) — never \`listRepositories\` (silently caps ~25). \`setCachedRepos\` wrapped in try/catch so read-only DBs (macOS \`sudo brew install\`) don't crash commands.

<!-- lore:019dd1bb-5546-79b2-8034-066acf076779 -->
* **Response cache hit invisibility — synthetic Response carries no marker**: Response cache hit invisibility — synthetic Response from \`getCachedResponse()\` in \`src/lib/response-cache.ts\` is indistinguishable from network. Solved via module-level \`lastCacheHitAgeMs\`: set on hit, cleared at top of \`authenticatedFetch()\` per-call (single-process CLI = race-free). \`src/lib/cache-hint.ts\` provides \`formatCacheHint()\` (\`"cached · 3m ago · use -f to refresh"\`) and \`appendCacheHint(existingHint)\` (joins with \` | \`). Wired in \`buildCommand\` (\`src/lib/command.ts\`): \`appendCacheHint(returned?.hint)\` runs only when generator returns a \`CommandReturn\` — bare \`return;\` paths (e.g. \`--web\`) skip the hint. Same chokepoint can host future cross-cutting hint decorators. Test-only \`\_setLastCacheHitAgeForTesting(ms)\` exposes state.

<!-- lore:019ce0bb-f35d-7380-b661-8dc56f9938cf -->
* **Seer trial prompt uses middleware layering in bin.ts error handling chain**: Seer trial prompt via error middleware layering: \`bin.ts\` chain is \`main() → executeWithAutoAuth() → executeWithSeerTrialPrompt() → runCommand()\`. Seer trial prompts (\`no\_budget\`/\`not\_enabled\`) caught by inner wrapper; auth errors bubble to outer. Trial API: \`GET /api/0/customers/{org}/\` → \`productTrials\[]\` (prefer \`seerUsers\`, fallback \`seerAutofix\`). Start: \`PUT /api/0/customers/{org}/product-trial/\`. SaaS-only; self-hosted 404s gracefully. \`ai\_disabled\` excluded. \`startSeerTrial\` accepts \`category\` from trial object — don't hardcode.

### Decision

<!-- lore:019c99d5-69f2-74eb-8c86-411f8512801d -->
* **Raw markdown output for non-interactive terminals, rendered for TTY**: Markdown-first output pipeline: custom renderer in \`src/lib/formatters/markdown.ts\` walks \`marked\` tokens to produce ANSI-styled output. Commands build CommonMark using helpers (\`mdKvTable()\`, \`mdRow()\`, \`colorTag()\`, \`escapeMarkdownCell()\`, \`safeCodeSpan()\`) and pass through \`renderMarkdown()\`. \`isPlainOutput()\` precedence: \`SENTRY\_PLAIN\_OUTPUT\` > \`NO\_COLOR\` > \`FORCE\_COLOR\` > \`!isTTY\`. \`--json\` always outputs JSON. Colors defined in \`COLORS\` object in \`colors.ts\`. Tests run non-TTY so assertions match raw CommonMark; use \`stripAnsi()\` helper for rendered-mode assertions.

### Gotcha

<!-- lore:019df992-5999-7f3a-b76e-29e3b08c354b -->
* **@spotlightjs/spotlight exports only two paths — no formatter/parser access**: The \`@spotlightjs/spotlight\` package's \`exports\` map exposes only \`.\` (main server) and \`./sdk\` (buffer API). Formatter registries (\`humanFormatters\`, \`applyFormatter\`) and parser helpers (\`isErrorEvent\`, type guards) live under \`dist/server/formatters/\` and \`dist/server/parser/\` but are not in \`exports\`. Bun's strict module resolution blocks deep \`dist/\` imports at runtime. Workaround: write inline formatters using the CLI's own color system (\`muted\`, \`bold\`, \`cyan\`, etc.) following the same pattern as Spotlight's human formatters.

<!-- lore:019db57b-ba0d-7a5f-803d-f15b7a819d05 -->
* **--json schema stability: collapse=organization drops nested org fields**: --json schema + response cache gotchas: (1) \`?collapse=organization\` shrinks \`organization\` to \`{id, slug}\` — silent --json regression. \`jsonTransform\` re-hydrates \`organization.name\` via \`resolveOrgDisplayName\` against \`org\_regions\` cache. (2) \`buildCacheKey()\` normalizes URL with sorted query params, so \`invalidateCachedResponse(baseUrl)\` misses entries with query suffixes. Use \`invalidateCachedResponsesMatching(prefix)\` (raw \`startsWith()\`); \`buildApiUrl()\` always emits trailing slash → safe prefix. (3) When \`jsonTransform\` is set, \`jsonExclude\` and \`filterFields\` are NOT applied — transform must call \`filterFields(result, fields)\` and omit excluded keys itself.

<!-- lore:019dd588-df59-71ab-aad6-7453c4a99ccb -->
* **API tests must use useTestConfigDir to isolate disk response cache**: \*\*API tests must use useTestConfigDir to isolate disk response cache\*\*: Tests mocking \`globalThis.fetch\` MUST call \`useTestConfigDir()\` + \`setAuthToken()\`. \`authenticatedFetch\` checks a filesystem response cache (\`~/.sentry/cache/responses/\`) BEFORE calling fetch — without per-test dirs, test N's response is served to test N+1. TTL tiers in \`classifyUrl()\`: stable=5min, volatile=60s (issues/logs), immutable=24h (events/traces by ID). Also: \`@sentry/api\` SDK calls \`\_fetch(request)\` with no init — fall back to \`input.headers\` when \`init\` is undefined (prevents HTTP 415). SDK returns \`data={}\` for empty/204 responses — always guard with \`Array.isArray(data)\` before \`.map()\`. Use \`unwrapPaginatedResult\` (not \`unwrapResult\`) for Link header pagination.

<!-- lore:019dc095-9ce4-7fe1-89ab-12efeffddcee -->
* **Biome noUselessUndefined also rejects () => {} empty arrow callbacks**: Biome lint traps: (1) \`noUselessUndefined\` rejects \`() => undefined\` AND \`noEmptyBlockStatements\` rejects \`() => {}\` — use top-level \`function noop(): void {}\`. (2) \`noExcessiveCognitiveComplexity\` caps at 15. (3) \`expect(() => fn()).toThrow(X)\` must be one line. (4) Plugin forbids raw \`metadata\` table queries — use \`getMetadata\`/\`setMetadata\`/\`clearMetadata\`. (5) Also enforced: \`useBlockStatements\`, \`noNestedTernary\`, \`useAtIndex\`, \`noStaticOnlyClass\`, \`useSimplifiedLogicExpression\`, \`noShadow\`. Namespace imports forbidden. (6) \`useYield\` fires on \`async \*func()\` with statements but not empty bodies — only add \`biome-ignore\` to generators with statements. \`lint:fix\` differs from CI \`lint\`: auto-fix hides \`noPrecisionLoss\` on >2^53 literals, \`noIncrementDecrement\`, import ordering. Always \`bun run lint\` before pushing.

<!-- lore:019dc60a-2c2c-7d07-b583-40c5a9342101 -->
* **Bun --isolate coverage inflates LF count for files with verbose comments/JSDoc**: Bun --isolate coverage inflates LF count: under \`bun test --isolate --parallel\` (CI's \`test:unit\`), Bun's coverage instrumentation counts comments, blank lines, type annotations, and closing braces as 'executable'. E.g. \`zstd-transport.ts\` LF=165 locally → 210 under --isolate, dropping coverage 99%→78%. Workaround: trim verbose inline comments inside function bodies; move rationale to JSDoc above the function. Statement coverage stays 100% — 'missing' lines are non-executable.

<!-- lore:019e0455-945e-77ac-ac2f-ca206985387a -->
* **Bun /$bunfs/ virtual FS uses JS parser — embedded .tsx files fail on TS syntax**: \*\*Bun \`/$bunfs/\` virtual FS + Ink TUI sidecar embedding\*\*: Files embedded via \`with { type: "file" }\` run from \`/$bunfs/root/\` using a JS parser (not TypeScript) — raw \`.tsx\` crashes on \`import { type Foo }\`. Fix: pre-bundle \`.tsx\` → \`.js\` via esbuild before embedding (\`script/text-import-plugin.ts\`). \`/$bunfs/\` has no \`node\_modules\` — inline all deps; use \`createRequire\` banner for CJS deps. Only \`node:\*\` builtins external. Query strings in \`/$bunfs/\` paths cause ENOENT. Related: Ink TUI sidecar (\`ink-app.tsx\`) must be fully self-contained — main bundle must NOT import \`ink\`/\`react\` separately; call \`app.mountApp()\` from the sidecar only to avoid dual-React "Invalid hook call" errors.

<!-- lore:019dbabc-1b61-7768-ac90-e62d6464af34 -->
* **Bun 1.3.11 tty.ReadStream leaks libuv handle — process.stdin.unref is undefined**: Bun 1.3.11 macOS TTY bug: \`process.stdin\` via kqueue \`EVFILT\_READ\` fails to deliver keystrokes when fd 0 is inherited via \`exec bin \</dev/tty\` (curl|bash flow). Linux (epoll) works. Workaround: \`openSync('/dev/tty','r')\` + \`new tty.ReadStream(fd)\` routes through libuv threadpool. Lives in \`src/lib/init/stdin-reopen.ts\`, darwin-gated in \`wizard-runner.ts\` via \`using \_tty\`. Leaks libuv handle → safety net in \`init.ts\`: \`setTimeout(process.exit, 100).unref()\`. Skip under \`NODE\_ENV=test\`.

<!-- lore:019db776-111b-73db-b4ad-b762dfd4808f -->
* **MastraClient has no dispose API — use AbortController for cleanup**: MastraClient has no \`close()\`/\`dispose()\` API — cleanup via \`ClientOptions.abortSignal\` (constructor) or per-prompt \`signal\`. Without explicit abort, Bun's fetch dispatcher keep-alive sockets hold the event loop alive past natural exit. Pattern in \`src/lib/init/wizard-runner.ts\`: create \`AbortController\` per \`runWizard\`, pass \`abortSignal: controller.signal\` to \`new MastraClient(...)\`, abort via \`using \_ = { \[Symbol.dispose]: () => controller.abort() }\`. Custom \`fetch\` wrapper must preserve \`init.signal\` via spread. Tests capture \`ClientOptions\` via \`spyOn(MastraClient.prototype, 'getWorkflow').mockImplementation(function() { capturedOpts.push(this.options); ... })\`.

<!-- lore:019d0b04-ccec-7bd2-a5ca-732e7064cc1a -->
* **Multi-region fan-out: distinguish all-403 from empty orgs with hasSuccessfulRegion flag**: In \`listOrganizationsUncached\` (\`src/lib/api/organizations.ts\`), \`Promise.allSettled\` collects multi-region results. Don't use \`flatResults.length === 0\` to detect all-regions-failed — a region returning 200 OK with zero orgs pushes nothing into \`flatResults\`. Track a \`hasSuccessfulRegion\` boolean on any \`"fulfilled"\` settlement. Only re-throw 403 \`ApiError\` when \`!hasSuccessfulRegion && lastScopeError\`.
<!-- End lore-managed section -->
