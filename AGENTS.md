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
CliError (base)
├── ApiError (HTTP/API failures - status, detail, endpoint)
├── AuthError (authentication - reason: 'not_authenticated' | 'expired' | 'invalid')
├── ConfigError (configuration - suggestion?)
├── ContextError (missing context - resource, command, alternatives)
├── ResolutionError (value provided but not found - resource, headline, hint, suggestions)
├── ValidationError (input validation - field?)
├── DeviceFlowError (OAuth flow - code)
├── SeerError (Seer AI - reason: 'not_enabled' | 'no_budget' | 'ai_disabled')
└── UpgradeError (upgrade - reason: 'unknown_method' | 'network_error' | 'execution_failed' | 'version_not_found')
```

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

<!-- lore:019db03e-2dc4-71d1-8d95-5509694ff166 -->
* **@sentry/api SDK integration: type wrapping pattern and pagination helpers**: @sentry/api SDK integration: wrap SDK types at \`src/lib/api/\*.ts\` boundaries with \`as unknown as SentryX\` casts; never leak SDK types to commands. Wrappers in \`src/types/sentry.ts\` use \`Partial\<SdkType> & RequiredCore\`. \`src/lib/region.ts\` imports \`retrieveAnOrganization\` directly to avoid circular dep with api-client. \`unwrapResult\`/\`unwrapPaginatedResult\` MUST stay CLI-owned — SDK versions throw plain \`Error\`, breaking the 'all errors are CliError subclasses' invariant (see also 365e4299). Body-shape casts use \`Parameters\<typeof sdkFn>\[0]\["body"]\`.

<!-- lore:019db9ce-9dd3-7890-8797-c5f710d9b376 -->
* **apiRequestToRegion/rawApiRequest options shape — no timeout/signal/headers on the typed API**: \`ApiRequestOptions\<T>\` in \`src/lib/api/infrastructure.ts\` has only \`{ method, body, params, schema }\`. \`rawApiRequest\` adds \`headers?\`; neither exposes \`timeout\`/\`signal\`. Call sites pass \`(url, init: RequestInit)\` to authenticated fetch — never a \`Request\` (only @sentry/api SDK does). \`apiRequestToRegion\` auto-sets JSON Content-Type and \`JSON.stringify\`s body; \`rawApiRequest\` preserves string bodies, only sets JSON Content-Type when body is object and caller didn't provide one. 204/205 throw \`ApiError\` rather than crashing on \`response.json()\` — bulk-mutate callers must catch.

<!-- lore:019d0804-a0cc-7e78-b3bc-d3d790b2d0f2 -->
* **Completion fast-path skips Sentry SDK via SENTRY\_CLI\_NO\_TELEMETRY and SQLite telemetry queue**: Shell completions (\`\_\_complete\`) set \`SENTRY\_CLI\_NO\_TELEMETRY=1\` in \`bin.ts\` before any imports, skipping \`createTracedDatabase\` and avoiding \`@sentry/node-core/light\` load (~85ms). Completion timing queued to \`completion\_telemetry\_queue\` SQLite table (~1ms); normal runs drain via \`DELETE FROM ... RETURNING\` and emit as \`Sentry.metrics.distribution\`. Achieves ~60ms dev / ~140ms CI within 200ms e2e budget.

<!-- lore:019da076-2cd3-716c-82ff-1779d8f4cab7 -->
* **Fuzzy recovery auto-resolves dash/underscore slug mismatches without original-slug fallback**: Display-name project input (contains spaces) skips slug lookup, goes to name-based fuzzy search across four resolution sites: \`resolveProjectBySlug\`, \`resolveOrgProjectTarget\` (project-search), \`org-list.ts#handleProjectSearch\`, \`project/list.ts#handleProjectNotFound\`. \`parseOrgProjectArg\` detects spaces via \`looksLikeDisplayName()\` and sets \`originalSlug\` on \`project-search\`; sites check \`isDisplayName = originalSlug !== undefined\` and skip \`findProjectsBySlug\` (404s on URL-encoded spaces), going directly to \`triageProjectNotFound\` → \`findSimilarProjectsAcrossOrgs\`. \*\*Critical\*\*: recursive fuzzy recovery calls must NOT pass \`originalSlug\` — otherwise the recovered slug also skips lookup, causing infinite skip→empty→not-found loop.

<!-- lore:019da04c-1a08-75b9-a752-fd32ac2db73a -->
* **Project cache is org-scoped with three key formats and three population paths**: \`project\_cache\` SQLite table uses three key shapes: \`{orgId}:{projectId}\` (DSN resolution), \`dsn:{publicKey}\` (DSN without orgId), \`list:{orgSlug}/{projectSlug}\` (batch from API). Helpers: \`getCachedProject\`, \`getCachedProjectByDsnKey\`, \`getCachedProjectsForOrg\` (completions), \`getCachedProjectBySlug\` (queries all three shapes for hot-path slug lookups; used by \`fetchProjectId\` to skip \`GET /projects/{org}/{project}/\`). Population paths: DSN resolution in resolve-target.ts, \`listProjects()\` batch via \`cacheProjectsForOrg\`, \`fetchProjectId\` seeds on API success. Resolution errors use live API via \`findSimilarProjectsAcrossOrgs\` — no cross-org cache search.

<!-- lore:019c8b60-d221-718a-823b-7c2c6e4ca1d5 -->
* **Sentry API: events require org+project, issues have legacy global endpoint**: Sentry API scoping/auth quirks: (1) Events require org+project (\`/projects/{org}/{project}/events/{id}/\`); issues use legacy global \`/api/0/issues/{id}/\`; traces need only org. Cross-project search via Discover \`/organizations/{org}/events/?query=id:{eventId}\`. (2) \`/users/me/\` returns 403 for OAuth tokens — use \`/auth/\` instead (all token types, control silo). \`getControlSiloUrl()\` routes; \`SentryUserSchema\` uses \`.passthrough()\` since \`/auth/\` only requires \`id\`. (3) Chunk upload endpoint returns camelCase (\`chunkSize\`, \`chunksPerRequest\`, \`maxRequestSize\`, \`hashAlgorithm\`); \`AssembleResponse\` also camelCase — exception to snake\_case convention.

<!-- lore:019cb6ab-ab98-7a9c-a25f-e154a5adbbe1 -->
* **Sentry CLI authenticated fetch architecture with response caching**: Authenticated fetch (\`createAuthenticatedFetch\` in \`src/lib/sentry-client.ts\`): auth headers, 30s \`REQUEST\_TIMEOUT\_MS\`, retry max 2, 401 refresh, span tracing. Dual input: SDK \`Request\` vs \`(url, init)\`. \`buildAttemptFactory\` yields fresh \`(input, init)\` per attempt; \`Request\` clones; \`FormData\`/\`Blob\`/\`URLSearchParams\` pass through. Only bare \`ReadableStream\` needs materialization. Do NOT materialize FormData — strips multipart boundary. Internal aborts tagged \`INTERNAL\_TIMEOUT\_MARKER\` Symbol; last attempt throws \`TimeoutError\`. Per-endpoint \`ENDPOINT\_TIMEOUT\_OVERRIDES\` (e.g. \`/autofix/\` 120s). Response cache: \`http-cache-semantics\` RFC 7234 at \`~/.sentry/cache/responses/\`; GET 2xx only. On 4xx/5xx, \`apiRequestToRegion\` attaches allow-listed response headers to Sentry scope as \`api\_response\_headers\` context. Cache hit invisibility solved via module-level \`lastCacheHitAgeMs\` (set on hit, cleared per-call); \`src/lib/cache-hint.ts\` provides \`formatCacheHint()\`/\`appendCacheHint()\`, wired in \`buildCommand\` only when generator returns \`CommandReturn\` (bare \`return;\` paths skip).

<!-- lore:019c8b60-d21a-7d44-8a88-729f74ec7e02 -->
* **Sentry CLI resolve-target cascade has 5 priority levels with env var support**: resolve-target.ts cascade has 5 priority levels: (1) Explicit CLI flags, (2) SENTRY\_ORG/SENTRY\_PROJECT env vars, (3) SQLite config defaults, (4) DSN auto-detection, (5) Directory name inference. SENTRY\_PROJECT supports combo notation \`org/project\` — when used, SENTRY\_ORG is ignored. If combo parse fails (e.g. \`org/\`), the entire value is discarded. \`resolveFromEnvVars()\` helper is injected into all four resolution functions.

### Decision

<!-- lore:019c9f9c-40ee-76b5-b98d-acf1e5867ebc -->
* **Issue list global limit with fair per-project distribution and representation guarantees**: \`issue list --limit\` is a global total across all detected projects. \`fetchWithBudget\` Phase 1 divides evenly, Phase 2 redistributes surplus via cursor resume. \`trimWithProjectGuarantee\` ensures ≥1 issue per project before filling remaining slots. JSON output wraps in \`{ data, hasMore }\` with optional \`errors\` array. Compound cursor (pipe-separated) enables \`-c last\` for multi-target pagination, keyed by sorted target fingerprint.

<!-- lore:019dafad-4d00-78a8-ab19-dfec857a1b35 -->
* **Prefer dedicated SQLite tables + migrations over metadata KV for non-trivial caches**: Prefer dedicated SQLite tables + migrations over \`metadata\` KV for non-trivial caches. Schema migrations are cheap — don't shoehorn structured caches into \`metadata\` with dotted-prefix keys. Dedicated tables give clearer schema, proper indexes, simpler bulk-clear, no prefix collisions. \`metadata\` KV is fine for small scalars (defaults.\*, install.\*). Example: \`issue\_org\_cache\` (schema v15) replaced \`metadata\` keys \`issue\_org.{numericId}\`. Migration pattern: bump \`CURRENT\_SCHEMA\_VERSION\`, add \`EXPECTED\_TABLES.foo\`, add \`if (currentVersion < N) db.exec(EXPECTED\_TABLES.foo)\`. HTTP response cache (URL+headers, short TTLs) can't answer structural questions like 'which org owns issue 123?' — use dedicated tables for structural/mapping questions, HTTP cache for content.

<!-- lore:019dd2cb-c698-7d62-a582-cad0c37679c4 -->
* **Top-level --help stays terse Stricli output, not branded help**: \`sentry --help\` and \`sentry -h\` MUST render Stricli's terse default template, NOT the branded help (Flags + Environment Variables sections). Agents parse \`--help\` output and branding wastes tokens. Branded help is reserved for human discovery paths: \`sentry\` (no-args, via \`defaultCommand: "help"\`) and \`sentry help\`. Do NOT add interception logic in \`src/cli.ts\` to rewrite \`--help\` → \`help\`. TTY/agent detection is not worth the complexity — agents have skills documentation; humans get the footer hint pointing to \`sentry help\`. Subcommand help (e.g. \`sentry issue --help\`) is also left to Stricli for command-specific flag rendering.

### Gotcha

<!-- lore:019dd020-57c0-7afb-b2d0-9428a5ee494d -->
* **@sentry/api SDK can return non-array data for empty/edge responses**: \`@sentry/api\` SDK (in \`node\_modules/@sentry/api/dist/index.js\`) returns \`data = {}\` (not \`\[]\`) when response body is empty, has \`Content-Length: 0\`, or status 204; and returns a \`ReadableStream\` when \`Content-Type\` is missing. \`unwrapResult\` from \`src/lib/api/infrastructure.ts\` returns \`data\` as-is, and \`as unknown as SentryX\[]\` casts silently lie. Always guard array-typed SDK results with \`Array.isArray(data)\` before \`.map()\` — applied in \`listOrganizationsInRegion\` (CLI-1CQ). Self-hosted instances behind reverse proxies (nginx, Cloudflare, WAFs) commonly trigger this by stripping bodies or wrapping responses. Throw a descriptive \`ApiError\` on mismatch rather than letting \`TypeError: x.map is not a function\` bubble up minified.

<!-- lore:019db24c-642f-7098-9b3b-8fd7a4f25084 -->
* **Bun bytecode: true crashes esbuild→compile ESM bundles (Bun 1.3.11)**: Bun build flags for compiled CLI (\`script/build.ts\`): (1) Do NOT enable \`bytecode: true\` with esbuild→\`Bun.build({ compile })\` pipeline. Still broken on Bun 1.3.13 — crashes \`TypeError: Expected CommonJS module to have a function wrapper\` at entry.instantiate (esbuild emits ESM; bytecode loader mis-caches as CJS). Exit 0, no output. Upstream: oven-sh/bun#21097, #23490. (2) Pass \`autoloadDotenv: false\` and \`autoloadBunfig: false\` — otherwise user's \`.env\`/\`bunfig.toml\` silently injects into \`process.env\` (e.g. Next.js \`.env.local\` could override stored OAuth token). Shell env vars still work; suggest direnv for dir-scoped vars.

<!-- lore:019db561-4b4f-7a8f-8489-3a0ac6c02eca -->
* **dist/bin.cjs runtime Node version check must match engines.node**: \`engines.node >=22.12\` matches Astro 6 floor. CI builds matrix \`\["22","24"]\`; docs jobs pin \`actions/setup-node@v6\` with \`node-version: "24"\` after \`setup-bun\`. The npm package's \`dist/bin.cjs\` (from \`script/bundle.ts\`) contains an inline Node guard that MUST match \`engines.node\`. Simple \`parseInt(process.versions.node) < 22\` misses 22.0.0–22.11.x — use explicit major+minor: \`let v=process.versions.node.split('.').map(Number);if(v\[0]<22||(v\[0]===22&\&v\[1]<12)){...}\`. When bumping, update BIN\_WRAPPER string AND error message in lockstep. Without \`engine-strict=true\`, npm only warns — the runtime guard is real enforcement.

<!-- lore:019cb8cc-bfa8-7dd8-8ec7-77c974fd7985 -->
* **Making clearAuth() async breaks model-based tests — use non-async Promise\<void> return instead**: Making \`clearAuth()\` \`async\` breaks fast-check model-based tests — real async yields during \`asyncModelRun\` cause \`createIsolatedDbContext\` cleanup to interleave. Keep non-async; return \`clearResponseCache().catch(...)\` directly. Model-based tests also need explicit timeouts (e.g., \`30\_000\`) — Bun's default 5s causes false failures during shrinking.

<!-- lore:019db100-5a79-7597-8e51-22b814256ec7 -->
* **script/generate-api-schema.ts regex is brittle against SDK bundler output changes**: \`script/generate-api-schema.ts\` parses \`node\_modules/@sentry/api/dist/index.js\` with a regex (\`/var (\w+) = \\(options\S\*\\) => \\(options\S\*client \\?\\? client\\)\\.(\w+)\\(/g\`) to map SDK function names to URL+method pairs, producing \`src/generated/api-schema.json\`. If the SDK changes its generator's bundle format (e.g., switches to \`const\`, arrow vs function, different client-selection pattern), schema generation silently produces empty \`fn\` fields. When bumping \`@sentry/api\`, verify \`sentry schema\` output still populates function names. \`src/generated/api-schema.json\` is gitignored — regenerates on every dev/build/typecheck via \`bun run generate:schema\`.

<!-- lore:019d79cb-18e3-73c0-92de-df632ea90932 -->
* **Source Map v3 spec allows null entries in sources array**: The Source Map v3 spec allows \`null\` entries in the \`sources\` array, and bundlers like esbuild actually produce them. Any code iterating over \`sources\` and calling string methods (e.g., \`.replaceAll()\`) must guard against null: \`map.sources.map((s) => typeof s === "string" ? s.replaceAll("\\\\", "/") : s)\`. Without the guard, \`null.replaceAll()\` throws \`TypeError\`. This applies to \`src/lib/sourcemap/debug-id.ts\` and any future sourcemap manipulation code.

<!-- lore:019db534-5784-7143-a3c0-366c4796a674 -->
* **Starlight 0.33+ route data moved from Astro.props to Astro.locals.starlightRoute**: Starlight 0.33+ / Astro 6 docs migration: (1) Route data moved from \`Astro.props\` to \`Astro.locals.starlightRoute\` — old \`Astro.props.sidebar\` is \`undefined\`. Field rename: \`slug\` → \`id\`. Import types via \`@astrojs/starlight/route-data\`. Built-in children (SiteTitle, Search, SocialIcons) take no props. \`starlight.social\` is array-form. (2) Content collections must migrate to Content Layer API: rename \`src/content/config.ts\` → \`src/content.config.ts\`, use \`docsLoader()\` + \`docsSchema()\`. Landing-page detection: \`id === ""\` (\`normalizeIndexSlug\` maps \`"index"\` → \`""\`).

### Pattern

<!-- lore:019d86a1-f6f1-758e-accf-7300b82e0163 -->
* **Bun global installs use .bun path segment for detection**: Bun global installs place scripts under \`~/.bun/install/global/node\_modules/\`. In \`detectPackageManagerFromPath()\`, check \`segments.includes('.bun')\` before npm fallback. Order: \`.pnpm\` → pnpm, \`.bun\` → bun, other \`node\_modules\` → npm. Yarn classic shares npm layout so falls through — acceptable because path detection is \*\*fallback\*\* after subprocess calls (which identify yarn correctly). Path detection must NOT override stored DB info, only serve as fallback when subprocess fails (e.g., Windows \`.cmd\` ENOENT).

<!-- lore:019dafad-4cf4-7b5a-be7c-e8f3442c8841 -->
* **Evict-then-read pattern: return cacheEvicted flag from helpers that clear cache on 404**: When a helper function transparently evicts a stale cache entry on 404 and falls back to an unscoped call, callers holding the now-stale cached value will let it win \`??\` chains. Fix: helper must return \`{ result, cacheEvicted }\` so callers compute \`effectiveCachedValue = cacheEvicted ? null : cachedValue\` before the \`??\` fallback, and re-cache the freshly-derived value. Applied in \`fetchIssueByNumericId\` in \`src/commands/issue/utils.ts\` — both \`resolveNumericIssue\` and \`resolveShareIssue\` consume the flag. A local cached variable outliving its DB entry is the common shape of this bug; always audit post-eviction read paths.

<!-- lore:d441d9e5-3638-4b5a-8148-f88c349b8979 -->
* **Non-essential DB cache writes should be guarded with try-catch**: Non-essential DB cache writes (e.g., \`setUserInfo()\`, \`setInstallInfo()\`) must be wrapped in try-catch so a broken/read-only DB doesn't crash a command whose primary operation succeeded. Pattern: \`try { setInstallInfo(...) } catch { log.debug(...) }\`. In login.ts, \`getCurrentUser()\` failure after token save must not block auth — log warning, continue. In upgrade.ts, \`setInstallInfo\` after legacy detection is guarded same way. Exception: \`getUserRegions()\` failure should \`clearAuth()\` and fail hard (indicates invalid token). This is enforced by BugBot reviews — any \`setInstallInfo\`/\`setUserInfo\` call outside setup.ts's \`bestEffort()\` wrapper needs its own try-catch.

<!-- lore:019d2c91-bc3d-7be6-ac74-ce926182526d -->
* **Sentry CLI command docs are auto-generated from Stricli route tree with CI freshness check**: Sentry CLI command docs are auto-generated from Stricli route tree: Docs in \`docs/src/content/docs/commands/\*.md\` and skill files in \`plugins/sentry-cli/skills/sentry-cli/references/\*.md\` are generated via \`bun run generate:docs\`. Content between \`\<!-- GENERATED:START/END -->\` markers is regenerated; hand-written examples go in \`docs/src/fragments/commands/\`. CI checks \`check:command-docs\` and \`check:skill\` fail if stale. Run generators after changing command parameters/flags/docs.

<!-- lore:019ce2c5-c9a8-7219-bdb8-154ead871d27 -->
* **Stricli buildCommand output config injects json flag into func params**: Stricli command gotchas: (1) In \`func()\` handlers use \`this.stdout\`/\`this.stderr\` directly — NOT \`this.process.stdout\`. \`SentryContext\` has \`process\` and \`stdout\`/\`stderr\` as separate top-level properties; test mocks omit full \`process\` so \`this.process.stdout\` throws \`TypeError\` at runtime (TS doesn't catch). (2) \`output: { json: true, human: formatFn }\` auto-injects \`--json\`/\`--fields\` flags — type flags explicitly (\`flags: { json?: boolean }\`). Commands with interactive side effects (prompts, QR codes) should check \`flags.json\` and skip. (3) Route maps with \`defaultCommand\` blend the default command's flags into subcommand completions — completion tests must track \`hasDefaultCommand\` and skip strict subcommand-matching.

<!-- lore:019dc035-b14b-7777-b19a-433a5147c76e -->
* **Token-type classification via literal prefix match (classifySentryToken)**: Token-type classification via literal prefix match: \`src/lib/token-type.ts\` \`classifySentryToken(token)\` returns \`'org-auth-token'\` (\`sntrys\_\` prefix), \`'user-auth-token'\` (\`sntryu\_\` prefix), or \`'oauth-or-legacy'\`. Case-sensitive \`startsWith\` matches Sentry backend's \`SENTRY\_ORG\_AUTH\_TOKEN\_PREFIX\`. Use to short-circuit commands where a token type is semantically invalid (e.g. \`whoami\` with org token — \`/auth/\` rejects \`sntrys\_\`) before a confusing API failure. \`getAuthToken()\` from \`db/auth\` returns the effective token (env + DB fallback).

### Preference

<!-- lore:019cb3e6-da61-7dfe-83c2-17fe3257bece -->
* **PR workflow: address review comments, resolve threads, wait for CI**: PR workflow: (1) wait for CI; (2) check unresolved comments via \`gh api repos/.../pulls/N/comments\`; (3) fix in follow-up commits (NEVER amend a pushed commit without explicit user request + force push); (4) reply explaining fix; (5) resolve thread via \`gh api graphql resolveReviewThread\`; (6) push + re-check CI. BugBot/Seer/Warden/Cursor post new comments per-commit and often catch bugs in fix commits — re-check after each push. Dispatch a subagent review before declaring merge-ready. Branches: \`fix/\*\` or \`feat/\*\`. Style: \`Array.from(set)\` over spreads; 'allowlist' not 'whitelist'; \`arr.at(-1)\` over index math. Reviewer questions may be inquiries — confirm intent before changing. After reverts/changes affecting PR scope, update the PR description to match.
<!-- End lore-managed section -->
