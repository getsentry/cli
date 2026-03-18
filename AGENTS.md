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
- `isPlainOutput()` precedence: `SENTRY_PLAIN_OUTPUT` > `NO_COLOR` > `FORCE_COLOR` > `!isTTY`

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

<!-- lore:019cbeba-e4d3-748c-ad50-fe3c3d5c0a0d -->
* **Auth token env var override pattern: SENTRY\_AUTH\_TOKEN > SENTRY\_TOKEN > SQLite**: Auth in \`src/lib/db/auth.ts\` follows layered precedence: \`SENTRY\_AUTH\_TOKEN\` > \`SENTRY\_TOKEN\` > SQLite OAuth token. \`getEnvToken()\` trims env vars (empty/whitespace = unset). \`AuthSource\` tracks provenance. \`ENV\_SOURCE\_PREFIX = "env:"\` — use \`.length\` not hardcoded 4. Env tokens bypass refresh/expiry. \`isEnvTokenActive()\` guards auth commands. Logout must NOT clear stored auth when env token active. These functions stay in \`db/auth.ts\` despite not touching DB because they're tightly coupled with token retrieval.

<!-- lore:019cbaa2-e4a2-76c0-8f64-917a97ae20c5 -->
* **Consola chosen as CLI logger with Sentry createConsolaReporter integration**: Consola is the CLI logger with Sentry \`createConsolaReporter\` integration. Two reporters: FancyReporter (stderr) + Sentry structured logs. Level via \`SENTRY\_LOG\_LEVEL\`. \`buildCommand\` injects hidden \`--log-level\`/\`--verbose\` flags. \`withTag()\` creates independent instances; \`setLogLevel()\` propagates via registry. All user-facing output must use consola, not raw stderr. \`HandlerContext\` intentionally omits stderr.

<!-- lore:019cce8d-f2c5-726e-8a04-3f48caba45ec -->
* **Input validation layer: src/lib/input-validation.ts guards CLI arg parsing**: Four validators in \`src/lib/input-validation.ts\` guard against agent-hallucinated inputs: \`rejectControlChars\` (ASCII < 0x20), \`rejectPreEncoded\` (%XX), \`validateResourceId\` (rejects ?, #, %, whitespace), \`validateEndpoint\` (rejects \`..\` traversal). Applied in \`parseSlashOrgProject\`, bare-slug path in \`parseOrgProjectArg\`, \`parseIssueArg\`, and \`normalizeEndpoint\` (api.ts). NOT applied in \`parseSlashSeparatedArg\` for no-slash plain IDs — those may contain structural separators (newlines for log view batch IDs) that callers split downstream. Validation targets user-facing parse boundaries only; env vars and DB cache values are trusted.

<!-- lore:019cd2d1-aa47-7fc1-92f9-cc6c49b19460 -->
* **Magic @ selectors resolve issues dynamically via sort-based list API queries**: Magic \`@\` selectors (\`@latest\`, \`@most\_frequent\`) in \`parseIssueArg\` are detected early (before \`validateResourceId\`) because \`@\` is not in the forbidden charset. \`SELECTOR\_MAP\` provides case-insensitive matching with common variations (\`@mostfrequent\`, \`@most-frequent\`). Resolution in \`resolveSelector\` (issue/utils.ts) maps selectors to \`IssueSort\` values (\`date\`, \`freq\`), calls \`listIssuesPaginated\` with \`perPage: 1\` and \`query: 'is:unresolved'\`. Supports org-prefixed form: \`sentry/@latest\`. Unrecognized \`@\`-prefixed strings fall through to suffix-only parsing (not an error). The \`ParsedIssueArg\` union includes \`{ type: 'selector'; selector: IssueSelector; org?: string }\`.

### Decision

<!-- lore:019cc2ef-9be5-722d-bc9f-b07a8197eeed -->
* **All view subcommands should use \<target> \<id> positional pattern**: All \`\* view\` subcommands should follow a consistent \`\<target> \<id>\` positional argument pattern where target is the optional \`org/project\` specifier. During migration, use opportunistic argument swapping with a stderr warning when args are in wrong order. This is an instance of the broader CLI UX auto-correction pattern: safe when input is already invalid, correction is unambiguous, warning goes to stderr. Normalize at command level, keep parsers pure. Model after \`gh\` CLI conventions.

### Gotcha

<!-- lore:019cd379-4c6a-7a93-beae-b1d5b4df69b1 -->
* **Dot-notation field filtering is ambiguous for keys containing dots**: The \`filterFields\` function in \`src/lib/formatters/json.ts\` uses dot-notation to address nested fields (e.g., \`metadata.value\`). This means object keys that literally contain dots are ambiguous and cannot be addressed. Property-based tests for this function must generate field name arbitraries that exclude dots — use a restricted charset like \`\[a-zA-Z0-9\_]\` in fast-check arbitraries. Counterexample found by fast-check: \`{"a":{".":false}}\` with path \`"a."\` splits into \`\["a", ""]\` and fails to resolve.

<!-- lore:019cbe0d-d03e-716c-b372-b09998c07ed6 -->
* **Stricli rejects unknown flags — pre-parsed global flags must be consumed from argv**: Stricli's arg parser is strict: any \`--flag\` not registered on a command throws \`No flag registered for --flag\`. Global flags (parsed before Stricli in bin.ts) MUST be spliced out of argv. \`--log-level\` was correctly consumed but \`--verbose\` was intentionally left in (for the \`api\` command's own \`--verbose\`). This breaks every other command. Also, \`argv.indexOf('--flag')\` doesn't match \`--flag=value\` form — must check both space-separated and equals-sign forms when pre-parsing. A Biome \`noRestrictedImports\` lint rule in \`biome.jsonc\` now blocks \`import { buildCommand } from "@stricli/core"\` at error level — only \`src/lib/command.ts\` is exempted. Other \`@stricli/core\` exports (\`buildRouteMap\`, \`run\`, etc.) are allowed.

### Pattern

<!-- lore:019cce8d-f2d6-7862-9105-7a0048f0e993 -->
* **Property-based tests for input validators use stringMatching for forbidden char coverage**: In \`test/lib/input-validation.property.test.ts\`, forbidden-character arbitraries are built with \`stringMatching\` targeting specific regex patterns (e.g., \`/^\[^\x00-\x1f]\*\[\x00-\x1f]\[^\x00-\x1f]\*$/\` for control chars). This ensures fast-check generates strings that always contain the forbidden character while varying surrounding content. The \`biome-ignore lint/suspicious/noControlCharactersInRegex\` suppression is needed on the control char regex constant in \`input-validation.ts\`.

<!-- lore:019cd379-4c71-7477-9cc6-3c0dfc7fb597 -->
* **Shared flag constants in list-command.ts for cross-command consistency**: \`src/lib/list-command.ts\` exports shared Stricli flag definitions (\`FIELDS\_FLAG\`, \`FRESH\_FLAG\`, \`FRESH\_ALIASES\`) reused across all commands. When adding a new global-ish flag to multiple commands, define it once here as a const satisfying Stricli's flag shape, then spread into each command's \`flags\` object. The \`--fields\` flag is \`{ kind: 'parsed', parse: String, brief: '...', optional: true }\`. \`parseFieldsList()\` in \`formatters/json.ts\` handles comma-separated parsing with trim/dedup. \`writeJson()\` accepts an optional \`fields\` array and calls \`filterFields()\` before serialization.

<!-- lore:019cbe44-7687-7288-81a2-662feefc28ea -->
* **SKILL.md generator must filter hidden Stricli flags**: \`script/generate-skill.ts\` introspects Stricli's route tree to auto-generate \`plugins/sentry-cli/skills/sentry-cli/SKILL.md\`. The \`FlagDef\` type must include \`hidden?: boolean\` and \`extractFlags\` must propagate it to \`FlagInfo\`. The filter in \`generateCommandDoc\` must exclude \`f.hidden\` alongside \`help\`/\`helpAll\`. Without this, hidden flags injected by \`buildCommand\` (like \`--log-level\`, \`--verbose\`) appear on every command in the AI agent skill file. Global flags should instead be documented once in \`docs/src/content/docs/commands/index.md\` Global Options section, which the generator pulls into SKILL.md via \`loadCommandsOverview\`.
<!-- End lore-managed section -->
