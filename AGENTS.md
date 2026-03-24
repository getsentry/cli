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

### List Command Pagination

All list commands with API pagination MUST use the shared cursor infrastructure:

```typescript
import { LIST_CURSOR_FLAG } from "../../lib/list-command.js";
import {
  buildPaginationContextKey, resolveOrgCursor,
  setPaginationCursor, clearPaginationCursor,
} from "../../lib/db/pagination.js";

export const PAGINATION_KEY = "my-entity-list";

// In buildCommand:
flags: { cursor: LIST_CURSOR_FLAG },
aliases: { c: "cursor" },

// In func():
const contextKey = buildPaginationContextKey("entity", `${org}/${project}`, {
  sort: flags.sort, q: flags.query,
});
const cursor = resolveOrgCursor(flags.cursor, PAGINATION_KEY, contextKey);
const { data, nextCursor } = await listEntities(org, project, { cursor, ... });
if (nextCursor) setPaginationCursor(PAGINATION_KEY, contextKey, nextCursor);
else clearPaginationCursor(PAGINATION_KEY, contextKey);
```

Show `-c last` in the hint footer when more pages are available. Include `nextCursor` in the JSON envelope.

Reference template: `trace/list.ts`, `span/list.ts`

### ID Validation

Use shared validators from `src/lib/hex-id.ts`:
- `validateHexId(value, label)` — 32-char hex IDs (trace IDs, log IDs). Auto-strips UUID dashes.
- `validateSpanId(value)` — 16-char hex span IDs. Auto-strips dashes.
- `validateTraceId(value)` — thin wrapper around `validateHexId` in `src/lib/trace-id.ts`.

All normalize to lowercase. Throw `ValidationError` on invalid input.

### Sort Convention

Use `"date"` for timestamp-based sort (not `"time"`). Export sort types from the API layer (e.g., `SpanSortValue` from `api/traces.ts`), import in commands. This matches `issue list`, `trace list`, and `span list`.

### SKILL.md

- Run `bun run generate:skill` after changing any command parameters, flags, or docs.
- CI check `bun run check:skill` will fail if SKILL.md is stale.
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

Use helpers from `src/lib/db/utils.ts` to reduce SQL boilerplate:

```typescript
import { upsert, runUpsert, getMetadata, setMetadata, clearMetadata, touchCacheEntry } from "../db/utils.js";

// UPSERT (insert or update on conflict)
runUpsert(db, "table", { id: 1, name: "foo" }, ["id"]);

// With excludeFromUpdate (columns only set on INSERT)
const { sql, values } = upsert(
  "users",
  { id: 1, name: "Bob", created_at: now },
  ["id"],
  { excludeFromUpdate: ["created_at"] }
);
db.query(sql).run(...values);

// METADATA table helpers (for key-value config in the metadata table)
const m = getMetadata(db, [KEY_A, KEY_B]);              // SELECT ... WHERE key IN (...)
setMetadata(db, { [KEY_A]: "val1", [KEY_B]: "val2" });  // Batch upsert in transaction
clearMetadata(db, [KEY_A, KEY_B]);                       // DELETE ... WHERE key IN (...)

// Cache entry touch (update last_accessed timestamp)
touchCacheEntry("dsn_cache", "directory", directoryPath);
```

**Enforced by lint:** GritQL rules ban raw metadata queries, inline `last_accessed` UPDATEs,
and manual `BEGIN`/`COMMIT`/`ROLLBACK` transactions outside `utils.ts` and `migration.ts`.

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

### DB and Config Function Signatures

Database operations in `src/lib/db/` are **synchronous** (SQLite is synchronous in Bun).
Functions that only do SQLite work return values directly — no `async`/`await` needed:

```typescript
const org = getDefaultOrganization();  // returns string | undefined
const info = getUserInfo();            // returns UserInfo | undefined
setDefaults("my-org", "my-project");   // returns void
const token = getAuthToken();          // returns string | undefined
```

Exceptions that ARE async (they do file I/O or network calls):
- `clearAuth()` — awaits cache directory cleanup
- `getCachedDetection()`, `getCachedProjectRoot()`, `setCachedProjectRoot()` — await `stat()` for mtime validation
- `refreshToken()`, `performTokenRefresh()` — await HTTP calls

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
- Always set `orgSlugMatchBehavior` on `dispatchOrgScopedList` to declare how bare-slug org matches are handled. Use `"redirect"` for commands where listing all entities in the org makes sense (e.g., `project list`, `team list`). Use `"error"` for commands with custom per-project logic that can't auto-redirect (e.g., `issue list`). The pre-check uses cached orgs to avoid N API calls — individual handlers don't need their own org-slug fallback.

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

<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/opencode-lore) -->
## Long-term Knowledge

### Architecture

<!-- lore:019d0b16-9777-7579-aa15-caf6603a34f5 -->
* **defaultCommand:help blocks Stricli fuzzy matching for top-level typos**: Stricli's \`defaultCommand: "help"\` in \`app.ts\` routes unrecognized top-level words to the help command, bypassing Stricli's built-in Damerau-Levenshtein fuzzy matching. Fixed: \`resolveCommandPath()\` in \`introspect.ts\` now returns an \`UnresolvedPath\` (with \`kind: "unresolved"\`, \`input\`, and \`suggestions\`) when a path segment doesn't match. It calls \`fuzzyMatch()\` from \`fuzzy.ts\` to produce up to 3 suggestions. \`introspectCommand()\` and \`formatHelpHuman()\` in \`help.ts\` surface these as "Did you mean: X?" messages. Both top-level (\`sentry isseu\`) and subcommand (\`sentry help issue lis\`) typos now get suggestions. JSON output includes a \`suggestions\` array in the error variant.

<!-- lore:019cafbb-24ad-75a3-b037-5efbe6a1e85d -->
* **DSN org prefix normalization in arg-parsing.ts**: Sentry DSN hosts encode org IDs as \`oNNNNN\` (e.g., \`o1081365.ingest.us.sentry.io\`). The Sentry API rejects the \`o\`-prefixed form. \`stripDsnOrgPrefix()\` in \`src/lib/arg-parsing.ts\` uses \`/^o(\d+)$/\` to strip the prefix — safe for slugs like \`organic\`. Applied in \`parseOrgProjectArg()\` and \`parseWithSlash()\`, covering all API call paths consuming \`parsed.org\`.

<!-- lore:019cb38b-e327-7ec5-8fb0-9e635b2bac48 -->
* **GHCR versioned nightly tags for delta upgrade support**: GHCR nightly distribution uses three tag types: \`:nightly\` (rolling), \`:nightly-\<version>\` (immutable), \`:patch-\<version>\` (delta manifest). Delta patches use zig-bsdiff TRDIFF10 (zstd-compressed), ~50KB vs ~29MB full. Client bspatch via \`Bun.zstdDecompressSync()\`. N-1 patches only, full download fallback, SHA-256 verify, 60% size threshold. npm/Node excluded. Test mocks: use \`mockGhcrNightlyVersion()\` helper.

<!-- lore:a1f33ceb-6116-4d29-b6d0-0dc9678e4341 -->
* **Issue list auto-pagination beyond API's 100-item cap**: Sentry API silently caps \`limit\` at 100 per request. \`listIssuesAllPages()\` auto-paginates using Link headers, bounded by MAX\_PAGINATION\_PAGES (50). \`API\_MAX\_PER\_PAGE\` constant is shared across all paginated consumers. \`--limit\` means total results everywhere (max 1000, default 25). Org-all mode uses \`fetchOrgAllIssues()\`; explicit \`--cursor\` does single-page fetch to preserve cursor chain.

<!-- lore:019d0846-17b2-7c58-9201-f5d2e255dcb0 -->
* **resolveProjectBySlug carries full projectData to avoid redundant getProject calls**: \`resolveProjectBySlug()\` returns \`{ org, project, projectData: SentryProject }\` — the full project object from \`findProjectsBySlug()\`. \`ResolvedOrgProject\` and \`ResolvedTarget\` have optional \`projectData?\` (populated only in project-search path, not explicit/auto-detect). Downstream commands (\`project/view\`, \`project/delete\`, \`dashboard/create\`) use \`projectData\` when available to skip redundant \`getProject()\` API calls (~500-800ms savings). Pattern: \`resolved.projectData ?? await getProject(org, project)\` for callers that need both paths.

<!-- lore:019cb950-9b7b-731a-9832-b7f6cfb6a6a2 -->
* **Self-hosted OAuth device flow requires Sentry 26.1.0+ and SENTRY\_CLIENT\_ID**: Self-hosted OAuth device flow requires Sentry 26.1.0+ and both \`SENTRY\_URL\` and \`SENTRY\_CLIENT\_ID\` env vars. Users must create a public OAuth app in Settings → Developer Settings. The client ID is NOT optional for self-hosted. Fallback for older instances: \`sentry auth login --token\`. \`getSentryUrl()\` and \`getClientId()\` in \`src/lib/oauth.ts\` read lazily (not at module load) so URL parsing from arguments can set \`SENTRY\_URL\` after import.

<!-- lore:019ce2be-39f1-7ad9-a4c5-4506b62f689c -->
* **api-client.ts split into domain modules under src/lib/api/**: The original monolithic \`src/lib/api-client.ts\` (1,977 lines) was split into 12 focused domain modules under \`src/lib/api/\`: infrastructure.ts (shared helpers, types, raw requests), organizations.ts, projects.ts, teams.ts, repositories.ts, issues.ts, events.ts, traces.ts, logs.ts, seer.ts, trials.ts, users.ts. The original \`api-client.ts\` was converted to a ~100-line barrel re-export file preserving all existing import paths. The \`biome.jsonc\` override for \`noBarrelFile\` already includes \`api-client.ts\`. When adding new API functions, place them in the appropriate domain module under \`src/lib/api/\`, not in the barrel file.

<!-- lore:019d0b69-1430-74f0-8e9a-426a5c7b321d -->
* **Bun compiled binary sourcemap options and size impact**: Binary build (\`script/build.ts\`) uses two steps: (1) \`Bun.build()\` produces \`dist-bin/bin.js\` + \`.map\` with \`sourcemap: "linked"\` and minification. (2) \`Bun.build()\` with \`compile: true\` produces native binary — no sourcemap embedded. Bun's compiled binaries use \`/$bunfs/root/bin.js\` as the virtual path in stack traces. Sourcemap upload must use \`--url-prefix '/$bunfs/root/'\` so Sentry can match frames. The upload runs \`sentry-cli sourcemaps inject dist-bin/\` first (adds debug IDs), then uploads both JS and map. Bun's compile step strips comments (including \`//# debugId=\`), but debug ID matching still works via the injected runtime snippet + URL prefix matching. Size: +0.04 MB gzipped vs +2.30 MB for inline sourcemaps. Without \`SENTRY\_AUTH\_TOKEN\`, upload is skipped gracefully.

<!-- lore:019cb8ea-c6f0-75d8-bda7-e32b4e217f92 -->
* **CLI telemetry DSN is public write-only — safe to embed in install script**: The CLI's Sentry DSN (\`SENTRY\_CLI\_DSN\` in \`src/lib/constants.ts\`) is a public write-only ingest key already baked into every binary. Safe to hardcode in install scripts. Opt-out: \`SENTRY\_CLI\_NO\_TELEMETRY=1\`.

<!-- lore:019c978a-18b5-7a0d-a55f-b72f7789bdac -->
* **cli.sentry.dev is served from gh-pages branch via GitHub Pages**: \`cli.sentry.dev\` is served from gh-pages branch via GitHub Pages. Craft's gh-pages target runs \`git rm -r -f .\` before extracting docs — persist extra files via \`postReleaseCommand\` in \`.craft.yml\`. Install script supports \`--channel nightly\`, downloading from the \`nightly\` release tag directly. version.json is only used by upgrade/version-check flow.

<!-- lore:019cbe93-19b8-7776-9705-20bbde226599 -->
* **Nightly delta upgrade buildNightlyPatchGraph fetches ALL patch tags — O(N) HTTP calls**: Delta upgrade in \`src/lib/delta-upgrade.ts\` supports stable (GitHub Releases) and nightly (GHCR) channels. \`filterAndSortChainTags\` filters \`patch-\*\` tags by version range using \`Bun.semver.order()\`. GHCR uses \`fetchWithRetry\` (10s timeout + 1 retry; blobs 30s) with optional \`signal?: AbortSignal\` combined via \`AbortSignal.any()\`. \`isExternalAbort(error, signal)\` skips retries for external aborts — critical for background prefetch. Patches cached to \`~/.sentry/patch-cache/\` (file-based, 7-day TTY). \`loadCachedChain\` stitches patches for multi-hop offline upgrades.

<!-- lore:2c3eb7ab-1341-4392-89fd-d81095cfe9c4 -->
* **npm bundle requires Node.js >= 22 due to node:sqlite polyfill**: The npm package (dist/bin.cjs) requires Node.js >= 22 because the bun:sqlite polyfill uses \`node:sqlite\`. A runtime version guard in the esbuild banner catches this early. When writing esbuild banner strings in TS template literals, double-escape: \`\\\\\\\n\` in TS → \`\\\n\` in output → newline at runtime. Single \`\\\n\` produces a literal newline inside a JS string, causing SyntaxError.

<!-- lore:019c972c-9f0f-75cd-9e24-9bdbb1ac03d6 -->
* **Numeric issue ID resolution returns org:undefined despite API success**: Numeric issue ID resolution in \`resolveNumericIssue()\`: (1) try DSN/env/config for org, (2) if found use \`getIssueInOrg(org, id)\` with region routing, (3) else fall back to unscoped \`getIssue(id)\`, (4) extract org from \`issue.permalink\` via \`parseSentryUrl\` as final fallback. \`parseSentryUrl\` handles path-based (\`/organizations/{org}/...\`) and subdomain-style URLs. \`matchSubdomainOrg()\` filters region subdomains by requiring slug length > 2. Self-hosted uses path-based only.

<!-- lore:019ce0bb-f35d-7380-b661-8dc56f9938cf -->
* **Seer trial prompt uses middleware layering in bin.ts error handling chain**: Error recovery middlewares in \`bin.ts\` are layered: \`main() → executeWithAutoAuth() → executeWithSeerTrialPrompt() → runCommand()\`. Seer trial prompts (for \`no\_budget\`/\`not\_enabled\`) caught by inner wrapper; auth errors bubble to outer. Auth retry goes through full chain. Trial API: \`GET /api/0/customers/{org}/\` → \`productTrials\[]\` (prefer \`seerUsers\`, fallback \`seerAutofix\`). Start: \`PUT /api/0/customers/{org}/product-trial/\`. SaaS-only; self-hosted 404s gracefully. \`ai\_disabled\` excluded. \`startSeerTrial\` accepts \`category\` from trial object — don't hardcode.

<!-- lore:019d0b16-977c-7e49-b06d-523b7782692f -->
* **Sentry CLI fuzzy matching coverage map across subsystems**: Fuzzy matching exists in: (1) Stricli built-in Damerau-Levenshtein for subcommand/flag typos within known route groups, (2) custom \`fuzzyMatch()\` in \`complete.ts\` for dynamic tab-completion using Levenshtein+prefix+contains scoring, (3) custom \`levenshtein()\` in \`platforms.ts\` for platform name suggestions, (4) plural alias detection in \`app.ts\`, (5) \`resolveCommandPath()\` in \`introspect.ts\` uses \`fuzzyMatch()\` from \`fuzzy.ts\` for top-level and subcommand typos — covering both \`sentry \<typo>\` and \`sentry help \<typo>\`. Static shell tab-completion uses shell-native prefix matching (compgen/\`\_describe\`/fish \`-a\`).

<!-- lore:019ca9c3-989c-7c8d-bcd0-9f308fd2c3d7 -->
* **Sentry CLI markdown-first formatting pipeline replaces ad-hoc ANSI**: Formatters build CommonMark strings; \`renderMarkdown()\` renders to ANSI for TTY or raw markdown for non-TTY. Key helpers: \`colorTag()\`, \`mdKvTable()\`, \`mdRow()\`, \`mdTableHeader()\` (\`:\` suffix = right-aligned), \`renderTextTable()\`. \`isPlainOutput()\` checks \`SENTRY\_PLAIN\_OUTPUT\` > \`NO\_COLOR\` > \`!isTTY\`. Batch path: \`formatXxxTable()\`. Streaming path: \`StreamingTable\` (TTY) or raw markdown rows (plain). Both share \`buildXxxRowCells()\`.

<!-- lore:019cd2b7-bb98-730e-a0d3-ec25bfa6cf4c -->
* **Sentry issue stats field: time-series controlled by groupStatsPeriod**: The \`stats\` field on issues is \`{ '24h': \[\[ts, count], ...] }\`. Key depends on \`groupStatsPeriod\` param (\`""\`, \`"14d"\`, \`"24h"\`, \`"auto"\`). \`statsPeriod\` controls time window; \`groupStatsPeriod\` controls stats key. \*\*Critical\*\*: \`count\` is period-scoped — \`lifetime.count\` is the true lifetime total. Issue list table uses \`groupStatsPeriod: 'auto'\` for sparkline data. Column order: SHORT ID, ISSUE, SEEN, AGE, TREND, EVENTS, USERS, TRIAGE. TREND auto-hidden when terminal < 100 cols. \`--compact\` tri-state: explicit overrides; \`undefined\` triggers \`shouldAutoCompact(rowCount)\` — compact if \`3N + 3 > termHeight\`, false for non-TTY. Height is \`3N + 3\` (not \`3N + 4\`) because last data row has no trailing separator.

<!-- lore:019ca9c3-98a2-7a81-9db7-d36c2e71237c -->
* **Sentry trace-logs API is org-scoped, not project-scoped**: The Sentry trace-logs endpoint (\`/organizations/{org}/trace-logs/\`) is org-scoped, so \`trace logs\` uses \`resolveOrg()\` not \`resolveOrgAndProject()\`. The endpoint is PRIVATE in Sentry source, excluded from the public OpenAPI schema — \`@sentry/api\` has no generated types. The hand-written \`TraceLogSchema\` in \`src/types/sentry.ts\` is required until Sentry makes it public.

<!-- lore:019cbf3f-6dc2-727d-8dca-228555e9603f -->
* **withAuthGuard returns discriminated Result type, not fallback+onError**: \`withAuthGuard\<T>(fn)\` in \`src/lib/errors.ts\` returns a discriminated Result: \`{ ok: true, value: T } | { ok: false, error: unknown }\`. AuthErrors always re-throw (triggers bin.ts auto-login). All other errors are captured. Callers inspect \`result.ok\` to degrade gracefully. Used across 12+ files.

<!-- lore:019d082a-c40e-77b5-9374-ee993205ac79 -->
* **Sentry SDK switched from @sentry/bun to @sentry/node-core/light**: The CLI switched from \`@sentry/bun\` to \`@sentry/node-core/light\` (PR #474) to eliminate the OpenTelemetry dependency tree (~170ms startup savings). All imports use \`@sentry/node-core/light\` not \`@sentry/bun\`. \`LightNodeClient\` replaces \`BunClient\` in telemetry.ts. \`Span\` type exports from \`@sentry/core\`. The \`@sentry/core\` barrel is patched to remove ~32 unused exports (AI tracing, MCP server, Supabase, feature flags). Light mode is labeled experimental but safe because SDK versions are pinned exactly (not caret). \`makeNodeTransport\` works fine in Bun. The \`cli.runtime\` tag still distinguishes Bun vs Node at runtime.

### Gotcha

<!-- lore:019d1d4b-19fa-7d78-a01a-4c375f425834 -->
* **Chalk needs chalk.level=3 for ANSI output in tests**: In Bun tests, stdout is piped (not a TTY), so chalk's color level defaults to 0 and produces no ANSI escape codes — even with \`SENTRY\_PLAIN\_OUTPUT=0\`. Setting \`FORCE\_COLOR=1\` env var works but the project convention is to set \`chalk.level = 3\` at the top of test files that need to assert on ANSI output. The project's \`isPlainOutput()\` and chalk's color detection are independent systems: \`isPlainOutput()\` checks \`SENTRY\_PLAIN\_OUTPUT\`/\`NO\_COLOR\`/TTY, while chalk checks \`FORCE\_COLOR\`/TTY separately.

<!-- lore:019d1bca-b5c1-7e19-b8cc-74b6f32f3487 -->
* **issue explain/plan commands never set sentry.org telemetry tag**: The \`issue explain\` and \`issue plan\` commands were missing \`setContext(\[org], \[])\` calls after \`resolveOrgAndIssueId()\`, so \`sentry.org\` and \`sentry.project\` tags were never set on SeerError events. Fixed in commit 816b44b5 on branch \`fix/seer-org-telemetry-tag\` — both commands now destructure \`setContext\` from \`this\` and call it immediately after resolving the org, before any Seer API call. The \`issue view\` and \`issue list\` commands already had this call. Pattern: always call \`setContext()\` right after org resolution, before any API call that might throw, so error events carry the org tag.

<!-- lore:019d1d4b-1a07-7d8a-b8ec-69fcf1440922 -->
* **LSP auto-organize imports can silently remove new imports**: When editing TypeScript files in this project, the LSP's auto-organize-imports feature can silently remove import lines that were just added if the imported symbols aren't yet referenced in the file. This happens when you add an import in one edit and the usage in a subsequent edit — the LSP runs between edits and strips the "unused" import. Fix: always add the import and its first usage in the same edit operation, or verify imports survived after each edit by grepping the file.

<!-- lore:019d082a-c419-7c99-9259-eacd10d2bcbd -->
* **project list bare-slug org fallback requires custom handleProjectSearch**: The \`project list\` command has a custom \`handleProjectSearch\` override (not the shared one from \`org-list.ts\`). When a user types \`sentry project list acme-corp\` where \`acme-corp\` is an org slug (not a project), the custom handler must check if the bare slug matches an organization and fall back to listing that org's projects. The shared \`handleProjectSearch\` in \`org-list.ts\` already does this, but custom overrides in individual commands can miss it, causing a confusing \`ResolutionError\` (PR #475 fix).

<!-- lore:019d1d4b-19e6-7aea-a3d8-3f76bcdd2209 -->
* **Zero runtime dependencies enforced by test**: The project has a test in \`test/package.test.ts\` that asserts \`pkg.dependencies\` is empty — all packages must be devDependencies. The CLI is distributed as a compiled Bun binary, so runtime deps are bundled at build time. Adding a package to \`dependencies\` instead of \`devDependencies\` will fail CI. When adding a new package like \`@sentry/sqlish\`, use \`bun add --dev\` not \`bun add\`.

### Pattern

<!-- lore:019d1f98-3bed-7f36-ae7e-34a529709097 -->
* **@sentry/api SDK blocks query params on issue detail endpoints**: The \`retrieveAnIssue\` and \`resolveAShortId\` SDK functions have \`query?: never\` in their TypeScript types, preventing callers from passing \`collapse\` or other query parameters. The Sentry backend DOES accept \`collapse\` on these endpoints (same Django view base class as the list endpoint), but the OpenAPI spec omits it. The CLI works around this by using raw \`apiRequestToRegion()\` instead of the SDK for \`getIssueInOrg\` and \`getIssueByShortId\`. Upstream issue filed at https://github.com/getsentry/sentry-api-schema/issues/63. If the schema is fixed, these functions can switch back to the SDK.

<!-- lore:019d1bca-b5c9-7e1a-bfe4-d5c0545176ee -->
* **Dashboard widget layout uses 6-column grid with x,y,w,h**: Sentry dashboards use a 6-column grid with \`{x, y, w, h, minH}\` layout. Default big\_number is \`w=2, h=1\`; to center it use \`w=4, x=1\`. Tables default to \`w=6, h=2\`. The \`dashboard widget edit\` command only handles query/display/title — use \`sentry api\` with PUT to \`/api/0/organizations/{org}/dashboards/{id}/\` for layout, default period, environment, and project changes. The PUT payload must include the full \`widgets\` array. Widget queries need both \`fields\` (all columns + aggregates) and \`columns\` (non-aggregate columns only) arrays. Use \`user.display\` instead of \`user.email\` for user columns — it auto-selects the best available identifier.

<!-- lore:019d082a-c415-7685-b6f0-e303d95eb4a0 -->
* **Issue resolution fan-out uses unbounded Promise.all across orgs**: \`resolveProjectSearch()\` in \`src/commands/issue/utils.ts\` fans out \`tryGetIssueByShortId\` across ALL orgs via \`Promise.all\`. Pattern: expand short ID, list all orgs, fire lookups in parallel, collect successes. Exactly one success → use it; multiple → ambiguity error; all fail → fall back to \`resolveProjectSearchFallback()\`. All org fan-out concurrency is controlled by \`ORG\_FANOUT\_CONCURRENCY\` (exported from \`src/lib/api/infrastructure.ts\`, re-exported via \`api-client.ts\`). This single constant is used in \`events.ts\`, \`projects.ts\`, \`issue/utils.ts\`, and any future fan-out sites. Never define a local concurrency limit for org fan-out — always import the shared constant.
<!-- End lore-managed section -->
