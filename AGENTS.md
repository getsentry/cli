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
│   │   ├── auth/           # login, logout, status, refresh
│   │   ├── event/          # view
│   │   ├── issue/          # list, view, explain, plan
│   │   ├── org/            # list, view
│   │   ├── project/        # list, view
│   │   ├── span/           # list, view
│   │   ├── trace/          # list, view, logs
│   │   ├── log/            # list, view
│   │   ├── trial/          # list, start
│   │   ├── cli/            # fix, upgrade, feedback, setup
│   │   ├── api.ts          # Direct API access command
│   │   └── help.ts         # Help command
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

<!-- lore:019d275c-7ce8-77d4-a7d9-1d10185e0879 -->
* **commandPrefix on SentryContext enables command identity in buildCommand wrapper**: \`SentryContext.commandPrefix\` (optional \`readonly string\[]\`) is populated in \`forCommand()\` in \`context.ts\` — Stricli calls this with the full prefix (e.g., \`\["sentry", "issue", "list"]\`) before running the command. This enables the \`buildCommand\` wrapper to identify which command is executing for help recovery and telemetry. Previously, \`forCommand\` only set telemetry span names.

<!-- lore:019d2c68-e14a-7bd2-aa25-4aabb481c08f -->
* **Dashboard widget interval computed from terminal width and layout before API calls**: Dashboard chart widgets compute optimal \`interval\` before making API calls using terminal width and widget layout. Formula: \`colWidth = floor(layout.w / 6 \* termWidth)\`, \`chartWidth = colWidth - 4 - gutterW\` (~5-7), \`idealSeconds = periodSeconds / chartWidth\`. Snaps to nearest Sentry interval bucket (\`1m\`, \`5m\`, \`15m\`, \`30m\`, \`1h\`, \`4h\`, \`1d\`). Lives in \`computeOptimalInterval()\` in \`src/lib/api/dashboards.ts\`. \`periodToSeconds()\` parses \`"24h"\`, \`"7d"\` etc. The \`PERIOD\_RE\` regex is hoisted to module scope (Biome requires top-level regex). \`WidgetQueryParams\` gains optional \`interval?: string\` field; \`queryWidgetTimeseries\` uses \`params.interval ?? widget.interval\` for the API call. \`queryAllWidgets\` computes per-widget intervals using \`getTermWidth()\` logic (min 80, fallback 100).

<!-- lore:019d0b16-9777-7579-aa15-caf6603a34f5 -->
* **defaultCommand:help blocks Stricli fuzzy matching for top-level typos**: Fuzzy matching across CLI subsystems: (1) Stricli built-in Damerau-Levenshtein for subcommand/flag typos within known routes. (2) \`defaultCommand: "help"\` bypasses this for top-level typos — fixed by \`resolveCommandPath()\` in \`introspect.ts\` returning \`UnresolvedPath\` with suggestions via \`fuzzyMatch()\` from \`fuzzy.ts\` (up to 3). Covers \`sentry \<typo>\` and \`sentry help \<typo>\`. (3) \`fuzzyMatch()\` in \`complete.ts\` for tab-completion (Levenshtein+prefix+contains). (4) \`levenshtein()\` in \`platforms.ts\` for platform suggestions. (5) Plural alias detection in \`app.ts\`. JSON includes \`suggestions\` array.

<!-- lore:019cafbb-24ad-75a3-b037-5efbe6a1e85d -->
* **DSN org prefix normalization in arg-parsing.ts**: DSN org ID normalization has four code paths: (1) \`extractOrgIdFromHost\` in \`dsn/parser.ts\` strips \`o\` prefix during DSN parsing → bare \`"1081365"\`. (2) \`stripDsnOrgPrefix()\` strips \`o\` from user-typed inputs like \`o1081365/\`, applied in \`parseOrgProjectArg()\` and \`resolveEffectiveOrg()\`. (3) \`normalizeNumericOrg()\` in \`resolve-target.ts\` handles bare numeric IDs from cold-cache DSN detection — checks \`getOrgByNumericId()\` from DB cache, falls back to \`listOrganizationsUncached()\` to populate the mapping. Called from \`resolveOrg()\` step 4 (DSN auto-detect path). (4) Dashboard's \`resolveOrgFromTarget()\` pipes explicit org through \`resolveEffectiveOrg()\` for \`o\`-prefixed forms. Critical: many API endpoints reject numeric org IDs with 404/403 — always normalize to slugs before API calls.

<!-- lore:019cb38b-e327-7ec5-8fb0-9e635b2bac48 -->
* **GHCR versioned nightly tags for delta upgrade support**: GHCR nightly distribution uses three tag types: \`:nightly\` (rolling), \`:nightly-\<version>\` (immutable), \`:patch-\<version>\` (delta manifest). Delta patches use zig-bsdiff TRDIFF10 (zstd-compressed), ~50KB vs ~29MB full. Client bspatch via \`Bun.zstdDecompressSync()\`. N-1 patches only, full download fallback, SHA-256 verify, 60% size threshold. npm/Node excluded. Test mocks: use \`mockGhcrNightlyVersion()\` helper.

<!-- lore:a1f33ceb-6116-4d29-b6d0-0dc9678e4341 -->
* **Issue list auto-pagination beyond API's 100-item cap**: Sentry API silently caps \`limit\` at 100 per request. \`listIssuesAllPages()\` auto-paginates using Link headers, bounded by MAX\_PAGINATION\_PAGES (50). \`API\_MAX\_PER\_PAGE\` constant is shared across all paginated consumers. \`--limit\` means total results everywhere (max 1000, default 25). Org-all mode uses \`fetchOrgAllIssues()\`; explicit \`--cursor\` does single-page fetch to preserve cursor chain.

<!-- lore:019d0846-17b2-7c58-9201-f5d2e255dcb0 -->
* **resolveProjectBySlug carries full projectData to avoid redundant getProject calls**: \`resolveProjectBySlug()\` returns \`{ org, project, projectData: SentryProject }\` — the full project object from \`findProjectsBySlug()\`. \`ResolvedOrgProject\` and \`ResolvedTarget\` have optional \`projectData?\` (populated only in project-search path, not explicit/auto-detect). Downstream commands (\`project/view\`, \`project/delete\`, \`dashboard/create\`) use \`projectData\` when available to skip redundant \`getProject()\` API calls (~500-800ms savings). Pattern: \`resolved.projectData ?? await getProject(org, project)\` for callers that need both paths.

<!-- lore:019cb950-9b7b-731a-9832-b7f6cfb6a6a2 -->
* **Self-hosted OAuth device flow requires Sentry 26.1.0+ and SENTRY\_CLIENT\_ID**: Self-hosted OAuth device flow requires Sentry 26.1.0+ and both \`SENTRY\_URL\` and \`SENTRY\_CLIENT\_ID\` env vars. Users must create a public OAuth app in Settings → Developer Settings. The client ID is NOT optional for self-hosted. Fallback for older instances: \`sentry auth login --token\`. \`getSentryUrl()\` and \`getClientId()\` in \`src/lib/oauth.ts\` read lazily (not at module load) so URL parsing from arguments can set \`SENTRY\_URL\` after import.

<!-- lore:019ca9c3-989c-7c8d-bcd0-9f308fd2c3d7 -->
* **Sentry CLI markdown-first formatting pipeline replaces ad-hoc ANSI**: Formatters build CommonMark strings; \`renderMarkdown()\` renders to ANSI for TTY or raw markdown for non-TTY. Key helpers: \`colorTag()\`, \`mdKvTable()\`, \`mdRow()\`, \`mdTableHeader()\` (\`:\` suffix = right-aligned), \`renderTextTable()\`. \`isPlainOutput()\` checks \`SENTRY\_PLAIN\_OUTPUT\` > \`NO\_COLOR\` > \`!isTTY\`. Batch path: \`formatXxxTable()\`. Streaming path: \`StreamingTable\` (TTY) or raw markdown rows (plain). Both share \`buildXxxRowCells()\`.

<!-- lore:019d3e86-a74e-7e27-92e1-8a59e43fd37f -->
* **Sentry dashboard API rejects discover/transaction-like widget types — use spans**: The Sentry Dashboard API rejects \`widgetType: 'discover'\` and \`widgetType: 'transaction-like'\` as deprecated. Use \`widgetType: 'spans'\` for new widgets. The codebase splits types into \`WIDGET\_TYPES\` (active, for creation) and \`ALL\_WIDGET\_TYPES\` (including deprecated, for parsing server responses). \`DashboardWidgetInputSchema\` must use \`ALL\_WIDGET\_TYPES\` so editing existing widgets with deprecated types passes Zod validation. \`validateWidgetEnums()\` in \`resolve.ts\` rejects deprecated types for new widget creation — but accepts \`skipDeprecatedCheck: true\` for the edit path, where \`effectiveDataset\` may inherit a deprecated type from the existing widget. Cross-validation (display vs dataset compatibility) still runs on effective values. Tests must use \`error-events\` instead of \`discover\`; it shares \`DISCOVER\_AGGREGATE\_FUNCTIONS\` including \`failure\_rate\`.

<!-- lore:019cd2b7-bb98-730e-a0d3-ec25bfa6cf4c -->
* **Sentry issue stats field: time-series controlled by groupStatsPeriod**: Sentry issue stats and list table layout: \`stats\` key depends on \`groupStatsPeriod\` (\`""\`, \`"14d"\`, \`"24h"\`, \`"auto"\`); \`statsPeriod\` controls window. \*\*Critical\*\*: \`count\` is period-scoped — use \`lifetime.count\` for true total. Issue list uses \`groupStatsPeriod: 'auto'\` for sparklines. Columns: SHORT ID, ISSUE, SEEN, AGE, TREND, EVENTS, USERS, TRIAGE. TREND hidden < 100 cols. \`--compact\` tri-state: explicit overrides; \`undefined\` triggers \`shouldAutoCompact(rowCount)\` — compact if \`3N + 3 > termHeight\`. Height formula \`3N + 3\` (last row has no trailing separator).

<!-- lore:019ca9c3-98a2-7a81-9db7-d36c2e71237c -->
* **Sentry trace-logs API is org-scoped, not project-scoped**: The Sentry trace-logs endpoint (\`/organizations/{org}/trace-logs/\`) is org-scoped, so \`trace logs\` uses \`resolveOrg()\` not \`resolveOrgAndProject()\`. The endpoint is PRIVATE in Sentry source, excluded from the public OpenAPI schema — \`@sentry/api\` has no generated types. The hand-written \`TraceLogSchema\` in \`src/types/sentry.ts\` is required until Sentry makes it public.

<!-- lore:019d3ea5-fd4a-75b0-8dab-0b1f1cb96b0e -->
* **SKILL.md is fully generated — edit source files, not output**: The skill files under \`plugins/sentry-cli/skills/sentry-cli/\` (SKILL.md + references/\*.md) are fully generated by \`bun run generate:skill\` (script/generate-skill.ts). CI runs this after every push via a \`github-actions\[bot]\` commit, overwriting any manual edits. To change skill content, edit the \*\*sources\*\*: (1) \`docs/src/content/docs/agent-guidance.md\` — embedded into SKILL.md's Agent Guidance section with heading levels bumped. (2) \`src/commands/\*/\` flag \`brief\` strings — generate the reference file flag descriptions. (3) \`docs/src/content/docs/commands/\*.md\` — examples extracted per command via marked AST parsing. After editing sources, run \`bun run generate:skill\` locally and commit both source and generated files. CI's \`bun run check:skill\` fails if generated files are stale.

<!-- lore:019d275c-7cf0-7e13-bdc8-10cbbdbda933 -->
* **Stricli route errors are uninterceptable — only post-run detection works**: Stricli route errors, exit codes, and OutputError — error propagation gaps: (1) Route failures are uninterceptable — Stricli writes to stderr and returns \`ExitCode.UnknownCommand\` internally. Only post-\`run()\` \`process.exitCode\` check works. \`exceptionWhileRunningCommand\` only fires for errors in command \`func()\`. (2) \`ExitCode.UnknownCommand\` is \`-5\`. Bun reads \`251\` (unsigned byte), Node reads \`-5\` — compare both. (3) \`OutputError\` in \`handleOutputError\` calls \`process.exit()\` immediately, bypassing telemetry and \`exceptionWhileRunningCommand\`. Top-level typos via \`defaultCommand:help\` → \`OutputError\` → \`process.exit(1)\` skip all error reporting.

<!-- lore:019d4a08-22c3-765b-ba12-d91b29e9d497 -->
* **Three Sentry APIs for span custom attributes with different capabilities**: Three Sentry endpoints serve span data with different custom attribute support: (1) \`/trace/{traceId}/\` — hierarchical tree; supports \`additional\_attributes\` query param to request named attributes (must enumerate). Returns \`measurements\` (web vitals, always populated with zeros for non-browser spans). (2) \`/projects/{org}/{project}/trace-items/{itemId}/?trace\_id={id}\&item\_type=spans\` — single span full detail; returns ALL attributes automatically as \`{name, type, value}\[]\`. No enumeration needed. Frontend span detail sidebar uses this. (3) \`/events/?dataset=spans\&field=X\` — list/search; requires explicit \`field\` params. The CLI's \`span view\` calls endpoint 2 via \`getSpanDetails()\` with p-limit(5) concurrency. \`trace view\` passes \`--fields\` to endpoint 1 as \`additional\_attributes\`.

<!-- lore:019d4a08-22db-7d73-923f-57f51b3cb203 -->
* **Trace view measurements filtering strips zero-valued web vitals from JSON**: The \`/trace/{traceId}/\` endpoint returns hardcoded web vitals measurements (LCP, FCP, CLS, INP, TTFB + score ratios) on ALL spans, even non-browser ones where they're all zero. \`filterSpanMeasurements()\` in \`trace/view.ts\` recursively strips zero-valued entries from the JSON output. Non-zero measurements on root pageload spans are preserved. Uses destructuring + spread (not \`delete\`) to satisfy Biome's \`noDelete\` rule.

<!-- lore:019cbf3f-6dc2-727d-8dca-228555e9603f -->
* **withAuthGuard returns discriminated Result type, not fallback+onError**: \`withAuthGuard\<T>(fn)\` in \`src/lib/errors.ts\` returns a discriminated Result: \`{ ok: true, value: T } | { ok: false, error: unknown }\`. AuthErrors always re-throw (triggers bin.ts auto-login). All other errors are captured. Callers inspect \`result.ok\` to degrade gracefully. Used across 12+ files.

### Gotcha

<!-- lore:019c9994-d161-783e-8b3e-79457cd62f42 -->
* **Biome lint: Response.redirect() required, nested ternaries forbidden**: Biome lint rules that frequently trip up this codebase: (1) \`useResponseRedirect\`: use \`Response.redirect(url, status)\` not \`new Response\`. (2) \`noNestedTernary\`: use \`if/else\`. (3) \`noComputedPropertyAccess\`: use \`obj.property\` not \`obj\["property"]\`. (4) Max cognitive complexity 15 per function — extract helpers to stay under.

<!-- lore:019c8c31-f52f-7230-9252-cceb907f3e87 -->
* **Bugbot flags defensive null-checks as dead code — keep them with JSDoc justification**: Cursor Bugbot and Sentry Seer repeatedly flag two false positives: (1) defensive null-checks as "dead code" — keep them with JSDoc explaining why the guard exists for future safety, especially when removing would require \`!\` assertions banned by \`noNonNullAssertion\`. (2) stderr spinner output during \`--json\` mode — always a false positive since progress goes to stderr, JSON to stdout. Reply explaining the rationale and resolve.

<!-- lore:019cc3e6-0cdd-7a53-9eb7-a284a3b4eb78 -->
* **Bun mock.module for node:tty requires default export and class stubs**: Bun testing gotchas: (1) \`mock.module()\` for CJS built-ins requires a \`default\` re-export plus all named exports. Missing any causes \`SyntaxError: Export named 'X' not found\`. Always check the real module's full export list. (2) \`Bun.mmap()\` always opens with PROT\_WRITE — macOS SIGKILL on signed Mach-O, Linux ETXTBSY. Fix: use \`new Uint8Array(await Bun.file(path).arrayBuffer())\` in bspatch.ts. (3) Wrap \`Bun.which()\` with optional \`pathEnv\` param for deterministic testing without mocks.

<!-- lore:019d3e8a-a4bb-7271-98cf-4cf418f2f581 -->
* **CLI telemetry command tags use sentry. prefix with dots not bare names**: The \`buildCommand\` wrapper sets the \`command\` telemetry tag using the full Stricli command prefix joined with dots: \`sentry.issue.explain\`, \`sentry.issue.list\`, \`sentry.api\`, etc. — NOT bare names like \`issue.explain\`. When querying Sentry Discover or building dashboard widgets, always use the \`sentry.\` prefix. Verify actual tag values with a Discover query (\`field:command, count()\`, grouped by \`command\`) before assuming the format.

<!-- lore:019d738f-bf14-7c12-940b-e027ad0db225 -->
* **Dashboard tracemetrics dataset uses comma-separated aggregate format**: SDK v10+ custom metrics (, , ) emit  envelope items. Dashboard widgets for these MUST use  with aggregate format  — e.g., . The  parameter must match the SDK emission exactly:  if no unit specified,  for memory metrics,  for uptime.  only supports , , , ,  display types — no  or . Widgets with  always require . Sort expressions must reference aggregates present in .

<!-- lore:019d76f5-94c0-7ba6-83fb-f6888b7fb197 -->
* **Skill eval judge needs explicit CLI context about auto-detect and flags**: The skill eval judge (Haiku) reads the compact Command Reference literally. Without explicit context, it rejects valid plans because: (1) it treats \`\<org/project>\` positional args as mandatory when they're optional via auto-detection, and (2) it rejects standard flags (\`--json\`, \`--query\`, \`--limit\`, \`--fields\`, \`--period\`) not shown in the compact reference. Fix: the judge prompt in \`test/skill-eval/helpers/judge.ts\` must include notes that positional args like \`\<org/project>\` are optional (CLI auto-detects from DSN/config), and that commands support additional flags documented in separate reference files. Also guard against empty \`commandReference\` extraction in \`script/eval-skill.ts\` — log a warning instead of silently producing an adversarial prompt where no commands can satisfy the judge.

<!-- lore:019d4a08-22d7-78d8-ab00-cdfb3ea05373 -->
* **spansIndexed is not a valid Sentry dataset — use spans**: The Sentry Events/Explore API accepts 5 dataset values: \`spans\`, \`transactions\`, \`logs\`, \`errors\`, \`discover\`. The name \`spansIndexed\` is invalid and returns a generic HTTP 500 "Internal error" with no helpful validation message. This trips up AI agents and users. Valid datasets are documented in \`src/lib/api/datasets.ts\` (\`EVENTS\_API\_DATASETS\` constant) and in \`docs/commands/api.md\`.

<!-- lore:019d0846-17bd-7ff3-a6d7-09b59b69a8fe -->
* **Use toMatchObject not toEqual when testing resolution results with optional fields**: When \`resolveProjectBySlug()\` or \`resolveOrgProjectTarget()\` adds optional fields (like \`projectData\`) to the return type, tests using \`expect(result).toEqual({ org, project })\` fail because \`toEqual\` requires exact match. Use \`toMatchObject({ org, project })\` instead — it checks the specified subset without failing on extra properties. This affects tests across \`event/view\`, \`log/view\`, \`trace/view\`, and \`trace/list\` test files.

### Pattern

<!-- lore:019d4a08-22d0-71b0-87ae-20bf5d94e018 -->
* **--fields dual role: output filtering + API field selection for span list**: In \`span list\`, \`--fields\` serves dual purpose: filters JSON output AND requests extra API fields. \`extractExtraApiFields()\` in \`span/list.ts\` checks each field name against \`OUTPUT\_TO\_API\_FIELD\` mapping (e.g., \`span\_id\`→\`id\`, \`op\`→\`span.op\`). Unknown names are treated as custom attributes and added to the \`field\` param in the events API request. \`FIELD\_GROUP\_ALIASES\` supports shorthand expansion (e.g., \`gen\_ai\` → 4 gen\_ai.\* fields). Extra fields survive Zod via \`SpanListItemSchema.passthrough()\` and are forwarded by \`spanListItemToFlatSpan(item, extraFieldNames)\` onto \`FlatSpan\`'s index signature. \`formatSpanTable()\` dynamically adds columns for extra attributes.

<!-- lore:019d4a08-22d4-7738-b1a2-9e09ef55daa1 -->
* **--since is an alias for --period via shared PERIOD\_ALIASES**: \`PERIOD\_ALIASES\` in \`src/lib/list-command.ts\` maps both \`t\` and \`since\` to \`period\`. All commands using \`LIST\_PERIOD\_FLAG\` get \`--since\` as an alias for \`--period\` automatically via spread \`...PERIOD\_ALIASES\`. This was added because AI agents and humans naturally try \`--since 1h\` instead of \`--period 1h\`.

<!-- lore:dbd63348-2049-42b3-bb99-d6a3d64369c7 -->
* **Branch naming and commit message conventions for Sentry CLI**: Branch naming: \`feat/\<short-description>\` or \`fix/\<issue-number>-\<short-description>\` (e.g., \`feat/ghcr-nightly-distribution\`, \`fix/268-limit-auto-pagination\`). Commit message format: \`type(scope): description (#issue)\` (e.g., \`fix(issue-list): auto-paginate --limit beyond 100 (#268)\`, \`feat(nightly): distribute via GHCR instead of GitHub Releases\`). Types seen: fix, refactor, meta, release, feat. PRs are created as drafts via \`gh pr create --draft\`. Implementation plans are attached to commits via \`git notes add\` rather than in PR body or commit message.

<!-- lore:019cc3e6-0cf5-720d-beb7-97c9c9901295 -->
* **Codecov patch coverage only counts test:unit and test:isolated, not E2E**: CI coverage merges \`test:unit\` (\`test/lib test/commands test/types --coverage\`) and \`test:isolated\` (\`test/isolated --coverage\`) into \`coverage/merged.lcov\`. E2E tests (\`test/e2e\`) are NOT included in coverage reports. So func tests that spy on exports (e.g., \`spyOn(apiClient, 'getLogs')\`) give zero coverage to the mocked function's body. To cover \`api-client.ts\` function bodies in unit tests, mock \`globalThis.fetch\` + \`setOrgRegion()\` + \`setAuthToken()\` and call the real function.

<!-- lore:019d3e86-a74a-7528-a53c-90d439f2abac -->
* **Extract catch blocks to helper functions to stay under Biome complexity limit**: When a command's \`func()\` body exceeds Biome's cognitive complexity limit of 15, extract the \`catch\` block into a standalone \`never\`-returning helper function. Pattern: \`function handleXxxError(error: unknown, ...context): never { ... throw error; }\`. The helper handles error classification, telemetry recording, and error mapping before re-throwing. Used in \`plan.ts\` with \`handleSeerCommandError()\`. The extraction must move ALL catch-block logic — leaving partial code behind creates syntax errors.

<!-- lore:019d25ab-8a2d-72cd-9abd-5e896b025e95 -->
* **Help-as-positional recovery uses error-path, not pre-execution interception**: Three layers of help-as-positional recovery exist: (1) \*\*Leaf commands\*\* (\`sentry issue list help\`): \`maybeRecoverWithHelp\` in \`buildCommand\` wrapper catches \`CliError\` (excluding \`OutputError\`) in the error handler. If any positional arg was \`"help"\`, shows help via \`introspectCommand()\` using \`commandPrefix\` stored on \`SentryContext\`. Only \`-h\` is NOT checked — Stricli intercepts it natively during route scanning. (2) \*\*Route groups\*\* (\`sentry dashboard help\`): Post-run check in \`bin.ts\` detects \`ExitCode.UnknownCommand\` + last arg \`"help"\`, rewrites argv to \`\["help", ...rest]\` and re-runs through the custom help command. (3) Both require \`commandPrefix\` on \`SentryContext\` (set in \`forCommand\`). Dynamic-imports \`help.js\` to avoid circular deps.

<!-- lore:019c90f5-913b-7995-8bac-84289cf5d6d9 -->
* **Pagination contextKey must include all query-varying parameters with escaping**: Pagination \`contextKey\` must encode every query-varying parameter (sort, query, period) with \`escapeContextKeyValue()\` (replaces \`|\` with \`%7C\`). Always provide a fallback before escaping since \`flags.period\` may be \`undefined\` in tests despite having a default: \`flags.period ? escapeContextKeyValue(flags.period) : "90d"\`.

<!-- lore:019c8a8a-64ee-703c-8c1e-ed32ae8a90a7 -->
* **PR review workflow: reply, resolve, amend, force-push**: PR review workflow: (1) Read unresolved threads via GraphQL, (2) make code changes, (3) run lint+typecheck+tests, (4) create a SEPARATE commit per review round (not amend) for incremental review, (5) push normally, (6) reply to comments via REST API, (7) resolve threads via GraphQL \`resolveReviewThread\`. Only amend+force-push when user explicitly asks or pre-commit hook modified files.

<!-- lore:019d275c-7cfb-7ecb-a8cf-8ff845eb946f -->
* **Redact sensitive flags in raw argv before sending to telemetry**: Telemetry context and argv redaction patterns: \`withTelemetry\` calls \`initTelemetryContext()\` BEFORE the callback — user ID, email, instance ID, runtime, and is\_self\_hosted tags are automatically set. For org context, read \`getDefaultOrganization()\` from SQLite (no API call). When sending raw argv, redact sensitive flags: \`SENSITIVE\_FLAGS\` in \`telemetry.ts\` (currently \`token\`). Scan for \`--token\`/\`-token\`, replace following value with \`\[REDACTED]\`. Handle both \`--flag value\` and \`--flag=value\` forms. \`setFlagContext\` handles parsed flags separately.

<!-- lore:019cdd9b-330a-784f-9487-0abf7b80be3c -->
* **Stricli optional boolean flags produce tri-state (true/false/undefined)**: Stricli boolean flags with \`optional: true\` (no \`default\`) produce \`boolean | undefined\` in the flags type. \`--flag\` → \`true\`, \`--no-flag\` → \`false\`, omitted → \`undefined\`. This enables auto-detect patterns: explicit user choice overrides, \`undefined\` triggers heuristic. Used by \`--compact\` on issue list. The flag type must be \`readonly field?: boolean\` (not \`readonly field: boolean\`). This differs from \`default: false\` which always produces a defined boolean.

<!-- lore:019cc325-d322-7e6e-86cc-93010b71abee -->
* **Testing Stricli command func() bodies via spyOn mocking**: Stricli/Bun test patterns: (1) Command func tests: \`const func = await cmd.loader()\`, then \`func.call(mockContext, flags, ...args)\`. \`loader()\` return type union causes LSP errors — false positives that pass \`tsc\`. File naming: \`\*.func.test.ts\`. (2) ESM prevents \`vi.spyOn\` on Node built-in exports. Workaround: test subclass that overrides the method calling the built-in. (3) Follow-mode uses \`setTimeout\`-based scheduling; test with \`interceptSigint()\` helper. \`Bun.sleep()\` has no AbortSignal so \`setTimeout\`/\`clearTimeout\` required.

<!-- lore:019d3f09-d39b-7795-b8a0-4a3e58a996f9 -->
* **validateWidgetEnums skipDeprecatedCheck for edit-path inherited datasets**: When editing a widget, \`effectiveDataset = flags.dataset ?? existing.widgetType\` may inherit a deprecated type (e.g., \`discover\`). The \`validateWidgetEnums\` deprecation check must be skipped for inherited values — only fire when the user explicitly passes \`--dataset\`. Solution: \`validateWidgetEnums(effectiveDisplay, effectiveDataset, { skipDeprecatedCheck: true })\` in \`edit.ts\`. The cross-validation between display type and dataset still runs on effective values, catching incompatible combos. The deprecation rejection helper \`rejectInvalidDataset()\` is extracted to keep \`validateWidgetEnums\` under Biome's complexity limit of 15.
<!-- End lore-managed section -->
