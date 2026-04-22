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

**Why**: Bun runs test files **sequentially in one thread** (load → run all tests → load next file). If your `afterEach` deletes the env var, the next file's module-level code reads `undefined`, causing `TypeError: The "paths[0]" property must be of type string`.

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

<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/opencode-lore) -->
## Long-term Knowledge

### Architecture

<!-- lore:019cbeba-e4d3-748c-ad50-fe3c3d5c0a0d -->
* **Auth token env var override pattern: SENTRY\_AUTH\_TOKEN > SENTRY\_TOKEN > SQLite**: Auth in \`src/lib/db/auth.ts\` follows layered precedence: \`SENTRY\_AUTH\_TOKEN\` > \`SENTRY\_TOKEN\` > SQLite OAuth token. \`getEnvToken()\` trims env vars (empty/whitespace = unset). \`AuthSource\` tracks provenance. \`ENV\_SOURCE\_PREFIX = "env:"\` — use \`.length\` not hardcoded 4. Env tokens bypass refresh/expiry. \`isEnvTokenActive()\` guards auth commands. Logout must NOT clear stored auth when env token active. These functions stay in \`db/auth.ts\` despite not touching DB because they're tightly coupled with token retrieval.

<!-- lore:019cbaa2-e4a2-76c0-8f64-917a97ae20c5 -->
* **Consola chosen as CLI logger with Sentry createConsolaReporter integration**: Consola is the CLI logger with Sentry \`createConsolaReporter\` integration. Two reporters: FancyReporter (stderr) + Sentry structured logs. Level via \`SENTRY\_LOG\_LEVEL\`. \`buildCommand\` injects hidden \`--log-level\`/\`--verbose\` flags. \`withTag()\` creates independent instances; \`setLogLevel()\` propagates via registry. All user-facing output must use consola, not raw stderr. \`HandlerContext\` intentionally omits stderr.

<!-- lore:019dacc1-e7a1-761a-acbf-e44c3b6ccedc -->
* **DSN cache invalidation uses two-level mtime tracking (sourceMtimes + dirMtimes)**: \*\*DSN cache invalidation uses two-level mtime tracking\*\*: \`sourceMtimes\` (DSN-bearing files, catches in-place edits) + \`dirMtimes\` (every walked dir, catches new files) + root mtime fast-path + 24h TTL. Dropping either map is a correctness regression. Walker emits mtimes via \`onDirectoryVisit\` hook + \`recordMtimes\` option; DSN scanner uses \`grepFiles({pattern: DSN\_PATTERN, recordMtimes: true, onDirectoryVisit})\` as full-scan pipeline (~20% faster than old walkFiles path). \`scanCodeForFirstDsn\` stays on direct walker loop — worker-pool init cost (~20ms) dominates for single-DSN. \*\*sourceMtimes invariant\*\*: \`processMatch\` must record mtime for EVERY file containing a host-validated DSN, not just deduplicated new ones — track via \`fileHadValidDsn\` flag independent of \`seen.has(raw)\`. \*\*Error-path invariant\*\*: \`scanDirectory\` catch MUST return empty \`dirMtimes: {}\`, NOT partial map from callback (would silently bless unvisited dirs). \`ConfigError\` re-throws instead.

<!-- lore:019db20c-d294-7dad-a831-66c66f6fe9b0 -->
* **Grep worker pool: binary-transferable matches + streaming dispatch in src/lib/scan/**: \*\*Grep worker pool\*\* (\`src/lib/scan/worker-pool.ts\` + \`grep-worker.js\`): lazy singleton, size \`min(8, max(2, availableParallelism()))\`. Matches encoded as \`Uint32Array\` quads \`\[pathIdx, lineNum, lineOffset, lineLength]\` + \`linePool\` string, transferred via \`postMessage(msg, \[ints.buffer])\` — ~40% faster than structuredClone. Worker imported via \`with { type: "text" }\` → \`Blob\` + \`URL.createObjectURL\`; \`new Worker(new URL(...))\` HANGS in \`bun build --compile\` binaries. \*\*FIFO \`pending\` queue per worker\*\* — per-dispatch \`addEventListener\` causes wrong-request resolution. \*\*\`ref()\`/\`unref()\` are idempotent booleans, NOT refcounted\*\* — only unref when \`inflight\` drops to 0; workers spawn unref'd so idle pool doesn't block CLI exit. Readiness-failure handler must close over its own slot, not \`pop()\`. Disable via \`SENTRY\_SCAN\_DISABLE\_WORKERS=1\`. Surface pipeline failures: track \`dispatchedBatches\`/\`failedBatches\`, \`await Promise.allSettled(dispatchPromises)\` in \`finally\`; throw if all batches failed so DSN cache doesn't persist false-negatives.

<!-- lore:019cce8d-f2c5-726e-8a04-3f48caba45ec -->
* **Input validation layer: src/lib/input-validation.ts guards CLI arg parsing**: CLI arg input validation (\`src/lib/input-validation.ts\`): Four validators — \`rejectControlChars\` (ASCII < 0x20), \`rejectPreEncoded\` (%XX), \`validateResourceId\` (rejects ?, #, %, whitespace), \`validateEndpoint\` (rejects \`..\` traversal). Applied in \`parseSlashOrgProject\`, \`parseOrgProjectArg\`, \`parseIssueArg\`, \`normalizeEndpoint\`. NOT applied in \`parseSlashSeparatedArg\` for plain IDs (may contain structural separators). Env vars and DB cache values are trusted.

<!-- lore:019cd2d1-aa47-7fc1-92f9-cc6c49b19460 -->
* **Magic @ selectors resolve issues dynamically via sort-based list API queries**: Magic @ selectors resolve issues dynamically: \`@latest\`, \`@most\_frequent\` in \`parseIssueArg\` detected before \`validateResourceId\` (@ not in forbidden charset). \`SELECTOR\_MAP\` provides case-insensitive matching. \`resolveSelector\` maps to \`IssueSort\` values, calls \`listIssuesPaginated\` with \`perPage: 1\`, \`query: 'is:unresolved'\`. Supports org-prefixed: \`sentry/@latest\`. Unrecognized \`@\`-prefixed strings fall through. \`ParsedIssueArg\` union includes \`{ type: 'selector' }\`.

<!-- lore:019d0682-eb25-77f7-ad72-02247adc597c -->
* **Sentry SDK uses @sentry/node-core/light instead of @sentry/bun to avoid OTel overhead**: Sentry SDK uses \`@sentry/node-core/light\` instead of \`@sentry/bun\` to avoid OpenTelemetry overhead (~150ms, 24MB). \`@sentry/core\` barrel patched via \`bun patch\` to remove ~32 unused exports. Gotcha: \`LightNodeClient\` hardcodes \`runtime: { name: 'node' }\` AFTER spreading options — fix by patching \`client.getOptions().runtime\` post-init (mutable ref). Transport uses Node \`http\` instead of native \`fetch\`. Upstream: getsentry/sentry-javascript#19885, #19886.

<!-- lore:019dabce-a927-7dbc-9d2d-2cd5e74805b2 -->
* **src/lib/scan/ module: policy-free file walker with IgnoreStack**: \`src/lib/scan/\` — policy-free walker + grep/glob engine. Files: \`walker.ts\` (DFS async gen; \`minDepth\`/\`maxDepth\` cap DESCENT not yield; \`timeBudgetMs\`, \`AbortSignal\`, \`onDirectoryVisit\`, \`recordMtimes\`), \`ignore.ts\` (IgnoreStack two-tier \`#rootIg\`+\`#nestedByRelDir\`), \`binary.ts\` (8KB NUL sniff + ext fast-path), \`regex.ts\` (\`(?i)\`/\`(?im)\`/\`(?U)\` → JS flags), \`grep.ts\`/\`glob.ts\` (picomatch \`{dot:true}\`). DSN policy lives in \`src/lib/dsn/scan-options.ts\`. \*\*Unification ceiling\*\*: downward tree-walker only — NOT for upward walks (\`walk-up.ts\`), single-file reads, cache sweeps, or writes. Gotchas: \`classifyFile\` short-circuits when \`cfg.extensions\` set; \`buildWalkOptions\` MUST forward \`descentHook\`+\`alwaysSkipDirs\`+\`followSymlinks\`+\`recordMtimes\`+\`clock\`; NEVER \`pLimit.clearQueue()\` (hangs) — use \`onResult\` returning \`{done:true}\`; \`path.join\`/\`relative\`/\`extname\` ~10× slower than manual string ops in hot loop; scan module trusts \`opts.path\`, caller enforces sandbox.

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

<!-- lore:019db4d8-2b12-7621-a157-12d34789fa43 -->
* **DEFAULT\_SKIP\_DIRS prunes dist/build/.next — narrow for build-output scans**: \*\*scan module walker gotchas\*\*: (1) \`DEFAULT\_SKIP\_DIRS\` in \`src/lib/scan/ignore.ts\` prunes broadly: \`node\_modules\`, VCS, plus \`dist\`, \`build\`, \`target\`, \`.next\`, \`.nuxt\`, \`.output\`, \`vendor\`, \`.gradle\`, \`.bundle\`, \`coverage\`, \`.cache\`, \`.turbo\`. When walker starts AT \`dist/\`, skip list doesn't apply to cwd itself; recursing from parent prunes. For \`sourcemap/inject.ts\`, pass narrowed \`alwaysSkipDirs: \["node\_modules"]\` + \`respectGitignore: false\` to scan build outputs. (2) When \`extensions\` is set, walker skips binary NUL-sniff entirely. (3) walkFiles migration checklist — verify 5 knobs: \`respectGitignore\` (default true), \`hidden\` (default true, include), \`alwaysSkipDirs\` (default broad), \`extensions\` (skips NUL-sniff), \`followSymlinks\` (default false). DFS order differs from files-first-then-dirs — verify no ordering contract at call sites.

<!-- lore:019dafc7-8ee7-7249-9505-5b32e66fb03c -->
* **mapFilesConcurrent skips null but not empty arrays — callers must return null for no-op**: Scan/formatter off-by-ones: (1) \`mapFilesConcurrent\` in \`src/lib/scan/concurrent.ts\` filters \`null\` but NOT empty arrays — fires \`onResult\` per empty result. Callers (e.g. \`processEntry\` in \`dsn/code-scanner.ts\`) must return \`null\` (not \`\[]\`) for no-op files (~99% of 10k-file walks). Stream variant filters both. (2) \`collectGlob\`/\`collectGrep\` must NOT forward \`maxResults\` to underlying iterator — collector drains uncapped, sets \`truncated=true\` on overshoot; forwarding stops iterator at exactly N without \`truncated\`. (3) \`filterFields\` in \`formatters/json.ts\` uses dot-notation — property tests must use \`\[a-zA-Z0-9\_]\` charset to avoid ambiguous keys with dots.

<!-- lore:019d9b86-868d-7ff4-b2a6-74fdd1c9d56e -->
* **process.stdin.isTTY unreliable in Bun — use isatty(0) and backfill for clack**: \`process.stdin.isTTY\` unreliable in Bun — use \`isatty(0)\` from \`node:tty\`. Bun's single-file binary can leave \`process.stdin.isTTY === undefined\` on TTY fds inherited via redirects like \`exec … \</dev/tty\`, even when \`isatty(0)\` returns true. \`@clack/core\` gates \`setRawMode(true)\` on \`input.isTTY\`, silently disabling raw mode. Fix: backfill \`process.stdin.isTTY = true\` when \`isatty(0)\` confirms. Debugging: \`src/lib/init/tty-diagnostics.ts\` \`dumpTtyDiagnostics(label)\` — no-op unless \`SENTRY\_INIT\_DIAGNOSTICS=1\`.

<!-- lore:019d2f4c-cd76-7f74-b75c-b279dd12014c -->
* **Spinner stdout/stderr collision: log messages inside withProgress appear on spinner line**: Spinner stdout/stderr collision: \`withProgress\` in \`src/lib/polling.ts\` writes to stdout with \`\r\x1b\[K\` (no newline); consola writes to stderr. Any \`log.info()\` called \*\*inside\*\* the callback appears on the spinner line because stderr doesn't know stdout's carriage-return position. Fix: propagate data out via return value, call \`log.info()\` \*\*after\*\* \`withProgress\` completes (finally block clears the line). Affected \`downloadBinaryToTemp\` in \`upgrade.ts\`.

<!-- lore:019cbe0d-d03e-716c-b372-b09998c07ed6 -->
* **Stricli rejects unknown flags — pre-parsed global flags must be consumed from argv**: Stricli flag parsing traps: (1) Unknown \`--flag\`s rejected — global flags parsed in \`bin.ts\` MUST be spliced from argv (check both \`--flag value\` and \`--flag=value\`). (2) \`FLAG\_NAME\_PATTERN\` requires 2+ chars after \`--\`; single-char flags like \`--x\` silently become positionals — use aliases (\`-x\` → longer name). Bit \`dashboard widget --x\`/\`--y\`. (3) \`FlagDef.hidden\` is propagated by \`extractFlags\` so \`generateCommandDoc\` filters hidden flags alongside \`help\`/\`helpAll\`; hidden \`--log-level\`/\`--verbose\` appear only in global options docs.

<!-- lore:019dab88-83ad-7dd5-8b48-78cd14a6c53c -->
* **test:unit glob only picks up test/lib, test/commands, test/types, test/isolated**: \`bun test\` script globs in \`package.json\` are narrow: \`test:unit\` = \`test/lib test/commands test/types\`, \`test:isolated\` = \`test/isolated\`, \`test:e2e\` = \`test/e2e\`. Tests placed under \`test/fixtures/\`, \`test/scripts/\`, or \`test/script/\` are NOT picked up by any standard CI script despite being valid Bun test files. Place new tests under \`test/lib/\<name>/\` to inherit coverage. Note: \`test/script/\` (singular) exists with script tests but is also outside the globs.

<!-- lore:019db0c9-9cc7-7352-b1f2-61b34b87b252 -->
* **Whole-buffer matchAll slower than split+test when aggregated over many files**: grep perf/correctness traps in \`src/lib/scan/grep.ts\`: (1) Whole-buffer \`regex.exec\` 12× faster per-file but ~1.6× SLOWER than \`split('\n')+test\` aggregated over 10k files — early-exit at \`maxResults\` via \`mapFilesConcurrent.onResult\` wins. (2) Literal prefilter is FILE-LEVEL gate (\`indexOf\` → skip), then whole-buffer exec. Per-line-verify breaks cross-newline patterns and Unicode length-changing \`toLowerCase\` (Turkish \`İ\`→\`i̇\`). Extractor handles multi-char escapes via \`escapeSequenceLength\`; \`hasTopLevelAlternation\`+\`skipGroup\` must call \`skipCharacterClass\` (PCRE \`\[]abc]\` ≠ JS empty class). (3) \`GrepOptions.multiline\` defaults \`true\` (rg/git-grep); \`compilePattern\` default stays \`false\`. (4) Wake-latch race: \`let notify=null; await new Promise(r=>notify=r)\` loses signals if producer wakes before assignment — use latched \`pendingWake\` flag.

### Pattern

<!-- lore:019db0c9-9ccf-7e02-95d5-331a64d55f81 -->
* **Bench harness with concurrency sweep + deterministic fixtures**: Bench harness (not in CI): \`script/bench.ts\` + \`script/bench-sweep.ts\`. Scripts: \`bun run bench\`, \`bench:save\` (\`.bench/baseline.json\`), \`bench:compare\` (fails >20% regression), \`bench:sweep\` (concurrency tuning). Flags: \`--size\`, \`--op\`, \`--repo \<path>\` (refuses \`--save-baseline\`), \`--runs\`, \`--warmup\`, \`--json\`. Fixtures in \`test/fixtures/bench/\` use xorshift32-seeded generator for byte-identical trees in \`os.tmpdir()/sentry-cli-bench/\`. Op labels match Sentry span names. \`withBenchDb(fn)\` scopes \`SENTRY\_CONFIG\_DIR\`; \`clearDsnDetectionCache()\` between cold iterations. \*\*CONCURRENCY\_LIMIT\*\*: sweep showed knee=availableParallelism for walker-fed workloads; pure I/O wants 16-32. Kept at \`min(16, max(2, availableParallelism()))\`.

<!-- lore:019d897a-715d-7304-ae3a-0787eaf0a3a3 -->
* **Event view cross-org fallback chain: project → org → all orgs**: Event view cross-org fallback chain: \`fetchEventWithContext\` in \`src/commands/event/view.ts\` tries (1) \`getEvent(org, project, eventId)\`, (2) \`resolveEventInOrg(org, eventId)\`, (3) \`findEventAcrossOrgs(eventId, { excludeOrgs })\`. Extracted into \`tryEventFallbacks()\` for Biome complexity limit. \`excludeOrgs\` only set when same-org search returned null (not on transient error). Both catch blocks re-throw \`AuthError\` while swallowing transient errors. Warning distinguishes same-org/different-project from different-org via \`crossOrg.org === org\`.

<!-- lore:019db0c9-9ce2-7add-9a65-f76142834f69 -->
* **PR review workflow: Cursor Bugbot + Seer + human cycle**: PR review workflow (Cursor Bugbot + Seer + human): \`gh pr checks \<N> --json state,link\` + \`gh run view --log-failed\` for CI. Unresolved threads via \`gh api graphql\` with \`reviewThreads\` query filtering \`isResolved:false\`+\`isMinimized:false\`. After fixes: reply via \`gh api repos/.../pulls/comments/\<id>/replies\` then resolve via \`resolveReviewThread\` mutation. Bots auto-resolve on detected fix. Statuses: \`UNSTABLE\`=non-blocking bots running, \`BLOCKED\`=required CI pending, \`CLEAN\`+\`MERGEABLE\`=ready. Repo is squash-merge only. Expect 4-6 rounds on subtle regex/Unicode PRs. Bugbot findings usually real but occasionally assume PCRE/Python semantics (e.g. \`\[]abc]\` is class-with-\`]\` in PCRE but empty class in JS) — verify with reproduction. Dispatch self-review subagent between rounds.

<!-- lore:019db25e-3331-732d-a22d-9ab81b0e9cd9 -->
* **Worker bodies as real .js files via text-import, not inline strings**: \*\*Worker bodies as real .js files via text-import\*\*: Prefer real \`.js\` files imported as text over inline template-literal worker sources — inline strings invisible to Biome/TypeScript. Pattern: write worker as plain JS (CJS-style \`require("node:fs")\` to avoid TLA parsing), import via \`with { type: "text" }\`, feed to \`Blob\` + \`URL.createObjectURL\`. Must be self-contained (no user imports). \*\*esbuild doesn't support \`with { type: "text" }\`\*\* — fix: \`script/text-import-plugin.ts\` intercepts via \`onResolve\`/\`onLoad\`, reads file, emits \`export default "\<contents>"\`. Shared between \`script/build.ts\` and \`script/bundle.ts\`. Bun runtime handles natively. TypeScript doesn't model the attribute — cast through \`as unknown as string\`.
<!-- End lore-managed section -->
