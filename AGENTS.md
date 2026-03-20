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

<!-- lore:019ce2be-39f1-7ad9-a4c5-4506b62f689c -->
* **api-client.ts split into domain modules under src/lib/api/**: The original monolithic \`src/lib/api-client.ts\` (1,977 lines) was split into 12 focused domain modules under \`src/lib/api/\`: infrastructure.ts (shared helpers, types, raw requests), organizations.ts, projects.ts, teams.ts, repositories.ts, issues.ts, events.ts, traces.ts, logs.ts, seer.ts, trials.ts, users.ts. The original \`api-client.ts\` was converted to a ~100-line barrel re-export file preserving all existing import paths. The \`biome.jsonc\` override for \`noBarrelFile\` already includes \`api-client.ts\`. When adding new API functions, place them in the appropriate domain module under \`src/lib/api/\`, not in the barrel file.

<!-- lore:019d0b69-1430-74f0-8e9a-426a5c7b321d -->
* **Bun compiled binary sourcemap options and size impact**: Binary build (\`script/build.ts\`) uses two steps: (1) \`Bun.build()\` produces \`dist-bin/bin.js\` + \`.map\` with \`sourcemap: "linked"\` and minification. (2) \`Bun.build()\` with \`compile: true\` produces native binary from \`bin.js\` — no sourcemap embedded. If \`SENTRY\_AUTH\_TOKEN\` is set, \`sentry-cli sourcemaps inject\` + \`upload\` sends the map to Sentry. Size vs inline sourcemaps: +0.04 MB gzipped vs +2.30 MB. Local builds without the token skip upload gracefully.

<!-- lore:019cb8ea-c6f0-75d8-bda7-e32b4e217f92 -->
* **CLI telemetry DSN is public write-only — safe to embed in install script**: The CLI's Sentry DSN (\`SENTRY\_CLI\_DSN\` in \`src/lib/constants.ts\`) is a public write-only ingest key already baked into every binary. Safe to hardcode in install scripts. Opt-out: \`SENTRY\_CLI\_NO\_TELEMETRY=1\`.

<!-- lore:019c978a-18b5-7a0d-a55f-b72f7789bdac -->
* **cli.sentry.dev is served from gh-pages branch via GitHub Pages**: \`cli.sentry.dev\` is served from gh-pages branch via GitHub Pages. Craft's gh-pages target runs \`git rm -r -f .\` before extracting docs — persist extra files via \`postReleaseCommand\` in \`.craft.yml\`. Install script supports \`--channel nightly\`, downloading from the \`nightly\` release tag directly. version.json is only used by upgrade/version-check flow.

<!-- lore:019cbe93-19b8-7776-9705-20bbde226599 -->
* **Nightly delta upgrade buildNightlyPatchGraph fetches ALL patch tags — O(N) HTTP calls**: Delta upgrade in \`src/lib/delta-upgrade.ts\` supports stable (GitHub Releases) and nightly (GHCR) channels. \`filterAndSortChainTags\` filters \`patch-\*\` tags by version range using \`Bun.semver.order()\`. GHCR uses \`fetchWithRetry\` (10s timeout + 1 retry; blobs 30s) with optional \`signal?: AbortSignal\` combined via \`AbortSignal.any()\`. \`isExternalAbort(error, signal)\` skips retries for external aborts — critical for background prefetch. Patches cached to \`~/.sentry/patch-cache/\` (file-based, 7-day TTL). \`loadCachedChain\` stitches patches for multi-hop offline upgrades.

<!-- lore:2c3eb7ab-1341-4392-89fd-d81095cfe9c4 -->
* **npm bundle requires Node.js >= 22 due to node:sqlite polyfill**: The npm package (dist/bin.cjs) requires Node.js >= 22 because the bun:sqlite polyfill uses \`node:sqlite\`. A runtime version guard in the esbuild banner catches this early. When writing esbuild banner strings in TS template literals, double-escape: \`\\\\\\\n\` in TS → \`\\\n\` in output → newline at runtime. Single \`\\\n\` produces a literal newline inside a JS string, causing SyntaxError.

<!-- lore:019c972c-9f0f-75cd-9e24-9bdbb1ac03d6 -->
* **Numeric issue ID resolution returns org:undefined despite API success**: Numeric issue ID resolution in \`resolveNumericIssue()\`: (1) try DSN/env/config for org, (2) if found use \`getIssueInOrg(org, id)\` with region routing, (3) else fall back to unscoped \`getIssue(id)\`, (4) extract org from \`issue.permalink\` via \`parseSentryUrl\` as final fallback. \`parseSentryUrl\` handles path-based (\`/organizations/{org}/...\`) and subdomain-style URLs. \`matchSubdomainOrg()\` filters region subdomains by requiring slug length > 2. Self-hosted uses path-based only.

<!-- lore:019ce0bb-f35d-7380-b661-8dc56f9938cf -->
* **Seer trial prompt uses middleware layering in bin.ts error handling chain**: Error recovery middlewares in \`bin.ts\` are layered: \`main() → executeWithAutoAuth() → executeWithSeerTrialPrompt() → runCommand()\`. Seer trial prompts (for \`no\_budget\`/\`not\_enabled\`) caught by inner wrapper; auth errors bubble to outer. Auth retry goes through full chain. Trial API: \`GET /api/0/customers/{org}/\` → \`productTrials\[]\` (prefer \`seerUsers\`, fallback \`seerAutofix\`). Start: \`PUT /api/0/customers/{org}/product-trial/\`. SaaS-only; self-hosted 404s gracefully. \`ai\_disabled\` excluded. \`startSeerTrial\` accepts \`category\` from trial object — don't hardcode.

### Decision

<!-- lore:019c99d5-69f2-74eb-8c86-411f8512801d -->
* **Raw markdown output for non-interactive terminals, rendered for TTY**: Markdown-first output pipeline: custom renderer in \`src/lib/formatters/markdown.ts\` walks \`marked\` tokens to produce ANSI-styled output. Commands build CommonMark using helpers (\`mdKvTable()\`, \`mdRow()\`, \`colorTag()\`, \`escapeMarkdownCell()\`, \`safeCodeSpan()\`) and pass through \`renderMarkdown()\`. \`isPlainOutput()\` precedence: \`SENTRY\_PLAIN\_OUTPUT\` > \`NO\_COLOR\` > \`FORCE\_COLOR\` > \`!isTTY\`. \`--json\` always outputs JSON. Colors defined in \`COLORS\` object in \`colors.ts\`. Tests run non-TTY so assertions match raw CommonMark; use \`stripAnsi()\` helper for rendered-mode assertions.

<!-- lore:00166785-609d-4ab5-911e-ee205d17b90c -->
* **whoami should be separate from auth status command**: The \`sentry auth whoami\` command should be a dedicated command separate from \`sentry auth status\`. They serve different purposes: \`status\` shows everything about auth state (token, expiry, defaults, org verification), while \`whoami\` just shows user identity (name, email, username, ID) by fetching live from \`/auth/\` endpoint. \`sentry whoami\` should be a top-level alias (like \`sentry issues\` → \`sentry issue list\`). \`whoami\` should support \`--json\` for machine consumption and be lightweight — no credential verification, no defaults listing.

### Gotcha

<!-- lore:019c8ab6-d119-7365-9359-98ecf464b704 -->
* **@sentry/api SDK passes Request object to custom fetch — headers lost on Node.js**: @sentry/api SDK calls \`\_fetch(request)\` with no init object. In \`authenticatedFetch\`, \`init\` is undefined so \`prepareHeaders\` creates empty headers — on Node.js this strips Content-Type (HTTP 415). Fix: fall back to \`input.headers\` when \`init\` is undefined. Use \`unwrapPaginatedResult\` (not \`unwrapResult\`) to access the Response's Link header for pagination. \`per\_page\` is not in SDK types; cast query to pass it at runtime.

<!-- lore:019c9e98-7af4-7e25-95f4-fc06f7abf564 -->
* **Bun binary build requires SENTRY\_CLIENT\_ID env var**: The build script (\`script/bundle.ts\`) requires \`SENTRY\_CLIENT\_ID\` environment variable and exits with code 1 if missing. When building locally, use \`bun run --env-file=.env.local build\` or set the env var explicitly. The binary build (\`bun run build\`) also needs it. Without it you get: \`Error: SENTRY\_CLIENT\_ID environment variable is required.\`

<!-- lore:019c9776-e3dd-7632-88b8-358a19506218 -->
* **GitHub immutable releases prevent rolling nightly tag pattern**: getsentry/cli has immutable GitHub releases — assets can't be modified and tags can NEVER be reused. Nightly builds publish to GHCR with versioned tags like \`nightly-0.14.0-dev.1772661724\`, not GitHub Releases or npm. \`fetchManifest()\` throws \`UpgradeError("network\_error")\` for both network failures and non-200 — callers must check message for HTTP 404/403. Craft with no \`preReleaseCommand\` silently skips \`bump-version.sh\` if only target is \`github\`.

<!-- lore:019cb8c2-d7b5-780c-8a9f-d20001bc198f -->
* **Install script: BSD sed and awk JSON parsing breaks OCI digest extraction**: The install script parses OCI manifests with awk (no jq). Key trap: BSD sed \`\n\` is literal, not newline. Fix: single awk pass tracking last-seen \`"digest"\`, printing when \`"org.opencontainers.image.title"\` matches target. The config digest (\`sha256:44136fa...\`) is a 2-byte \`{}\` blob — downloading it instead of the real binary causes \`gunzip: unexpected end of file\`.

<!-- lore:019d0b04-ccec-7bd2-a5ca-732e7064cc1a -->
* **Multi-region fan-out: distinguish all-403 from empty orgs with hasSuccessfulRegion flag**: In \`listOrganizationsUncached\` (\`src/lib/api/organizations.ts\`), \`Promise.allSettled\` collects multi-region results. Don't use \`flatResults.length === 0\` to detect all-regions-failed — a region returning 200 OK with zero orgs pushes nothing into \`flatResults\`. Track a \`hasSuccessfulRegion\` boolean on any \`"fulfilled"\` settlement. Only re-throw 403 \`ApiError\` when \`!hasSuccessfulRegion && lastScopeError\`.

<!-- lore:019c969a-1c90-7041-88a8-4e4d9a51ebed -->
* **Multiple mockFetch calls replace each other — use unified mocks for multi-endpoint tests**: Bun test mocking gotchas: (1) \`mockFetch()\` replaces \`globalThis.fetch\` — calling it twice replaces the first mock. Use a single unified fetch mock dispatching by URL pattern. (2) \`mock.module()\` pollutes the module registry for ALL subsequent test files. Tests using it must live in \`test/isolated/\` and run via \`test:isolated\`. This also causes \`delta-upgrade.test.ts\` to fail when run alongside \`test/isolated/delta-upgrade.test.ts\` — the isolated test's \`mock.module()\` replaces \`CLI\_VERSION\` for all subsequent files. (3) For \`Bun.spawn\`, use direct property assignment in \`beforeEach\`/\`afterEach\`.

<!-- lore:019d0b36-5dae-722b-8094-aca5cfbb5527 -->
* **Seer trial prompt requires interactive terminal — AI agents never see it**: The Seer trial prompt middleware (\`executeWithSeerTrialPrompt\`) checks \`isatty(0)\` — AI agents running non-interactively never see it, so \`SeerError\` propagates with a generic message. Fix: \`SeerError.format()\` should include an actionable command like \`sentry trial start seer \<org>\`. Also, \`handleSeerApiError\` must return the original \`ApiError\`, not wrap in plain \`Error\` — wrapping loses the type and breaks downstream \`instanceof ApiError\` checks in middleware.

<!-- lore:019c9741-d78e-73b1-87c2-e360ef6c7475 -->
* **useTestConfigDir without isolateProjectRoot causes DSN scanning of repo tree**: \`useTestConfigDir()\` creates temp dirs under \`.test-tmp/\` in the repo tree. Without \`{ isolateProjectRoot: true }\`, \`findProjectRoot\` walks up and finds the repo's \`.git\`, causing DSN detection to scan real source code and trigger network calls against test mocks (timeouts). Always pass \`isolateProjectRoot: true\` when tests exercise \`resolveOrg\`, \`detectDsn\`, or \`findProjectRoot\`.

### Pattern

<!-- lore:019d0b69-1434-726d-be22-81d9ecb0f54a -->
* **Delta upgrade patch generation uses zig-bsdiff with zstd in CI**: CI generates delta patches between nightly builds using \`zig-bsdiff\` (v0.1.19) with \`--use-zstd\` flag. Workflow: download previous nightly from GHCR, run \`bsdiff old new patch --use-zstd\` for each platform binary, push patch manifest as \`patch-\<version>\` GHCR tag with SHA-256 annotations per binary. To test locally: download zig-bsdiff from github.com/blackboardsh/zig-bsdiff/releases, build two versions with a source change between them, run \`bsdiff v1 v2 output.patch --use-zstd\`. ORAS CLI (v1.2.3) handles GHCR push/fetch. Patches are non-fatal (\`continue-on-error: true\` in CI).

<!-- lore:019d0b36-5da2-750c-b26f-630a2927bd79 -->
* **findProjectsByPattern as fuzzy fallback for exact slug misses**: When \`findProjectsBySlug\` returns empty (no exact match), use \`findProjectsByPattern\` as a fallback to suggest similar projects. \`findProjectsByPattern\` does bidirectional word-boundary matching (\`matchesWordBoundary\`) against all projects in all orgs — the same logic used for directory name inference. In the \`project-search\` handler, call it after the exact miss, format matches as \`\<org>/\<slug>\` suggestions in the \`ResolutionError\`. This avoids a dead-end error for typos like 'patagonai' when 'patagon-ai' exists. Note: \`findProjectsByPattern\` makes additional API calls (lists all projects per org), so only call it on the failure path.

<!-- lore:019c972c-9f11-7c0d-96ce-3f8cc2641175 -->
* **Org-scoped SDK calls follow getOrgSdkConfig + unwrapResult pattern**: All org-scoped API calls in src/lib/api-client.ts: (1) call \`getOrgSdkConfig(orgSlug)\` for regional URL + SDK config, (2) spread into SDK function: \`{ ...config, path: { organization\_id\_or\_slug: orgSlug, ... } }\`, (3) pass to \`unwrapResult(result, errorContext)\`. Shared helpers \`resolveAllTargets\`/\`resolveOrgAndProject\` must NOT call \`fetchProjectId\` — commands that need it enrich targets themselves.

<!-- lore:5ac4e219-ea1f-41cb-8e97-7e946f5848c0 -->
* **PR workflow: wait for Seer and Cursor BugBot before resolving**: CI includes Seer Code Review and Cursor Bugbot as advisory checks (~2-3 min, only on ready-for-review PRs). Workflow: push → wait for all CI (including npm build) → check inline review comments from Seer/BugBot → fix valid findings → repeat. Bugbot sometimes catches real logic bugs, not just style — always review before merging. Use \`gh pr checks \<PR> --watch\` to monitor. Fetch comments via \`gh api repos/OWNER/REPO/pulls/NUM/comments\`.

<!-- lore:019cb162-d3ad-7b05-ab4f-f87892d517a6 -->
* **Shared pagination infrastructure: buildPaginationContextKey and parseCursorFlag**: List commands with cursor pagination use \`buildPaginationContextKey(type, identifier, flags)\` for composite context keys and \`parseCursorFlag(value)\` accepting \`"last"\` magic value. Critical: \`resolveCursor()\` must be called inside the \`org-all\` override closure, not before \`dispatchOrgScopedList\` — otherwise cursor validation errors fire before the correct mode-specific error.

<!-- lore:019cbd5f-ec35-7e2d-8386-6d3a67adf0cf -->
* **Telemetry instrumentation pattern: withTracingSpan + captureException for handled errors**: For graceful-fallback operations, use \`withTracingSpan\` from \`src/lib/telemetry.ts\` for child spans and \`captureException\` from \`@sentry/bun\` (named import — Biome forbids namespace imports) with \`level: 'warning'\` for non-fatal errors. \`withTracingSpan\` uses \`onlyIfParent: true\` — no-op without active transaction. User-visible fallbacks use \`log.warn()\` not \`log.debug()\`. Several commands bypass telemetry by importing \`buildCommand\` from \`@stricli/core\` directly instead of \`../../lib/command.js\` (trace/list, trace/view, log/view, api.ts, help.ts).

<!-- lore:019cc43d-e651-7154-a88e-1309c4a2a2b6 -->
* **Testing Stricli command func() bodies via spyOn mocking**: To unit-test a Stricli command's \`func()\` body: (1) \`const func = await cmd.loader()\`, (2) \`func.call(mockContext, flags, ...args)\` with mock \`stdout\`, \`stderr\`, \`cwd\`, \`setContext\`. (3) \`spyOn\` namespace imports to mock dependencies (e.g., \`spyOn(apiClient, 'getLogs')\`). The \`loader()\` return type union causes \`.call()\` LSP errors — these are false positives that pass \`tsc --noEmit\`. When API functions are renamed (e.g., \`getLog\` → \`getLogs\`), update both spy target name AND mock return shape (single → array). Slug normalization (\`normalizeSlug\`) replaces underscores with dashes but does NOT lowercase — test assertions must match original casing (e.g., \`'CAM-82X'\` not \`'cam-82x'\`).
<!-- End lore-managed section -->
