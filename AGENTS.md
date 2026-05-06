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

<!-- lore:019d2c68-e14a-7bd2-aa25-4aabb481c08f -->
* **Dashboard widget interval computed from terminal width and layout before API calls**: Dashboard widget interval from terminal width: \`computeOptimalInterval()\` in \`src/lib/api/dashboards.ts\` calculates chart interval before API calls. Formula: \`colWidth = floor(layout.w / 6 \* termWidth)\`, \`chartWidth = colWidth - 4 - gutterW\`, \`idealSeconds = periodSeconds / chartWidth\`. Snaps to nearest Sentry bucket (1m–1d). \`periodToSeconds()\` parses \`"24h"\`, \`"7d"\` etc. \`queryWidgetTimeseries\` uses \`params.interval ?? widget.interval\`.

<!-- lore:019cafbb-24ad-75a3-b037-5efbe6a1e85d -->
* **DSN org prefix normalization in arg-parsing.ts**: DSN/numeric org prefix normalization — four code paths must all convert to slugs before API calls (many endpoints reject numeric org IDs with 404/403): (1) \`extractOrgIdFromHost\` strips \`o\` prefix during DSN parsing. (2) \`stripDsnOrgPrefix()\` handles user-typed \`o1081365/\` in \`parseOrgProjectArg()\`. (3) \`normalizeNumericOrg()\` in \`resolve-target.ts\` resolves bare numeric IDs via DB cache or uncached API call. (4) Dashboard's \`resolveOrgFromTarget()\` pipes through \`resolveEffectiveOrg()\`, also used by \`tryResolveRecoveryOrg()\` in hex-id-recovery.

<!-- lore:019dabe5-3eee-73a9-83b4-edc56734696a -->
* **env-registry.ts drives --help env var section + docs**: \`src/lib/env-registry.ts\` (\`ENV\_VAR\_REGISTRY\`) is the single source for all env vars the CLI honors. Entries have \`{name, description, example?, defaultValue?, installOnly?, topLevel?, briefDescription?}\`. \`topLevel: true\` + \`briefDescription\` surfaces in \`sentry --help\` Environment Variables section (via \`formatEnvVarsSection()\` in \`help.ts\`) and in \`sentry help --json\` as \`envVars\` array on the full-tree envelope. Docs generator consumes the full registry for \`configuration.md\`. When adding a new env var, add it here with \`installOnly: true\` if install-script-only. Reserve \`topLevel: true\` for core-path vars only (auth, targeting, URL, key display/logging).

<!-- lore:a1f33ceb-6116-4d29-b6d0-0dc9678e4341 -->
* **Issue list auto-pagination beyond API's 100-item cap**: Sentry API silently caps \`limit\` at 100 per request. \`listIssuesAllPages()\` auto-paginates using Link headers, bounded by MAX\_PAGINATION\_PAGES (50). \`API\_MAX\_PER\_PAGE\` constant is shared across all paginated consumers. \`--limit\` means total results everywhere (max 1000, default 25). Org-all mode uses \`fetchOrgAllIssues()\`; explicit \`--cursor\` does single-page fetch to preserve cursor chain.

<!-- lore:019d0846-17b2-7c58-9201-f5d2e255dcb0 -->
* **resolveProjectBySlug carries full projectData to avoid redundant getProject calls**: resolveProjectBySlug carries full projectData to skip redundant API calls: Returns \`{ org, project, projectData: SentryProject }\` from \`findProjectsBySlug()\`. \`ResolvedOrgProject\`/\`ResolvedTarget\` have optional \`projectData?\` (populated only in project-search path). Downstream commands use \`resolved.projectData ?? await getProject(org, project)\` to save ~500-800ms.

<!-- lore:019ca9c3-989c-7c8d-bcd0-9f308fd2c3d7 -->
* **Sentry CLI markdown-first formatting pipeline replaces ad-hoc ANSI**: Formatters build CommonMark strings; \`renderMarkdown()\` renders to ANSI for TTY or raw markdown for non-TTY. Key helpers: \`colorTag()\`, \`mdKvTable()\`, \`mdRow()\`, \`mdTableHeader()\` (\`:\` suffix = right-aligned), \`renderTextTable()\`. \`isPlainOutput()\` checks \`SENTRY\_PLAIN\_OUTPUT\` > \`NO\_COLOR\` > \`!isTTY\`. Batch path: \`formatXxxTable()\`. Streaming path: \`StreamingTable\` (TTY) or raw markdown rows (plain). Both share \`buildXxxRowCells()\`.

<!-- lore:019d3e86-a74e-7e27-92e1-8a59e43fd37f -->
* **Sentry dashboard API rejects discover/transaction-like widget types — use spans**: Sentry API dataset gotchas: (1) Events/Explore API accepts \`spans\`, \`transactions\`, \`logs\`, \`errors\`, \`discover\`; \`spansIndexed\` is INVALID (500). Valid list in \`EVENTS\_API\_DATASETS\`. (2) Dashboard \`widgetType\`: \`discover\` and \`transaction-like\` rejected as deprecated — use \`spans\`. \`WIDGET\_TYPES\` (active) vs \`ALL\_WIDGET\_TYPES\` (includes deprecated for parsing). Tests use \`error-events\` not \`discover\`. (3) \`sort\` param only on \`spans\` dataset. (4) \`tracemetrics\` uses comma-separated aggregates; only line/area/bar/table/big\_number displays.

<!-- lore:019cd2b7-bb98-730e-a0d3-ec25bfa6cf4c -->
* **Sentry issue stats field: time-series controlled by groupStatsPeriod**: Issue stats and list layout: \`stats\` depends on \`groupStatsPeriod\` (\`""\`, \`"14d"\`, \`"24h"\`, \`"auto"\`). Critical: \`count\` is period-scoped — use \`lifetime.count\` for true total. \`--compact\` is tri-state (\`optional: true\`): explicit overrides, \`undefined\` triggers \`shouldAutoCompact(rowCount)\` — compact if \`3N + 3 > termHeight\`. TREND column hidden < 100 cols. Stricli boolean flags with \`optional: true\` produce \`boolean | undefined\` enabling this auto-detect pattern.

<!-- lore:019da557-63d5-7c8a-9ce7-54e992f312ec -->
* **Sentry log IDs are UUIDv7 — enables deterministic retention checks**: Sentry log IDs are UUIDv7 (first 12 hex = ms timestamp, version char \`7\` at pos 13). Traces/event IDs are NOT v7. \`decodeUuidV7Timestamp()\` and \`ageInDaysFromUuidV7()\` in \`src/lib/hex-id.ts\` return null for non-v7, safe to call unconditionally. Enables deterministic 'past retention' messages; wired in \`recoverHexId\` and \`log/view.ts#throwNotFoundError\`. \`RETENTION\_DAYS.log = 90\` in \`src/lib/retention.ts\`; traces/events are \`null\` (plan-dependent). \`LOG\_RETENTION\_PERIOD\` is DERIVED as \`\` \`${RETENTION\_DAYS.log}d\` \`\` — never hardcode \`'90d'\`. Shared hex primitives (\`HEX\_ID\_RE\`, \`SPAN\_ID\_RE\`, \`UUID\_DASH\_RE\`, \`LEADING\_HEX\_RE\`, \`MIDDLE\_ELLIPSIS\_RE\`, \`HexEntityType\`) live in \`hex-id.ts\`.

<!-- lore:019d275c-7cf0-7e13-bdc8-10cbbdbda933 -->
* **Stricli route errors are uninterceptable — only post-run detection works**: Stricli error gaps: (1) Route failures uninterceptable — Stricli writes stderr and returns \`ExitCode.UnknownCommand\` (-5 / 251 in Bun); only post-\`run()\` \`process.exitCode\` check works. (2) \`OutputError\` calls \`process.exit()\` immediately, bypassing telemetry. (3) \`defaultCommand: 'help'\` bypasses built-in fuzzy matching — fixed by \`resolveCommandPath()\` in \`introspect.ts\` using \`fuzzyMatch()\` (up to 3 suggestions); JSON includes \`suggestions\`. (4) Plural alias detection in \`app.ts\`.

<!-- lore:019d4a08-22c3-765b-ba12-d91b29e9d497 -->
* **Three Sentry APIs for span custom attributes with different capabilities**: Three Sentry span APIs with different attribute capabilities: (1) \`/trace/{traceId}/\` — hierarchical tree; \`additional\_attributes\` enumerates requested attrs; returns \`measurements\` (zero-filled on non-browser, stripped by \`filterSpanMeasurements()\`). (2) \`/projects/{org}/{project}/trace-items/{itemId}/\` — single span full detail; ALL attributes as \`{name,type,value}\[]\` automatically. (3) \`/events/?dataset=spans\&field=X\` — list/search; explicit \`field\` params. \`--fields\` flag filters JSON output AND requests extra API fields via \`extractExtraApiFields()\`; \`FIELD\_GROUP\_ALIASES\` supports shorthand expansion.

### Decision

<!-- lore:019d799a-4809-7c54-b699-e2ae74c00227 -->
* **400 Bad Request from Sentry API indicates a CLI bug, not a user error**: Telemetry 400 convention: 400 = CLI bug (capture to Sentry), 401-499 = user error (skip). \`isUserApiError()\` uses \`> 400\` (exclusive). \`isExpectedUserError()\` guard in \`app.ts\` skips ContextError, ResolutionError, ValidationError, SeerError, 401-499 ApiErrors. Captures 400, 5xx, unknown. Skipped errors → breadcrumbs. For \`ApiError\`, call \`Sentry.setContext('api\_error', {...})\` before \`captureException\` — SDK doesn't auto-capture custom properties.

<!-- lore:019d8741-f630-751f-9e60-6843f5aabfd9 -->
* **CLI UX philosophy: auto-recover when intent is clear, warn gently**: UX principle: don't fail when intent is clear — do the intent and nudge via \`log.warn()\` to stderr. Keep errors in Sentry telemetry for visibility (e.g., SeerError for upsell tracking). Two recovery tiers: (1) auto-correct when semantics identical (AND→space), (2) auto-recover with warning when semantics differ (OR→space, warn about union→intersection). Only throw when intent can't be fulfilled. Model after \`gh\` CLI. AI agents are primary consumers constructing natural OR/AND queries.

<!-- lore:019d88f1-bfb8-7eea-adbd-a5b92f15b7e0 -->
* **Trace-related commands must handle project consistently across CLI**: Trace/log commands project scoping: \`getDetailedTrace\` accepts optional numeric \`projectId\` (not hardcoded \`-1\`); resolve slug→ID via \`getProject()\`. \`formatSimpleSpanTree\` shows orphan annotation only when \`projectFiltered\` is set. \`buildProjectQuery()\` in \`arg-parsing.ts\` prepends \`project:\<slug>\` to queries (used by \`trace/logs.ts\`, \`log/list.ts\`). Multi-project: \`--query 'project:\[cli,backend]'\`. Trace-logs endpoint (\`/organizations/{org}/trace-logs/\`) is org-scoped — uses \`resolveOrg()\`. Endpoint is PRIVATE (no \`@sentry/api\` types); hand-written \`TraceLogSchema\` in \`src/types/sentry.ts\` required.

### Gotcha

<!-- lore:019da644-b93f-776d-843d-05c3c1d3a193 -->
* **Biome lint differs between local lint:fix and CI lint**: Biome \`lint:fix\` (local) differs from CI \`lint\` — auto-fix can hide issues CI still catches: (1) \`noPrecisionLoss\` on integer literals >2^53, (2) \`noIncrementDecrement\` on \`count++\`, (3) import ordering when a named import follows non-import runtime code. Formatter rewrites multi-line imports to single-line when they fit. Always run \`bun run lint\` before pushing. Use \`for...of\` destructuring or \`i += 1\` instead of \`++\`; use \`Number(string)\` or split literals instead of \`1\_735\_689\_600\_000\_000\_001\`.

<!-- lore:019cc3e6-0cdd-7a53-9eb7-a284a3b4eb78 -->
* **Bun mock.module for node:tty requires default export and class stubs**: Bun testing gotchas: (1) \`mock.module()\` for CJS built-ins (e.g. \`node:tty\`) needs \`default\` re-export plus named exports, declared top-level BEFORE \`await import()\`; lives in \`test/isolated/\`. (2) Destructuring imports capture binding at load; verify via call-count > 0. (3) \`Bun.mmap()\` always opens PROT\_WRITE — use \`new Uint8Array(await Bun.file(path).arrayBuffer())\` for read-only. (4) Wrap \`Bun.which()\` with optional \`pathEnv\` for deterministic testing. (5) Mocking \`@sentry/node-core/light\`: \`startSpan\` must pass mock span to callback — \`startSpan: (\_, fn) => fn({ setStatus(){}, setAttribute(){}, end(){} })\`.

### Pattern

<!-- lore:019dabe5-3ef9-79c6-a712-bf83df30fe59 -->
* **403 scope extraction via api-scope.ts helpers**: \`src/lib/api-scope.ts\` \`extractRequiredScopes(detail)\` scans Sentry 403 response detail (string or structured) for scope-like tokens (e.g. \`event:read\`, \`project:admin\`). Matches free-text and structured \`required\`/\`required\_scopes\` fields. Use in 403-enrichment paths instead of hardcoded generic scope lists; fall back to generic hint only when extraction returns empty. Wired into \`issue list\` \`build403Detail()\`, \`organizations.ts\` \`enrich403Error()\`.

<!-- lore:019dafe1-a58b-777b-ab81-4a15e9c78ac0 -->
* **buildApiUrl helper for safe Sentry API URL construction**: \`buildApiUrl(regionUrl, ...segments)\` in \`src/lib/api/infrastructure.ts\` composes Sentry API URLs. Owns \`/api/0/\` prefix, trailing slash, per-segment \`encodeURIComponent\`. Safety: slugs containing \`/\` get encoded correctly. Zero segments → \`base/api/0/\`. Replaces error-prone \`${base}/api/0/organizations/${encodeURIComponent(org)}/...\` patterns. Use for all URL-composition sites in domain API modules. Since #788 (cache identity scoping), all cache invalidation prefix construction uses it. \`stripTrailingSlash\` is no longer exported.

<!-- lore:019db6f8-468a-7d4f-82e9-c19de7cd6e7e -->
* **fetchWithTimeout uses bare fetch reference for test mockability**: \`fetchWithTimeout\` in \`src/lib/sentry-client.ts\` calls \`fetch(input, ...)\` as a bare global reference — this is load-bearing for tests that swap \`globalThis.fetch\`. Do NOT refactor to capture \`fetch\` at module load (via destructuring or aliasing) — all tests using \`mockFetch()\` would silently fall through to real network. \`resetAuthenticatedFetch()\` in test \`beforeEach\` clears the authenticated-fetch singleton (for auth state), NOT the fetch mock itself. If refactoring, add explicit \`// must remain bare fetch() for test mockability\` comment.

<!-- lore:019d9cc5-4cf2-7c88-97f7-936702d81ff9 -->
* **I/O concurrency limits belong at the call site, not in generic combinators**: I/O concurrency limits belong at the call site, not in generic combinators. Pattern: module-scoped \`pLimit()\` with named constant (e.g., \`STAT\_CONCURRENCY = 32\` in \`project-root.ts\`, \`CACHE\_IO\_CONCURRENCY\` in \`response-cache.ts\`, \`pLimit(50)\` in \`code-scanner.ts\`). Keeps combinators pure, makes budget explicit at I/O boundary. stat() lighter than full reads — ~32 for stats vs ~50 for reads, well below macOS's 256 FD ceiling.

<!-- lore:019dabe5-3edd-773c-8c68-e382deb26191 -->
* **Identity-scoped response cache via fingerprint mixin**: Identity-scoped response cache: \`buildCacheKey(method, url)\` mixes in memoized \`getIdentityFingerprint()\` (MD5 of \`kind|secret\` truncated to 16 hex; CodeQL dismissed — namespacing, not auth). \`CacheEntry\` persists identity so \`invalidateCachedResponsesMatching(prefix)\` skips other identities. Invalidation centralized at \`authenticatedFetch\` in \`sentry-client.ts\` — after 2xx non-GET, runs \`computeInvalidationPrefixes(fullUrl, getApiBaseUrl())\` walking hierarchy up to \`organizations/{org}/\` plus cross-endpoint rules via \`extra\`/\`extraAbsolute\` (control-silo vs region-silo). \*\*Contract: never throws\*\* — wrapped in try/catch. \`SKIP\_INVALIDATION\_PATTERNS\` short-circuits chunk-upload/assemble. \`clearAuth()\` dynamically imports \`clearResponseCache\` to break cycle. Always use prefix-match with trailing slash; exact-match removed. URL-only hook can't decode bulk mutations with IDs in query params (e.g. \`mergeIssues\`) — invalidate per-ID at caller.

<!-- lore:019da644-b93a-777a-9b28-5cc837ff3ae8 -->
* **Isolated adapter coverage via fetch mocking in test/lib/**: To get CodeCov coverage on API-calling functions (e.g., hex-id-recovery adapters, api-client functions), write tests in \`test/lib/\*.coverage.test.ts\` or \`test/lib/\*.adapters.test.ts\` that mock \`globalThis.fetch\` via \`mockFetch()\` from \`test/helpers.js\`, call \`setAuthToken()\` + \`setOrgRegion()\` in \`beforeEach\`, and invoke the REAL function. Tests in \`test/e2e/\` or tests that stub the exports via \`spyOn\`/\`mock.module\` give ZERO coverage to the mocked function body. Use \`useTestConfigDir()\` for DB isolation. Pattern example: \`test/lib/api-client.coverage.test.ts\` and \`test/lib/hex-id-recovery.adapters.test.ts\`. Mock responses must include ALL Zod-required fields — minimal stubs fail schema validation with a noisy \`ApiError\`.

<!-- lore:019dafa7-5dde-7000-89bc-3fd2e0f1356e -->
* **Memoize identity fingerprint with test-reset hook + setAuthToken invalidation**: Memoize + test-reset pattern in src/lib/db/auth.ts: \`getIdentityFingerprint()\`, \`getAuthToken()\` (as \`cachedAuthToken\`), and the full auth row used by \`refreshToken()\` (as \`cachedAuthRow\`) are all memoized at module scope. Use wrapper-object sentinels \`{ value }\` to distinguish 'not cached' from 'cached as undefined' (logged out). Invalidate via \`reset\*Cache()\` exports at the only mutation points: \`setAuthToken()\` and \`clearAuth()\`. Safe under OAuth rotation (refresh\_token preserved) and 401 refresh (routes through setAuthToken). Tests mutating \`process.env.SENTRY\_AUTH\_TOKEN\` bypass the mutation hooks — must call reset functions manually in beforeEach and inside property-test bodies. \`useTestConfigDir\` calls all three resets in beforeEach/afterEach to prevent cross-file pollution in Bun's sequential test runner. Same memo+reset pattern mirrors \`resetUpdateNotificationState\`, \`resetCacheState\`, \`resetAuthHintState\`. Fixed N+1 SQL hits per API request (CLI-13V).

<!-- lore:019d91ea-bb02-78d4-bf11-743b99f0ba6b -->
* **Stricli parse functions can perform validation and sanitization at flag-parse time**: Stricli's \`parse\` fn on \`kind: "parsed"\` flags runs during argument parsing before \`func()\`. Can throw (including \`ValidationError\`) and log warnings. Uses: \`parseCursorFlag\`, \`sanitizeQuery\`, \`parsePeriod\` (returns \`TimeRange\`), \`parseSort\`/\`parseSortFlag\`, \`numberParser\`/\`parseLimit\`. Optional period flags: \`flags.period\` is \`TimeRange | undefined\` — commands default to \`TIME\_RANGE\_\*\` constants. \`formatTimeRangeFlag()\` converts back; \`appendPeriodHint()\` in \`time-range.ts\` encapsulates hint-building across 4+ commands.

### Preference

<!-- lore:019dafa7-5dee-7944-893b-5c5ca6e5cf92 -->
* **Code review style: BYK values brevity; trim JSDoc essays aggressively**: BYK code-review style — brevity first: terse 1-3 line JSDoc; remove comments that restate code; don't wrap try/catch around no-throw helpers (but DO wrap post-success housekeeping like cache invalidation — defense-in-depth); MD5 over HMAC for non-auth hashing; no lazy imports without documented reason. Prefer \`\[...new Set(items)]\` over hand-rolled dedupe; \`toSpliced\` over spread+new-array; spread/slice over \`.unshift()\` on returned API objects. Direct questions drive simplification ('inputs never change, why not memoize?' → memoize+reset). Dismiss CodeQL false positives via \`gh api\` with rationale. 'Centralized mechanism' → file follow-up issue, not scope creep. Implement trivial reviewer suggestions in-PR rather than deferring. Run subagent self-review on merge-ready PRs — typical yield 1-3 items (stale PR descriptions, CI-only lint, doc drift). Take bot findings (Cursor Bugbot, Seer) seriously even after self-review approval — expect 4-6 rounds on subtle Unicode/regex/error-handling PRs.
<!-- End lore-managed section -->
