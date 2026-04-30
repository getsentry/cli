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

<!-- lore:019cbeba-e4d3-748c-ad50-fe3c3d5c0a0d -->
* **Auth token env var override pattern: SENTRY\_AUTH\_TOKEN > SENTRY\_TOKEN > SQLite**: Auth in \`src/lib/db/auth.ts\` follows layered precedence: \`SENTRY\_AUTH\_TOKEN\` > \`SENTRY\_TOKEN\` > SQLite OAuth token. \`getEnvToken()\` trims env vars (empty/whitespace = unset). \`AuthSource\` tracks provenance. \`ENV\_SOURCE\_PREFIX = "env:"\` — use \`.length\` not hardcoded 4. Env tokens bypass refresh/expiry. \`isEnvTokenActive()\` guards auth commands. Logout must NOT clear stored auth when env token active. These functions stay in \`db/auth.ts\` despite not touching DB because they're tightly coupled with token retrieval.

<!-- lore:019cbaa2-e4a2-76c0-8f64-917a97ae20c5 -->
* **Consola chosen as CLI logger with Sentry createConsolaReporter integration**: Consola is the CLI logger with Sentry \`createConsolaReporter\` integration. Two reporters: FancyReporter (stderr) + Sentry structured logs. Level via \`SENTRY\_LOG\_LEVEL\`. \`buildCommand\` injects hidden \`--log-level\`/\`--verbose\` flags. \`withTag()\` creates independent instances; \`setLogLevel()\` propagates via registry. All user-facing output must use consola, not raw stderr. \`HandlerContext\` intentionally omits stderr.

<!-- lore:019dacc1-e7a1-761a-acbf-e44c3b6ccedc -->
* **DSN cache invalidation uses two-level mtime tracking (sourceMtimes + dirMtimes)**: DSN cache invalidation — two-level mtime tracking: \`sourceMtimes\` (DSN-bearing files, catches in-place edits) + \`dirMtimes\` (every walked dir, catches new files) + root mtime fast-path + 24h TTL. Dropping either map is a correctness regression. Walker emits mtimes via \`onDirectoryVisit\` hook + \`recordMtimes\` option; DSN scanner uses \`grepFiles({pattern: DSN\_PATTERN, recordMtimes: true, onDirectoryVisit})\` (~20% faster than walkFiles). \`scanCodeForFirstDsn\` stays on direct walker loop (worker init ~20ms dominates single-DSN). Invariants: \`processMatch\` must record mtime for EVERY file with host-validated DSN via \`fileHadValidDsn\` flag independent of \`seen.has(raw)\`. \`scanDirectory\` catch MUST return empty \`dirMtimes: {}\`, NOT partial map (would silently bless unvisited dirs); \`ConfigError\` re-throws.

<!-- lore:019db20c-d294-7dad-a831-66c66f6fe9b0 -->
* **Grep worker pool: binary-transferable matches + streaming dispatch in src/lib/scan/**: Grep worker pool (\`src/lib/scan/worker-pool.ts\` + \`grep-worker.js\`): lazy singleton, size \`min(8, max(2, availableParallelism()))\`. Matches encoded as \`Uint32Array\` quads \`\[pathIdx, lineNum, lineOffset, lineLength]\` + \`linePool\` string, transferred via \`postMessage(msg, \[ints.buffer])\` (~40% faster than structuredClone). Worker imported via \`with { type: 'text' }\` → \`Blob\` + \`URL.createObjectURL\`; \`new Worker(new URL(...))\` HANGS in \`bun build --compile\` binaries. FIFO \`pending\` queue per worker — per-dispatch \`addEventListener\` causes wrong-request resolution. \`ref()\`/\`unref()\` idempotent booleans, NOT refcounted — only unref when \`inflight\` drops to 0; spawn unref'd. Disable via \`SENTRY\_SCAN\_DISABLE\_WORKERS=1\`. Track dispatched/failed batches with \`Promise.allSettled\`; throw if all failed so DSN cache doesn't persist false-negatives.

<!-- lore:019dc168-adb2-7bed-900e-cab5d3716099 -->
* **Host-scoped token model: auth.host column + three-layer enforcement**: Host-scoped token model (PR #844): every token bound to issuing host via \`auth.host\` column (schema v16), lazy-migrated from boot-env. Trust established ONLY via \`sentry auth login --url\` or shell-exported \`SENTRY\_HOST\`/\`SENTRY\_URL\` at boot — \`.sentryclirc\` URL never a trust source (mtime-based freshness doesn't work: git clone resets, \`touch -t\` backdates). Three enforcement layers: (1) \`applySentryUrlContext\` throws on URL-arg mismatch; (2) \`applySentryCliRcEnvShim\` throws on rc-url mismatch (auth login/logout bypass via \`skipUrlTrustCheck\`); (3) fetch-layer \`isRequestOriginTrusted\`. Region trust: in-process Set in \`db/regions.ts\`, auto-synced by \`setOrgRegion(s)\`. \`clearTrustedHostState\` must NOT clear login anchor (breaks IAP re-auth). Login refusal scoped to \`--token\`. \`HostScopeError\` (\`src/lib/errors.ts\`) is canonical formatter with overloads \`(message)\` and \`(source, destinationUrl, tokenHost)\`; used by rc-shim, URL-arg, fetch bearer, sntrys\_ claim, OAuth refresh. E2E: pass \`--url ${ctx.serverUrl}\` to \`auth login --token\`; child \`SENTRY\_URL\` alone doesn't anchor.

<!-- lore:019dd0b5-eace-724b-88d9-66f7dd639e9f -->
* **isSentrySaasUrl vs isSaaSTrustOrigin: two intentional SaaS checks**: \`src/lib/sentry-urls.ts\` exports two SaaS-detection helpers with intentional split: (1) \`isSentrySaasUrl(url)\` — hostname-only check (\`sentry.io\` or \`\*.sentry.io\`), accepts any protocol/port. Used for routing/UX: custom-headers warning, \`getSentryBaseUrl\`/\`isSelfHosted\`, region resolution skip, telemetry \`is\_self\_hosted\` tag. (2) \`isSaaSTrustOrigin(url)\` — stricter: additionally requires \`https:\` and default port. Used for security decisions: token-host trust comparison, sentryclirc URL trust check, URL-arg trust, login refusal. Rule: hostname-only for routing/UX (don't break users behind TLS-terminating proxies with \`http://sentry.io\`); strict for credential scoping. JSDoc on \`isSentrySaasUrl\` points callers to \`isSaaSTrustOrigin\` for security contexts. Keep both implementations in sync re: hostname matching.

<!-- lore:019cd2d1-aa47-7fc1-92f9-cc6c49b19460 -->
* **Magic @ selectors resolve issues dynamically via sort-based list API queries**: Magic @ selectors resolve issues dynamically: \`@latest\`, \`@most\_frequent\` in \`parseIssueArg\` detected before \`validateResourceId\` (@ not in forbidden charset). \`SELECTOR\_MAP\` provides case-insensitive matching. \`resolveSelector\` maps to \`IssueSort\` values, calls \`listIssuesPaginated\` with \`perPage: 1\`, \`query: 'is:unresolved'\`. Supports org-prefixed: \`sentry/@latest\`. Unrecognized \`@\`-prefixed strings fall through. \`ParsedIssueArg\` union includes \`{ type: 'selector' }\`.

<!-- lore:019db56f-8bb0-78d9-b4ec-3a8b70755993 -->
* **safe-read.ts wraps isRegularFile + Bun.file().text() for FIFO-safe user-path reads**: \`src/lib/safe-read.ts\` \`safeReadFile(path, operation): Promise\<string|null>\` combines \`isRegularFile()\` + \`Bun.file().text()\` + broad error swallow (FIFO/ENOENT/EACCES/EPERM/EISDIR/ENOTDIR). Sole caller: \`apply-patchset.ts\`. \*\*Do NOT use for committed config loads\*\* — swallows EPERM/EISDIR, making \`chmod 000 .sentryclirc\` manifest as confusing 'no auth token'. For loud permission surfacing (\`tryReadSentryCliRc\`), call \`fs.promises.stat\` directly, gate on \`isFile()\`, catch only ENOENT/EACCES. \`read-files.ts\`/\`workflow-inputs.ts\` use direct stat to reuse one stat for size-gating. Test with real \`mkfifo\` + short timeout as hang detector.

<!-- lore:019d0682-eb25-77f7-ad72-02247adc597c -->
* **Sentry SDK uses @sentry/node-core/light instead of @sentry/bun to avoid OTel overhead**: Sentry SDK uses \`@sentry/node-core/light\` instead of \`@sentry/bun\` to avoid OpenTelemetry overhead (~150ms, 24MB). \`@sentry/core\` barrel patched via \`bun patch\` to remove ~32 unused exports. Gotcha: \`LightNodeClient\` hardcodes \`runtime: { name: 'node' }\` AFTER spreading options — fix by patching \`client.getOptions().runtime\` post-init (mutable ref). Transport uses Node \`http\` instead of native \`fetch\`. Upstream: getsentry/sentry-javascript#19885, #19886.

<!-- lore:019dc51c-ac39-7fb4-be48-9a378b72b19a -->
* **Sentry token formats: only sntrys\_ embeds host claim, and it's unsigned**: Sentry token formats (verified in getsentry/sentry \`orgauthtoken\_token.py\`): \`sntryu\_\<hex>\` (user auth) — no claims; \`sntrys\_\<base64(JSON{iat,url,region\_url,org})>\_\<secret>\` (org auth) — \*\*unsigned\*\*, plaintext base64, anyone can forge; \`sntrya\_\`/\`sntryi\_\` — random hex; OAuth — random, no prefix. \`sntrys\_\` payload is a UX hint, NOT verifiable; \`auth.host\` column \[\[019dc168-adb2-7bed-900e-cab5d3716099]] is strictly stronger. \`parseSntrysClaim\` in \`src/lib/token-claims.ts\` requires exactly 2 underscores, base64-decodes, requires \`iat\`, 2 KB cap, fail-open. Two consumers: (1) \`captureEnvTokenHost\` claim-first for \`sntrys\_\`: claim url > \`SENTRY\_HOST\`/\`SENTRY\_URL\` > \`DEFAULT\_SENTRY\_URL\` (defends against layered-CI \`$GITHUB\_ENV\` poisoning); for \`sntryu\_\`/OAuth, env wins (no \`SENTRY\_BOUND\_TOKEN\` protocol — narrow protection, broad UX cost). (2) \`prepareHeaders\` defense-in-depth — refuses bearer attach if request origin doesn't match claim url.

<!-- lore:019d8609-fb4e-7969-9740-cb8b36f8dfd5 -->
* **Telemetry opt-out is env-var-only — no persistent preference or DO\_NOT\_TRACK**: Telemetry opt-out priority: (1) \`SENTRY\_CLI\_NO\_TELEMETRY=1\`, (2) \`DO\_NOT\_TRACK=1\`, (3) \`metadata.defaults.telemetry\`, (4) default on. DB read try/catch wrapped (runs before DB init). Schema v13 merged \`defaults\` table into \`metadata\` KV with keys \`defaults.{org,project,telemetry,url}\`; getters/setters in \`src/lib/db/defaults.ts\`. \`sentry cli defaults\` uses variadic \`\[key, value?]\`: no args → show all; 1 arg → show key; 2 args → set; \`--clear\` without args → clear all (guarded); \`--clear key\` → clear specific. \`computeTelemetryEffective()\` returns resolved source for display.

<!-- lore:019d2be5-5a90-79c3-9268-c7a8efeaa983 -->
* **Zod schema on OutputConfig enables self-documenting JSON fields in help and SKILL.md**: Zod schema on OutputConfig enables self-documenting JSON fields: List commands register \`schema?: ZodType\` on \`OutputConfig\<T>\`. \`extractSchemaFields()\` produces \`SchemaFieldInfo\[]\` from Zod shapes. \`buildFieldsFlag()\` enriches \`--fields\` brief; \`enrichDocsWithSchema()\` appends fields to \`fullDescription\`. Schema exposed as \`\_\_jsonSchema\` on built commands — \`introspect.ts\` reads it into \`CommandInfo.jsonFields\`, \`help.ts\` and \`generate-skill.ts\` render it. For \`buildOrgListCommand\`/\`dispatchOrgScopedList\`, pass \`schema\` via \`OrgListConfig\`.

### Decision

<!-- lore:019cc2ef-9be5-722d-bc9f-b07a8197eeed -->
* **All view subcommands should use \<target> \<id> positional pattern**: All \`\* view\` subcommands use \`\<target> \<id>\` positional pattern (Intent-First Correction UX): target is optional \`org/project\`. Use opportunistic arg swapping with \`log.warn()\` when args are wrong order — when intent is unambiguous, do what they meant. Normalize at command level, keep parsers pure. Model after \`gh\` CLI. Exception: \`auth\` uses \`defaultCommand: "status"\` (no viewable entity). Routes without defaults: \`cli\`, \`sourcemap\`, \`repo\`, \`team\`, \`trial\`, \`release\`, \`dashboard/widget\`.

<!-- lore:019d20f7-717f-77a2-a71a-9fdbf1c48dea -->
* **Sentry-derived terminal color palette tuned for dual-background contrast**: Terminal color palette tuned for dual-background contrast: 10-color chart palette derived from Sentry's categorical hues (\`static/app/utils/theme/scraps/tokens/color.tsx\`), adjusted to mid-luminance for ≥3:1 contrast on both dark and light backgrounds. Adjustments: orange #FF9838→#C06F20, green #67C800→#3D8F09, yellow #FFD00E→#9E8B18, purple #5D3EB2→#8B6AC8, indigo #50219C→#7B50D0; blurple/pink/magenta unchanged; teal #228A83 added. Hex preferred over ANSI 16-color for guaranteed contrast.

### Gotcha

<!-- lore:019d89a0-cd74-701d-9069-32c97fb18e0a -->
* **AuthError constructor takes reason first, message second**: \`AuthError(reason: AuthErrorReason, message?: string)\` where \`AuthErrorReason\` is \`"not\_authenticated" | "expired" | "invalid"\`. Easy to accidentally swap args as \`new AuthError("Token expired", "expired")\` — the string \`"Token expired"\` gets assigned as \`reason\` (invalid enum value). Tests aren't type-checked (tsconfig excludes them), so TypeScript won't catch this. Correct: \`new AuthError("expired", "Token expired")\`. Default messages exist for each reason, so the second arg is often unnecessary.

<!-- lore:019dd10b-263d-76ac-90d4-a6e253ca229d -->
* **Biome noMisplacedAssertion fires on test-helper functions; use inline biome-ignore**: Biome's \`lint/suspicious/noMisplacedAssertion\` rule flags \`expect()\` calls outside \`test()\`/\`it()\` bodies, including in named helper functions used by multiple tests (e.g. \`expectTokenStored(spy, token)\`). File-level \`biome-ignore-all\` doesn't suppress this rule — must use individual \`// biome-ignore lint/suspicious/noMisplacedAssertion: \<reason>\` directly above each \`expect()\` line in the helper. Tests aren't type-checked but they ARE lint-checked, so this catches code that passes \`bun test\` but fails \`bun run lint\`.

<!-- lore:019dc573-d853-735a-aeb5-68ff49afe037 -->
* **GET response cache bypasses fetch wrapper across tests**: \`sentry-client.ts::createAuthenticatedFetch\` checks the response cache BEFORE calling fetch for GET requests. Tests that mock \`globalThis.fetch\` and assert call counts will see 0 calls if a prior test cached the same URL — the cached response is served without invoking the wrapper. Fix in test \`beforeEach\`: \`import('./response-cache.js')\` then call \`resetCacheState()\` + \`disableResponseCache()\`. Pair with \`resetAuthenticatedFetch()\` if cached fetch instance is also stale. Symptom: \`expect(fetchCalls).toHaveLength(1)\` fails with \`Received length: 0\` only when run after another test hitting the same URL; passes in isolation.

<!-- lore:019dbbe9-c6cd-75e2-893b-2b721297ef81 -->
* **Node polyfill in script/node-polyfills.ts lacks Bun.file().stat() — use node:fs/promises stat instead**: \`script/node-polyfills.ts\` shims Bun APIs for npm (Node) distribution but is INCOMPLETE — \`Bun.file(path)\` only has \`size\`, \`lastModified\`, \`exists()\`, \`text()\`, \`json()\`, \`stat()\`; NOT \`.arrayBuffer()\`, \`.stream()\`, etc. Also no \`Bun.$\` shim. Tests run under Bun natively and never exercise the polyfill, so missing shims ship undetected (CLI-1EA/1EB: \`Bun.file().stat()\` regression, 400+ events). Prefer \`node:fs/promises\` directly for file ops; \`execSync\` from \`node:child\_process\` for shell. When extending polyfill, alias Node functions via \`bind\` not wrapper closures. Mirror polyfill tests to \`test/lib/\` — \`test:unit\` globs are narrow (\`test/lib test/commands test/types\`); tests under \`test/fixtures/\`, \`test/scripts/\`, \`test/script/\` are NOT picked up by CI.

<!-- lore:019d9b86-868d-7ff4-b2a6-74fdd1c9d56e -->
* **process.stdin.isTTY unreliable in Bun — use isatty(0) and backfill for clack**: \`process.stdin.isTTY\` unreliable in Bun — use \`isatty(0)\` from \`node:tty\`. Bun's single-file binary can leave \`process.stdin.isTTY === undefined\` on TTY fds inherited via redirects like \`exec … \</dev/tty\`, even when \`isatty(0)\` returns true. \`@clack/core\` gates \`setRawMode(true)\` on \`input.isTTY\`, silently disabling raw mode. Fix: backfill \`process.stdin.isTTY = true\` when \`isatty(0)\` confirms. Debugging: \`src/lib/init/tty-diagnostics.ts\` \`dumpTtyDiagnostics(label)\` — no-op unless \`SENTRY\_INIT\_DIAGNOSTICS=1\`.

<!-- lore:019dc98f-26ac-7d1a-8a16-d262fd04c44b -->
* **runInteractiveLogin swallows errors and sets process.exitCode = 1**: \`runInteractiveLogin\` in \`src/lib/interactive-login.ts\` catches OAuth flow errors internally (device-code fetch failures, timeout, etc.) and returns falsy on failure. The login command then sets \`process.exitCode = 1\` and returns normally — the wrapped command function resolves, NOT rejects. Tests that mock fetch to throw and expect \`rejects.toThrow()\` will fail with \`resolved: Promise { \<resolved> }\`. Assert behavior via fetch-call inspection (\`fetchCalls.length > 0\`, header content) instead. \`requestDeviceCode\` requires \`SENTRY\_CLIENT\_ID\` env var — unset in tests means it throws \`ConfigError\` before any fetch fires.

<!-- lore:019cbe0d-d03e-716c-b372-b09998c07ed6 -->
* **Stricli rejects unknown flags — pre-parsed global flags must be consumed from argv**: Stricli flag parsing traps: (1) Unknown \`--flag\`s rejected — global flags parsed in \`bin.ts\` MUST be spliced from argv (check both \`--flag value\` and \`--flag=value\`). (2) \`FLAG\_NAME\_PATTERN\` requires 2+ chars after \`--\`; single-char flags like \`--x\` silently become positionals — use aliases (\`-x\` → longer name). Bit \`dashboard widget --x\`/\`--y\`. (3) \`FlagDef.hidden\` is propagated by \`extractFlags\` so \`generateCommandDoc\` filters hidden flags alongside \`help\`/\`helpAll\`; hidden \`--log-level\`/\`--verbose\` appear only in global options docs.

<!-- lore:019db0c9-9cc7-7352-b1f2-61b34b87b252 -->
* **Whole-buffer matchAll slower than split+test when aggregated over many files**: Grep/scan traps in \`src/lib/scan/\`: (1) Whole-buffer \`regex.exec\` 12× faster per-file but ~1.6× SLOWER over 10k files — early-exit at \`maxResults\` via \`mapFilesConcurrent.onResult\` wins. (2) Literal prefilter is FILE-LEVEL gate (\`indexOf\`→skip); per-line verify breaks cross-newline patterns and Unicode length-changing \`toLowerCase\` (Turkish \`İ\`→\`i̇\`). (3) Extractor \`hasTopLevelAlternation\`+\`skipGroup\` must call \`skipCharacterClass\` (PCRE \`\[]abc]\` ≠ JS empty class). (4) Wake-latch race: naive \`let notify=null; await new Promise(r=>notify=r)\` loses signals — use latched \`pendingWake\` flag. (5) \`mapFilesConcurrent\` filters \`null\` but NOT \`\[]\` — return \`null\` for no-op files. (6) \`collectGlob\`/\`collectGrep\` must NOT forward \`maxResults\` to iterator; drain uncapped, set \`truncated=true\`.

### Pattern

<!-- lore:019dc8d2-2696-77d8-bb42-7ffac9058700 -->
* **Test helpers for host-scoping security tests**: Test helpers for host-scoping security tests: \`test/helpers.ts\` provides shared utilities. \`useEnvSandbox(keys)\` registers beforeEach/afterEach to save+clear+restore env keys (do NOT use in tests that depend on preload's \`SENTRY\_AUTH\_TOKEN\`, e.g. \`sentryclirc-url-poison.test.ts\` calls \`getActiveTokenHost()\` which needs a token). \`resetHostScopingState()\` bundles \`resetEnvTokenHostForTesting\` + \`resetLoginTrustAnchorForTesting\` + \`resetTrustedRegionUrlsForTesting\` (always reset together). \`mintSntrysToken(payload)\` produces \`sntrys\_\<base64(JSON)>\_\<secret>\` test tokens matching server format (rstrip \`=\`). \`extractFetchUrl(input)\` for fetch-mock assertions. \`useTestConfigDir\` \[\[019dc573-d853-735a-aeb5-68ff49afe037]] handles config-dir isolation separately.

<!-- lore:019dd194-2e5a-7e99-a517-218d10ba9b75 -->
* **Tests calling setAuthToken must pass {host} matching the mock URL**: Host-scoping test gotchas \[\[019dc168-adb2-7bed-900e-cab5d3716099]]: (1) Tests mocking \`fetch\` with non-SaaS URLs and calling \`setAuthToken(token, ttl)\` without \`{host}\` fail with \`HostScopeError\` — token defaults to SaaS via \`captureEnvTokenHost\`. Fix: \`setAuthToken("fake", 3600, { host: "https://sentry.example.com" })\`. SaaS URLs work via equivalence. (2) For \`assertRcUrlTrusted\` tests, env-token-host snapshot must lock BEFORE rc shim mutates env: sequence is \`resetEnvTokenHostForTesting()\` → delete \`SENTRY\_HOST\`/\`SENTRY\_URL\` → \`captureEnvTokenHost()\` → \`applySentryCliRcEnvShim(testDir)\` → \`assertRcUrlTrusted(testDir)\`. Without explicit capture, lazy auto-capture reads poisoned \`SENTRY\_URL\`. (3) E2E fixture \`createE2EContext\` parent must \`setAuthToken(token, ttl, {host: serverUrl})\` matching child's \`SENTRY\_URL\`; multi-region tests need \`registerTrustedRegionUrls\` during \`listOrganizationsUncached\` before fan-out (regional mocks on different localhost ports, no SaaS equivalence). Symptom: \`HostScopeError: Refusing to send credentials\`.
<!-- End lore-managed section -->
