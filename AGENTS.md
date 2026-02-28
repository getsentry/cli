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
│   │   ├── api.ts          # Direct API access command
│   │   └── help.ts         # Help command
│   ├── lib/                # Shared utilities
│   │   ├── api-client.ts   # Sentry API client (ky-based)
│   │   ├── region.ts       # Multi-region resolution
│   │   ├── telemetry.ts    # Sentry SDK instrumentation
│   │   ├── sentry-urls.ts  # URL builders for Sentry
│   │   ├── db/             # SQLite database layer
│   │   │   ├── instance.ts     # Database singleton
│   │   │   ├── schema.ts       # Table definitions
│   │   │   ├── migration.ts    # Schema migrations
│   │   │   ├── utils.ts        # SQL helpers (upsert)
│   │   │   ├── auth.ts         # Token storage
│   │   │   ├── user.ts         # User info cache
│   │   │   ├── regions.ts      # Org→region URL cache
│   │   │   ├── defaults.ts     # Default org/project
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
│   │   │   └── colors.ts   # Terminal colors
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

Commands use `@stricli/core`. 

**Stricli Documentation**: https://bloomberg.github.io/stricli/docs/getting-started/principles

Pattern:

```typescript
import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";

export const myCommand = buildCommand({
  docs: {
    brief: "Short description",
    fullDescription: "Detailed description",
  },
  parameters: {
    flags: {
      json: { kind: "boolean", brief: "Output as JSON", default: false },
      limit: { kind: "parsed", parse: Number, brief: "Max items", default: 10 },
    },
  },
  async func(this: SentryContext, flags) {
    const { process } = this;
    // Implementation - use process.stdout.write() for output
  },
});
```

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
├── ValidationError (input validation - field?)
├── DeviceFlowError (OAuth flow - code)
├── SeerError (Seer AI - reason: 'not_enabled' | 'no_budget' | 'ai_disabled')
└── UpgradeError (upgrade - reason: 'unknown_method' | 'network_error' | 'execution_failed' | 'version_not_found')

// Usage: throw specific error types
import { ApiError, AuthError, SeerError } from "../lib/errors.js";
throw new AuthError("not_authenticated");
throw new ApiError("Request failed", 404, "Not found");
throw new SeerError("not_enabled", orgSlug); // Includes actionable URL

// In commands: let errors propagate to central handler
// The bin.ts entry point catches and formats all errors consistently
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
import { buildCommand } from "@stricli/core";
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

<!-- This section is auto-maintained by lore (https://github.com/BYK/opencode-lore) -->
## Long-term Knowledge

### Architecture

<!-- lore:019c8b60-d221-718a-823b-7c2c6e4ca1d5 -->
* **Sentry API: events require org+project, issues have legacy global endpoint**: Sentry's event-fetching API endpoint is \`GET /api/0/projects/{org}/{project}/events/{event\_id}/\` — requires both org and project in the URL path. There is NO equivalent of the legacy \`/api/0/issues/{id}/\` endpoint for events. Event IDs (UUIDs) are project-scoped in Sentry's storage layer (ClickHouse/Snuba). Contrast with issues: \`getIssue()\` uses \`/api/0/issues/{id}/\` which works WITHOUT org context (issues have global numeric IDs). The issue response includes \`project.slug\` and \`organization.slug\`, enabling a two-step lookup: fetch issue → extract org/project → fetch event. For traces: \`getDetailedTrace()\` uses \`/organizations/{org}/trace/{traceId}/\` — needs only org, not project. Possible workaround for event view without org/project: use the Discover endpoint \`/organizations/{org}/events/\` with \`query=id:{eventId}\` and \`dataset=errors\` to search across all projects in an org.
<!-- lore:019c8c72-b871-7d5e-a1a4-5214359a5a77 -->
* **Sentry CLI has two distribution channels with different runtimes**: The Sentry CLI ships via two completely independent build pipelines: 1. \*\*Standalone binary\*\* (GitHub Releases): Built with \`Bun.build()\` + \`compile: true\` via \`script/build.ts\`. Produces native executables (\`sentry-{platform}-{arch}\`) with Bun runtime embedded. Runs under Bun. 2. \*\*npm package\*\*: Built with esbuild via \`script/bundle.ts\`. Produces a single minified CJS file (\`dist/bin.cjs\`) with \`#!/usr/bin/env node\` shebang. Requires Node.js 22+ (for \`node:sqlite\`). Key esbuild settings: \`platform: 'node'\`, \`target: 'node22'\`, \`format: 'cjs'\`. Aliases \`@sentry/bun\` → \`@sentry/node\`. Injects Bun API polyfills from \`script/node-polyfills.ts\`. Bun API polyfills cover: \`Bun.file()\`, \`Bun.write()\`, \`Bun.which()\`, \`Bun.spawn()\`, \`Bun.sleep()\`, \`Bun.Glob\`, \`Bun.randomUUIDv7()\`, \`Bun.semver.order()\`, and \`bun:sqlite\` (→ \`node:sqlite\` DatabaseSync). The npm bundle is CJS, so \`require()\` calls in source are native and resolved at bundle time by esbuild — no ESM/CJS conflict. CI smoke-tests with \`node dist/bin.cjs --help\` on Node 22 and 24.
<!-- lore:019c8f05-c86b-7f16-ad13-3ebb6d1675a3 -->
* **gh CLI config directory convention and XDG compliance**: The \`gh\` CLI (GitHub CLI), which is the explicit UX model for Sentry CLI per AGENTS.md, stores config at: \`$GH\_CONFIG\_DIR\` > \`$XDG\_CONFIG\_HOME/gh\` > \`$HOME/.config/gh\` (follows XDG on all platforms including macOS). Most other major CLIs (docker, aws, kubectl, cargo) use \`~/.toolname/\` rather than XDG. macOS \`~/Library/Application Support/\` is Apple-blessed for app data but uncommon for CLI tools and surprising to developers. The Sentry CLI currently uses \`~/.sentry/\` with \`SENTRY\_CONFIG\_DIR\` as an override env var.
<!-- lore:365e4299-37cf-48e0-8f2e-8503d4a249dd -->
* **API client wraps all errors as CliError subclasses — no raw exceptions escape**: The Sentry CLI API client (src/lib/api-client.ts) guarantees that all errors thrown by API functions like getCurrentUser() are CliError subclasses (ApiError or AuthError). In unwrapResult(), known error types (AuthError, ApiError) are re-thrown directly, and everything else — including raw network TypeErrors from ky — goes through throwApiError() which wraps them as ApiError. This means command implementations do NOT need their own try-catch for error display: the central error handler in app.ts exceptionWhileRunningCommand catches CliError and displays a clean message without stack trace. Only add try-catch when the command needs to handle the error specially (e.g., login needs to continue without user info on failure, not crash). The Seer bot flagged whoami.ts for lacking try-catch around getCurrentUser() — this was a false positive because of this guarantee.
<!-- lore:019c9f9c-40e8-7c94-9579-6f0fc7cda3a6 -->
* **Issue list multi-target mode has no cursor pagination — only org-all mode supports --cursor**: In the Sentry CLI \`issue list\` command, cursor-based pagination (\`--cursor\` / \`-c last\`) is supported in BOTH org-all mode (\`sentry issue list \<org>/\`) and multi-target mode (auto-detect, explicit, project-search). Org-all uses a standard single cursor from the Sentry API. Multi-target mode uses a \*\*compound cursor\*\* — a pipe-separated string where each position corresponds to a project in the sorted target fingerprint order. Empty segments mean the project is exhausted (no more pages). The compound cursor is built by \`encodeCompoundCursor()\` and decoded by \`decodeCompoundCursor()\` in list.ts. The context key for multi-target cursors includes a fingerprint of the sorted target list (\`buildMultiTargetContextKey\`) so that cursor stored for one set of detected projects is not accidentally reused for a different set. When resuming with a compound cursor, \`handleResolvedTargets\` skips Phase 1/Phase 2 budget logic and instead fetches one page per project using each project's stored cursor. Projects with exhausted cursors (empty segments) are filtered into \`exhaustedTargets\` and excluded from \`activeTargets\` to prevent re-fetching from scratch. The 'more results available' hint now suggests both \`-n \<higher-limit>\` and \`-c last\` in multi-target mode, but only when \`hasAnyCursor\` is true (at least one project has a next cursor stored).
<!-- lore:019c8b60-d21a-7d44-8a88-729f74ec7e02 -->
* **Sentry CLI resolve-target cascade has 5 priority levels with env var support**: The resolve-target module (src/lib/resolve-target.ts) resolves org/project context through a strict 5-level priority cascade: 1. Explicit CLI flags (both org and project must be provided together) 2. SENTRY\_ORG / SENTRY\_PROJECT environment variables 3. Config defaults (SQLite defaults table) 4. DSN auto-detection (source code, .env files, SENTRY\_DSN env var) 5. Directory name inference (matches project slugs with word boundaries) SENTRY\_PROJECT supports combo notation: \`SENTRY\_PROJECT=org/project\` (slash presence auto-splits). When combo form is used, SENTRY\_ORG is ignored. If SENTRY\_PROJECT contains a slash but the combo parse fails (e.g. \`org/\` or \`/project\`), the entire SENTRY\_PROJECT value is discarded — it does NOT fall through to be used as a plain project slug alongside SENTRY\_ORG. Only SENTRY\_ORG (if set) provides the org in this case. The resolveFromEnvVars() helper is injected into all four resolution functions: resolveAllTargets, resolveOrgAndProject, resolveOrg, and resolveOrgsForListing. This matches the convention used by legacy sentry-cli and Sentry Webpack plugin. Added in PR #280.

### Decision

<!-- lore:00166785-609d-4ab5-911e-ee205d17b90c -->
* **whoami should be separate from auth status command**: The \`sentry auth whoami\` command should be a dedicated command separate from \`sentry auth status\`. They serve different purposes: \`status\` shows everything about auth state (token, expiry, defaults, org verification), while \`whoami\` just shows user identity (name, email, username, ID) by fetching live from \`/auth/\` endpoint. \`sentry whoami\` should be a top-level alias (like \`sentry issues\` → \`sentry issue list\`). \`whoami\` should support \`--json\` for machine consumption and be lightweight — no credential verification, no defaults listing.
<!-- lore:019c9f9c-40ee-76b5-b98d-acf1e5867ebc -->
* **Issue list global limit with fair per-project distribution and representation guarantees**: The \`issue list\` command's \`--limit\` flag specifies a global total across all detected projects, not per-project. The fetch strategy uses two phases in \`fetchWithBudget\`: Phase 1 divides the limit evenly (\`ceil(limit / numTargets)\`) and fetches in parallel. Phase 2 (\`runPhase2\`) redistributes surplus budget to targets that hit their quota and have more results (via cursor resume using \`startCursor\` param added to \`listIssuesAllPages\`). After fetching, \`trimWithProjectGuarantee\` ensures at least 1 issue per project is shown before filling remaining slots from the globally-sorted list. This prevents high-volume projects from completely hiding quiet ones. When more projects exist than the limit, the projects with the highest-ranked first issues get representation. JSON output for multi-target mode wraps in \`{ data: \[...], hasMore: bool }\` (with optional \`errors\` array) to align with org-all mode's existing \`data\` wrapper. A compound cursor is stored so \`-c last\` can resume multi-target pagination.
<!-- lore:019c8f05-c86f-7b46-babc-5e4faebff2e9 -->
* **Sentry CLI config dir should stay at ~/.sentry/, not move to XDG**: Decision: Don't move the Sentry CLI config directory from ~/.sentry/ to ~/.config/sentry/ or ~/Library/Application Support/. The readonly database errors seen in telemetry (100% macOS) are caused by Unix permission issues from \`sudo brew install\` creating root-owned files, not by the directory location. Moving to any other path would have identical permission problems if created by root. The SENTRY\_CONFIG\_DIR env var already exists as an escape hatch. All three fixes have been implemented in PR #288: 1. Setup steps are non-fatal with bestEffort() try-catch wrapper 2. tryRepairReadonly() detects root-owned files and prints actionable \`sudo chown -R \<user> ~/.sentry\` message 3. \`sentry cli fix\` command handles ownership detection and repair (chown when run as root via sudo)

### Gotcha

<!-- lore:019c8ee1-affd-7198-8d01-54aa164cde35 -->
* **brew is not in VALID\_METHODS but Homebrew formula passes --method brew**: Homebrew install support for Sentry CLI was merged to main via PR #277. The implementation includes: 'brew' as a valid installation method in \`parseInstallationMethod()\` (src/lib/upgrade.ts), \`isHomebrewInstall()\` detection via Cellar realpath check (always checked first before stored install info), version pinning errors with dedicated 'unsupported\_operation' error reason, architecture validation, and post\_install setup that skips redundant work on \`brew upgrade\`. The upgrade command includes a 'brew' case that tells users to run \`brew upgrade getsentry/tools/sentry\`. Uses .gz compressed artifacts. The Homebrew formula lives in a tap at getsentry/tools.
<!-- lore:019c8bbe-bc63-7b5e-a4e0-de7e968dcacb -->
* **Stricli defaultCommand blends default command flags into route completions**: When a Stricli route map has \`defaultCommand\` set, requesting completions for that route (e.g. \`\["issues", ""]\`) returns both the subcommand names AND the default command's flags/positional completions. This means completion tests that compare against \`extractCommandTree()\` subcommand lists will fail for groups with defaultCommand, since the actual completions include extra entries like \`--limit\`, \`--query\`, etc. Solution: track \`hasDefaultCommand\` in the command tree and skip strict subcommand-matching assertions for those groups.
<!-- lore:019c8b78-965f-7f67-ae31-d24961133260 -->
* **Codecov patch coverage requires --coverage flag on ALL test invocations**: In the Sentry CLI, the test script runs \`bun run test:unit && bun run test:isolated\`. Only \`test:unit\` has \`--coverage --coverage-reporter=lcov\`. The \`test:isolated\` run (for tests using \`mock.module()\`) does NOT generate coverage. This means code paths exercised only in isolated tests won't count toward Codecov patch coverage. To boost patch coverage, either: (1) add \`--coverage\` to the isolated test script, or (2) write additional unit tests that call the real (non-mocked) functions where possible. For env var resolution, since env vars short-circuit at step 2 before any DB/API calls, unit tests can call the real resolve functions without mocking dependencies.
<!-- lore:a28c4f2a-e2b6-4f24-9663-a85461bc6412 -->
* **Multiregion mock must include all control silo API routes**: When changing which Sentry API endpoint a function uses (e.g., switching getCurrentUser() from /users/me/ to /auth/), the mock route must be updated in BOTH test/mocks/routes.ts (single-region) AND test/mocks/multiregion.ts createControlSiloRoutes() (multi-region). Missing the multiregion mock causes 404s in multi-region test scenarios. The multiregion control silo mock serves auth, user info, and region discovery routes. Cursor Bugbot caught this gap when /api/0/auth/ was added to routes.ts but not multiregion.ts.
<!-- lore:ce43057f-2eff-461f-b49b-fb9ebaadff9d -->
* **Sentry /users/me/ endpoint returns 403 for OAuth tokens — use /auth/ instead**: The Sentry \`/users/me/\` endpoint returns 403 for OAuth tokens (including OAuth App tokens). The \`/auth/\` endpoint works with ALL token types (OAuth, API tokens, OAuth App tokens) and returns the authenticated user's information. \`/auth/\` lives on the control silo (sentry.io for SaaS, not regional endpoints). The sentry-mcp project uses this pattern: always route \`/auth/\` to the main sentry.io host for SaaS, bypassing regional endpoints. In the Sentry CLI, \`getControlSiloUrl()\` already handles this routing correctly. The \`getCurrentUser()\` function in \`src/lib/api-client.ts\` should use \`/auth/\` instead of \`/users/me/\`. The \`SentryUserSchema\` (with \`.passthrough()\`) handles the \`/auth/\` response since it only requires \`id\` and makes \`email\`, \`username\`, \`name\` optional.
<!-- lore:70319dc2-556d-4e30-9562-e51d1b68cf45 -->
* **Bun mock.module() leaks globally across test files in same process**: Bun's mock.module() replaces the ENTIRE barrel module globally and leaks state across test files run in the same bun test process. If test file A mocks 'src/lib/api-client.js' to stub listOrganizations, ALL subsequent test files in that process see the mock instead of the real module. This caused ~100 test failures when test/isolated/resolve-target.test.ts ran alongside unit tests. Solution: tests using mock.module() must run in a separate bun test invocation (separate process). In package.json, the 'test' script uses 'bun run test:unit && bun run test:isolated' instead of 'bun test' to ensure process isolation. The test/isolated/ directory exists specifically for tests that use mock.module(). The file even documents this with a comment about Bun leaking mock.module() state (referencing getsentry/cli#258).
<!-- lore:a32255e0-3315-44ac-b4c2-131fcf9f8ddf -->
* **Test suite has 131 pre-existing failures from DB schema drift and mock issues**: The Sentry CLI test suite had 131 pre-existing failures (1902 pass) caused by two root issues: (1) Bun's mock.module() in test/isolated/resolve-target.test.ts leaked globally, poisoning api-client.js (listOrganizations → undefined), db/defaults.js, db/project-cache.js, db/dsn-cache.js, and dsn/index.js for all subsequent test files — this caused ~80% of failures. (2) Minor issues: project root path resolution in temp dirs (11), DSN Detector module tests (17), E2E timeouts (2). Fix: changed package.json 'test' script from 'bun test' to 'bun run test:unit && bun run test:isolated' so isolated tests with mock.module() run in a separate Bun process. Result: 1931 tests, 0 failures. Key lesson: Bun's mock.module() replaces the ENTIRE barrel module globally and leaks across test files in the same process — tests using mock.module() must be isolated in separate bun test invocations.
<!-- lore:8c0fabbb-590c-4a7b-812b-15accf978748 -->
* **pagination\_cursors table schema mismatch requires repair migration**: The pagination\_cursors SQLite table could be created with a single-column PK (command\_key TEXT PRIMARY KEY) by earlier code versions, instead of the expected composite PK (PRIMARY KEY (command\_key, context)). This caused 'SQLiteError: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint' at runtime. Fixed by: (1) migration 5→6 that detects wrong PK via hasCompositePrimaryKey() and drops/recreates the table, (2) repairWrongPrimaryKeys() in repairSchema() for auto-repair, (3) isSchemaError() now catches 'on conflict clause does not match' to trigger auto-repair, (4) getSchemaIssues() reports 'wrong\_primary\_key' diagnostic. CURRENT\_SCHEMA\_VERSION bumped to 6. Data loss is acceptable since pagination cursors are ephemeral (5-min TTL). The hasCompositePrimaryKey() helper inspects sqlite\_master DDL for the expected PRIMARY KEY clause.
<!-- lore:5efa0434-09ff-49b6-b0a1-d8a7e740855b -->
* **resolveCursor must be called inside org-all closure, not before dispatch**: In list commands using dispatchOrgScopedList with cursor pagination (e.g., project/list.ts), resolveCursor() must be called inside the 'org-all' override closure, not before dispatchOrgScopedList. If called before, it throws a ContextError before dispatch can throw the correct ValidationError for --cursor being used in non-org-all modes.
<!-- lore:019c8f61-cd09-7c4f-9e04-a49576cf4c30 -->
* **Bun.$ (shell tagged template) has no Node.js polyfill in Sentry CLI**: The Sentry CLI's node-polyfills.ts (used for the npm/Node.js distribution) provides shims for Bun.file(), Bun.write(), Bun.which(), Bun.spawn(), Bun.sleep(), Bun.Glob, Bun.randomUUIDv7(), Bun.semver.order(), and bun:sqlite — but NOT for Bun.$ (the tagged template shell). Any source code using Bun.$\`command\` will crash when running via the npm distribution (node dist/bin.cjs). Use execSync from node:child\_process instead for shell commands that need to work in both runtimes. The Bun.which polyfill already uses this pattern. As of PR #288, there are zero Bun.$ usages in the source code. AGENTS.md has been updated to document this: the Bun.$ row in the Quick Bun API Reference table has a ⚠️ warning, and a new exception block shows the execSync workaround. The phrasing 'Until a shim is added' signals that adding a Bun.$ polyfill is a desired future improvement. When someone adds the shim, remove the exception note and the ⚠️ from the table.
<!-- lore:019c8ee1-aff7-708e-ae24-32e4709fe8a0 -->
* **Homebrew post-install runs as installing user — permission errors crash setup**: When Sentry CLI is installed via Homebrew, the formula runs \`sentry cli setup --method brew --no-modify-path\` as a post-install step. This can fail with SQLiteError (SQLITE\_CANTOPEN on ~/.sentry/cli.db) or EPERM on ~/.local/share/zsh/site-functions/\_sentry. Root cause is Unix permission issues from \`sudo brew install\` creating root-owned files (NOT macOS TCC). Fixed in PR #288 with three changes: 1. \*\*setup.ts\*\*: \`bestEffort()\` wrapper makes every post-install step non-fatal — Homebrew post\_install no longer aborts with scary errors. 2. \*\*telemetry.ts\*\*: \`tryRepairReadonly()\` detects root-owned files via \`statSync().uid === 0\` and prints actionable \`sudo chown -R \<user> \<dir>\` message using real username from SUDO\_USER/USER/USERNAME/os.userInfo(). Has \`win32\` platform guard since uid checks are meaningless on Windows. 3. \*\*fix.ts\*\*: \`sentry cli fix\` has full ownership detection — checks config files for wrong uid, prints chown instructions when not root, performs actual \`chown\` when run via \`sudo sentry cli fix\`. Uses \`resolveUid()\` via \`execFileSync('id', \['-u', username])\` (not \`Bun.$\` — no node shim). Guards against chown-to-root (targetUid === 0) and bails early when real UID can't be resolved. The \`getRealUsername()\` helper lives in \`src/lib/utils.ts\` (shared between telemetry.ts and fix.ts). It checks SUDO\_USER → USER → USERNAME → os.userInfo().username → '$(whoami)', with userInfo() wrapped in try-catch since it can throw on some systems.
<!-- lore:76c673bf-0417-47cb-a73d-9c941fbd182c -->
* **handleProjectSearch ContextError resource must be "Project" not config.entityName**: In src/lib/org-list.ts handleProjectSearch, the first argument to ContextError is the resource name rendered as "${resource} is required.". Always pass "Project" (not config.entityName like "team" or "repository") since the error is about a missing project slug, not a missing entity of the command's type. A code comment documents the rationale inline.

### Pattern

<!-- lore:019c8f30-087b-775e-be96-38153fc3c199 -->
* **Ownership check before permission check in CLI fix commands**: When a CLI fix/repair command checks filesystem health, ownership issues must be diagnosed BEFORE permission issues. If files are root-owned, chmod will fail with EPERM anyway — no point attempting it. The ordering in \`sentry cli fix\` is: (1) ownership check (stat().uid vs process.getuid()), (2) permission check (only if ownership is OK), (3) schema check (only if filesystem is accessible). When ownership repair succeeds (via sudo), skip the permission check since chown doesn't change mode bits — permissions may still need fixing on a subsequent non-sudo run.
<!-- lore:019c8b60-d228-7ed2-bdc1-524eec99ad3b -->
* **Sentry CLI Pattern A error: 133 events from missing context, mostly AI agents**: The #1 user error pattern in Sentry CLI (CLI-17, 110+ events, 50 users) is 'Organization and project is required' — users running commands without any org/project context. Breakdown by command: issue list (54), event view (41), issues alias (9), trace view (4). 24/110 events have --json flag (AI agent/CI usage). Many event view calls pass just an event ID with no org/project positional arg. Users are on CI (Ubuntu on Azure) or macOS with --json. The fix is multi-pronged: (1) SENTRY\_ORG/SENTRY\_PROJECT env var support (PR #280), (2) improved error messages mentioning env vars, (3) future: event view cross-project search.
<!-- lore:019c8aed-4465-78ba-b006-70f8e6c640b4 -->
* **Store analysis/plan files in gitignored .plans/ directory**: For the Sentry CLI project, analysis and planning documents (like bug triage notes from automated review tools) are stored in .plans/ directory which is added to .gitignore. This keeps detailed analysis accessible locally without cluttering the repository. Previously such analysis was being added to AGENTS.md which is committed.
<!-- lore:019c8aed-445f-7bc6-98cd-971408673b04 -->
* **Sentry CLI issue resolution wraps getIssue 404 in ContextError with ID hint**: In resolveIssue() (src/commands/issue/utils.ts), bare getIssue() calls for numeric and explicit-org-numeric cases should catch ApiError with status 404 and re-throw as ContextError that includes: (1) the ID the user provided, (2) a hint about access/deletion, (3) a suggestion to use short-ID format (\<project>-\<id>) if the user confused numeric group IDs with short-ID suffixes. Without this, the user gets a generic 'Issue not found' without knowing which ID failed or what to try instead.
<!-- lore:019c8aed-4458-79c5-b5eb-01a3f7e926e0 -->
* **Sentry CLI setFlagContext redacts sensitive flags before telemetry**: The setFlagContext() function in src/lib/telemetry.ts must redact sensitive flag values (like --token) before setting Sentry tags. A SENSITIVE\_FLAGS set contains flag names that should have their values replaced with '\[REDACTED]' instead of the actual value. This prevents secrets from leaking into telemetry. The scrub happens at the source (in setFlagContext itself) rather than in beforeSend, so the sensitive value never reaches the Sentry SDK.
<!-- lore:d441d9e5-3638-4b5a-8148-f88c349b8979 -->
* **Non-essential DB cache writes should be guarded with try-catch**: In the Sentry CLI, commands that write to the local SQLite cache as a side effect (e.g., setUserInfo() to update cached user identity) should wrap those writes in try-catch when the write is not essential to the command's primary purpose. If the DB is in a bad state (read-only filesystem, corrupted, schema mismatch), the cache write would throw and crash the command even though the primary operation (e.g., displaying user identity, completing login) already succeeded. Pattern: wrap non-essential setUserInfo() calls in try-catch, silently swallow errors. Applied in both whoami.ts and login.ts. Cursor Bugbot flagged the whoami.ts case — the cache update is a nice-to-have side effect that shouldn't prevent showing the fetched user data.
<!-- lore:9ea8fffe-ecfc-4f34-9aa6-ccf30d45e9cd -->
* **Login --token flow: getCurrentUser failure must not block authentication**: In src/commands/auth/login.ts --token flow, the token is saved via setAuthToken() before fetching user info via getCurrentUser(). If getCurrentUser() fails after the token is saved, the user would be in an inconsistent state (isAuthenticated() true, getUserInfo() undefined). The fix: wrap getCurrentUser()+setUserInfo() in try-catch, log warning to stderr on failure but let login succeed. The 'Logged in as' line is conditional on user info being available. This differs from getUserRegions() failure which should clearAuth() and fail hard (indicates invalid token). Both Sentry Seer and Cursor Bugbot flagged this as a real bug and both suggested the same fix pattern.
<!-- lore:019c9bb9-a797-725d-a271-702795d11894 -->
* **Sentry CLI api command: normalizeFields auto-corrects colon separators with stderr warning**: The \`sentry api\` command's \`--field\` flag requires \`key=value\` format with \`=\` separator. Users frequently confuse this with Sentry search syntax (\`key:value\`) or pass timestamps containing colons (e.g., \`since:2026-02-25T11:20:00\`). The \`normalizeFields()\` function in \`src/commands/api.ts\` auto-corrects \`:\` to \`=\` (splitting on first colon) and prints a warning to stderr, rather than crashing. This is safe because the correction only triggers when no \`=\` exists at all (the field would fail anyway). The normalization runs at the command level in \`func()\` before \`prepareRequestOptions()\`, keeping the parsing functions pure. Fields with \`=\` or ending in \`\[]\` pass through unchanged. The three downstream parsing functions (\`processField\`, \`buildQueryParams\`, \`buildRawQueryParams\`) use \`ValidationError\` instead of raw \`Error\` for truly uncorrectable fields, ensuring clean formatting through the central error handler. PR #302, fixes CLI-9H and CLI-93.
<!-- lore:019c8bbe-bc61-7abe-bc64-0d205fb3f571 -->
* **Sentry CLI plural aliases use route maps with defaultCommand, not direct command refs**: In the Sentry CLI, plural command aliases (issues, projects, orgs, repos, teams, logs, traces) in app.ts point directly to list commands as leaf routes. To prevent \`sentry projects list\` from misinterpreting 'list' as a project slug, all list commands use \`buildListCommand(routeName, config)\` from \`src/lib/list-command.ts\` instead of \`buildCommand(config)\`. \`buildListCommand\` is a transparent wrapper around \`buildCommand\` that intercepts the first positional arg (target) before calling the original func. It checks if the target matches a known subcommand of the singular route (e.g. "list", "view" for "project") and replaces it with \`undefined\` (auto-detect mode) + prints a gentle stderr hint. Subcommand names are extracted dynamically per-route via \`getSubcommandsForRoute(routeName)\`, which lazy-loads the Stricli route map with \`require('../app.js')\` (breaks circular dependency, cached after first call). Three abstraction levels: - \`buildListCommand(routeName, config)\` — any list command gets interception (all 6 commands) - \`buildOrgListCommand(config, docs, routeName)\` — full factory for simple org-scoped lists (team, repo), uses buildListCommand internally - Manual \`buildListCommand\` + custom func — complex commands keep their logic (project, issue, trace, log) Migration per command is one line: \`buildCommand({...})\` → \`buildListCommand("project", {...})\`. Known trade-off: a project literally named 'list' or 'view' can't be targeted via plural alias path. Users can use \`sentry project list list\` or \`sentry projects /list\` for this edge case. PR #281.
<!-- lore:019c8c55-2529-7e00-91e4-ef79cc0a2a56 -->
* **Bun supports require() in ESM modules natively — ignore ESM-only linter warnings**: Bun natively supports \`require()\` in ESM modules (files with \`"type": "module"\` in package.json). This is different from Node.js where require() is not available in ESM. AI code reviewers (BugBot, Seer) may flag \`require()\` in ESM as high-severity bugs — these are false positives when the runtime is Bun. The Sentry CLI uses \`require()\` for lazy dynamic imports to break circular dependencies (e.g. \`require('../app.js')\` in list-command.ts to extract route subcommand names). For the npm distribution, this is also safe because esbuild bundles everything into a single CJS file (\`dist/bin.cjs\`) where \`require()\` is native — esbuild resolves and inlines all requires at bundle time. Bun docs: https://bun.sh/docs/runtime/modules#using-require

### Preference

<!-- lore:019ca136-0d56-7fa5-bf1c-0a7afd75dab3 -->
* **General coding preference**: Prefer explicit error handling over silent failures
<!-- lore:019ca136-0d16-7792-af27-51be8ee29d4e -->
* **Code style**: User prefers no backwards-compat shims, fix callers directly
<!-- lore:019c9f9c-40f3-7b3e-99ba-a3af2e56e519 -->
* **Progress message format: 'N and counting (up to M)...' pattern**: User prefers progress messages that frame the limit as a ceiling rather than an expected total. Format: \`Fetching issues, 30 and counting (up to 50)...\` — not \`Fetching issues... 30/50\`. The 'up to' framing makes it clear the denominator is a max, not an expected count, avoiding confusion when fewer items exist than the limit. For multi-target fetches, include target count: \`Fetching issues from 10 projects, 30 and counting (up to 50)...\`. Initial message before any results: \`Fetching issues (up to 50)...\` or \`Fetching issues from 10 projects (up to 50)...\`.
<!-- End lore-managed section -->

<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/opencode-lore) -->
## Long-term Knowledge

### Architecture

<!-- lore:019c9e9c-fa93-71cd-8fcb-b51ca2bce2ed -->
* **@sentry/node-core pulls in @apm-js-collab/code-transformer (3.3MB) but it's tree-shaken**: The dependency chain \`@sentry/node\` → \`@sentry/node-core\` → \`@apm-js-collab/tracing-hooks\` → \`@apm-js-collab/code-transformer\` adds a 3.3MB input file to the esbuild bundle analysis. However, esbuild fully tree-shakes it out — it contributes 0 bytes to the final npm bundle output. This was verified by checking both the released 0.13.0 bundle and the current build: neither contains any \`code-transformer\` or \`apm-js-collab\` strings. Don't be alarmed by its presence in metafile inputs.
<!-- lore:019c978a-18b8-7db4-999d-9404ba430df7 -->
* **GitHub Packages has no generic/raw file registry — only typed registries**: GitHub Packages only supports typed registries (Container/npm/Maven/NuGet/RubyGems) — there is no generic file store where you can upload a binary and get a download URL. For distributing arbitrary binaries: the Container registry (ghcr.io) via ORAS works but requires a 3-step download (token → manifest → blob). The npm registry at \`npm.pkg.github.com\` requires authentication even for public packages, making it unsuitable for install scripts. This means for binary distribution on GitHub without GitHub Releases, GHCR+ORAS is the only viable GitHub Packages option.
<!-- lore:019c978a-18b5-7a0d-a55f-b72f7789bdac -->
* **cli.sentry.dev is served from gh-pages branch via GitHub Pages**: The \`cli.sentry.dev\` domain points to GitHub Pages for the getsentry/cli repo, confirmed by the CNAME file on the gh-pages branch containing \`cli.sentry.dev\`. The branch contains the Astro/Starlight docs site output plus the install script at \`/install\`. Craft's gh-pages target manages this branch, wiping and replacing all content on each stable release. The docs are built as a zip artifact named \`gh-pages.zip\` (matched by Craft's \`DEFAULT\_DEPLOY\_ARCHIVE\_REGEX: /^(?:.+-)?gh-pages\\.zip$/\`).
<!-- lore:2c3eb7ab-1341-4392-89fd-d81095cfe9c4 -->
* **npm bundle requires Node.js >= 22 due to node:sqlite polyfill**: The Sentry CLI npm package (dist/bin.cjs) requires Node.js >= 22 because the bun:sqlite polyfill uses Node.js 22's built-in \`node:sqlite\` module. The \`require('node:sqlite')\` happens during module loading (via esbuild's inject option) — before any user code runs. package.json declares \`engines: { node: '>=22' }\` but pnpm/npm don't enforce this by default. A runtime version guard in the esbuild banner catches this early with a clear error message pointing users to either upgrade Node.js or use the standalone binary (\`curl -fsSL https://cli.sentry.dev/install | bash\`).
<!-- lore:019c972c-9f0d-7c8e-95b1-7beda99c36a8 -->
* **parseSentryUrl does not handle subdomain-style SaaS URLs**: The URL parser in src/lib/sentry-url-parser.ts handles both path-based (\`/organizations/{org}/...\`) and subdomain-style (\`https://{org}.sentry.io/issues/123/\`) SaaS URLs. The \`matchSubdomainOrg()\` function extracts the org from the hostname when it ends with \`.sentry.io\`, supports \`/issues/{id}/\`, \`/issues/{id}/events/{eventId}/\`, and \`/traces/{traceId}/\` paths. Region subdomains (\`us\`, \`de\`) are filtered out by requiring org slugs to be longer than 2 characters. Confirmed against getsentry/sentry codebase: the subdomain IS the org slug directly (e.g., \`my-org.sentry.io\`), NOT a fixed prefix like \`o.sentry.io\`. The Sentry backend builds permalinks via \`organization.absolute\_url()\` → \`generate\_organization\_url(slug)\` using the \`system.organization-base-hostname\` template \`{slug}.sentry.io\` (src/sentry/organizations/absolute\_url.py:72-92). When customer domains are enabled (production SaaS), \`customer\_domain\_path()\` strips \`/organizations/{slug}/\` from paths. Region subdomains are filtered by Sentry's \`subdomain\_is\_region()\`, aligning with the \`org.length <= 2\` check. Self-hosted uses path-based: \`/organizations/{org\_slug}/issues/{id}/\`.
<!-- lore:019c972c-9f0f-75cd-9e24-9bdbb1ac03d6 -->
* **Numeric issue ID resolution returns org:undefined despite API success**: Numeric issue ID resolution now uses a multi-step approach in \`resolveNumericIssue()\` (extracted from \`resolveIssue\` to reduce cognitive complexity). Resolution order: (1) \`resolveOrg({ cwd })\` tries DSN/env/config for org context, (2) if org found, uses \`getIssueInOrg(org, id)\` with region routing, (3) if no org, falls back to unscoped \`getIssue(id)\`, (4) extracts org from \`issue.permalink\` via \`parseSentryUrl\` as final fallback. The \`explicit-org-numeric\` case now uses \`getIssueInOrg(parsed.org, id)\` instead of the unscoped endpoint. \`getIssueInOrg\` was added to api-client.ts using the SDK's \`retrieveAnIssue\` with the standard \`getOrgSdkConfig + unwrapResult\` pattern. The \`resolveOrgAndIssueId\` wrapper (used by \`explain\`/\`plan\`) no longer throws "Organization is required" for bare numeric IDs when the permalink contains the org slug.
<!-- lore:019c913d-c193-7abb-ace2-c8674e9b7cc6 -->
* **Install script nightly channel support**: The curl install script (\`cli.sentry.dev/install\`) supports \`--channel nightly\`. For nightly: downloads the binary directly from the \`nightly\` release tag (no version.json fetch needed — just uses \`nightly\` as both download tag and display string). Passes \`--channel nightly\` to \`$binary cli setup --install --method curl --channel nightly\` so the channel is persisted in DB. Usage: \`curl -fsSL https://cli.sentry.dev/install | bash -s -- --channel nightly\`. The install script does NOT fetch version.json — that's only used by the upgrade/version-check flow to compare versions.

### Decision

<!-- lore:019c9700-0fc7-7ae6-9545-cc5ce70b1366 -->
* **Nightly release: delete-then-upload instead of clobber for asset management**: The publish-nightly CI job deletes ALL existing release assets before uploading new ones, rather than using \`gh release upload --clobber\`. This ensures that if asset names change (e.g., removing a platform or renaming files), stale assets don't linger on the nightly release indefinitely. Pattern: \`gh release view nightly --json assets --jq '.assets\[].name' | while read -r name; do gh release delete-asset nightly "$name" --yes; done\` followed by \`gh release upload nightly \<files>\` (no --clobber needed since assets were cleared).
<!-- lore:019c99d5-69f2-74eb-8c86-411f8512801d -->
* **Raw markdown output for non-interactive terminals, rendered for TTY**: Design decision for getsentry/cli: output raw CommonMark markdown when stdout is not interactive (piped, redirected, CI), and only render through marked-terminal when a human is looking at it in a TTY. Detection: \`const isInteractive = process.stdout.isTTY\` — no \`process.env.CI\` check needed, since if a CI runner allocates a pseudo-TTY it can render the styled output fine. Override env vars with precedence: \`SENTRY\_PLAIN\_OUTPUT\` (most specific) > \`NO\_COLOR\` > auto-detect via \`isTTY\`. \`SENTRY\_PLAIN\_OUTPUT=1\` forces raw markdown even on TTY; \`SENTRY\_PLAIN\_OUTPUT=0\` forces rendered even when piped. \`NO\_COLOR\` (no-color.org standard) also triggers plain mode since rendered output is ANSI-colored. Chalk auto-disables colors when piped, so pre-embedded ANSI codes become plain text in raw mode. Output modes: \`--json\` → JSON (unchanged), TTY → rendered markdown via marked-terminal, non-TTY → raw CommonMark. For streaming formatters (log/trace row-by-row output), TTY keeps current ANSI-colored padded text for efficient incremental display, while non-TTY emits markdown table rows with header+separator on first write, producing valid markdown files when redirected.

### Gotcha

<!-- lore:019c9ba5-5158-77df-b32d-08980d0753c4 -->
* **git notes are lost on commit amend — must re-attach to new SHA**: Git notes are attached to a specific commit SHA. When you \`git commit --amend\`, the old commit is replaced with a new one (different SHA), and the note attached to the old SHA becomes orphaned. After amending, you must re-add the note to the new commit with \`git notes add\` targeting the new SHA. This also affects \`git push --force\` of notes refs — the remote note ref still points to the old SHA.
<!-- lore:019c9be1-33ca-714e-8ad9-dfda5350a106 -->
* **pnpm overrides with version-range keys don't force upgrades of already-compatible resolutions**: pnpm overrides with version-range selectors like \`"minimatch@>=10.0.0 <10.2.1": ">=10.2.1"\` do NOT work as expected for forcing upgrades of transitive deps that already satisfy their parent's semver range. If a parent requests \`^10.1.1\` and pnpm resolves \`10.1.1\`, the override key \`>=10.0.0 <10.2.1\` should match but doesn't reliably force re-resolution — even with \`pnpm install --force\`. The workaround is a blanket override without a version selector: \`"minimatch": ">=10.2.1"\`. This is only safe when ALL consumers are on the same major version line (otherwise it's a breaking change). Verify first with \`pnpm why \<pkg>\` that no other major versions exist in the tree before using a blanket override.
<!-- lore:019c9be1-33d1-7b6e-b107-ae7ad42a4ea4 -->
* **pnpm overrides with >= can cross major versions — use ^ to constrain**: When using pnpm overrides to patch a transitive dependency vulnerability, \`"ajv@<6.14.0": ">=6.14.0"\` will resolve to the latest ajv (v8.x), not the latest 6.x. ajv v6 and v8 have incompatible APIs — this broke eslint (\`@eslint/eslintrc\` calls \`ajv\` v6 API, crashes with \`Cannot set properties of undefined (setting 'defaultMeta')\` on v8). Fix: use \`"ajv@<6.14.0": "^6.14.0"\` to constrain within the same major. This applies to any override where the target package has multiple major versions in the registry — always use \`^\` (or \`~\`) instead of \`>=\` to stay within the compatible major line.
<!-- lore:019c9e9c-fa8f-7ab2-b26e-d47e50cb04bb -->
* **marked-terminal unconditionally imports cli-highlight and node-emoji — no tree-shaking possible**: marked-terminal has static top-level imports of \`cli-highlight\` (which pulls in highlight.js, ~570KB minified output) and \`node-emoji\` (which pulls in emojilib, ~208KB minified output) at lines 5-6 of its index.js. These are unconditional — there's no config option to disable them, and the \`emoji: false\` option only skips the emoji replacement function but doesn't prevent the import. esbuild cannot tree-shake static imports. This means any bundle including marked-terminal will grow by ~970KB (highlight.js + emojilib + parse5). To avoid this in a CLI bundle, you'd need to either: (1) write a custom marked renderer using only chalk, (2) fork marked-terminal with dynamic imports, or (3) use esbuild's \`external\` option (but then those packages must be available at runtime).
<!-- lore:019c9eb7-a640-776a-929d-89120f81733a -->
* **pnpm-lock.yaml merge conflicts: regenerate don't manually merge**: When \`pnpm-lock.yaml\` has merge conflicts, never try to manually resolve the conflict markers. Instead: (1) \`git checkout --theirs pnpm-lock.yaml\` (or \`--ours\` depending on which package.json changes you want as base), (2) run \`pnpm install\` to regenerate the lockfile incorporating both sides' \`package.json\` changes (including overrides). This produces a clean lockfile that reflects the merged dependency state. Manual conflict resolution in lockfiles is error-prone and unnecessary since pnpm can regenerate it deterministically.
<!-- lore:019c9eb7-a648-70f7-8a8d-5fc5b5c0f221 -->
* **git stash pop after merge can cause second conflict on same file**: When you stash local changes, merge, then \`git stash pop\`, the stash apply can create a NEW conflict on the same file that was just conflict-resolved in the merge. This happens because the stash was based on the pre-merge state and conflicts with the post-merge-resolution content. The resolution requires a second manual conflict resolution pass. To avoid: if stashed changes are lore/auto-generated content, consider just dropping the stash and re-running the generation tool after merge instead of popping.
<!-- lore:019c9ee7-f55a-7ab0-9f4a-4147b5f535c2 -->
* **pnpm overrides become stale when dependency tree changes — audit with pnpm why**: pnpm overrides can become orphaned when the dependency tree changes. For example, removing a package that was the sole consumer of a transitive dep (like removing \`@sentry/typescript\` which pulled in \`tslint\` which was the only consumer of \`diff\`), or upgrading a package that switches to a differently-named dependency (like \`minimatch@10.2.4\` switching from \`@isaacs/brace-expansion\` to the unscoped \`brace-expansion\`). Orphaned overrides sit silently in package.json and could unexpectedly constrain versions if a future dependency reintroduces the package name. After removing packages or upgrading dependencies that change the transitive tree, audit overrides with \`pnpm why \<pkg>\` to verify each override still has consumers in the resolved tree. Remove any that return empty results.
<!-- lore:019c9f57-aa0c-7a2a-8a10-911b13b48fc0 -->
* **ESM modules prevent vi.spyOn of child\_process.spawnSync — use test subclass pattern**: In Vitest with ESM, you cannot spy on exports from Node built-in modules like \`child\_process.spawnSync\` — it throws \`Cannot spy on export. Module namespace is not configurable in ESM\`. The workaround for testing code that calls \`spawnSync\` (like npm version checks) is to create a test subclass that overrides the method calling \`spawnSync\` and injects controllable values. Example: \`TestNpmTarget\` overrides \`checkRequirements()\` to set \`this.npmVersion\` from a static \`mockVersion\` field instead of calling \`spawnSync(npm, \['--version'])\`. This avoids the ESM limitation while keeping test isolation. \`vi.mock\` at module level is another option but affects all tests in the file.
<!-- lore:019c9f57-aa13-7ab1-8f2a-e5c9e8df1e81 -->
* **npm OIDC only works for publish — npm info/view still needs traditional auth**: Per npm docs: "OIDC authentication is currently limited to the publish operation. Other npm commands such as install, view, or access still require traditional authentication methods." This means \`npm info \<package> version\` (used by Craft's \`getLatestVersion()\`) cannot use OIDC tokens. For public packages this is fine — \`npm info\` works without auth. For private packages, a read-only \`NPM\_TOKEN\` is still needed alongside OIDC. Craft handles this by: using token auth for \`getLatestVersion()\` when a token is available, running unauthenticated otherwise, and warning + skipping version checks for private packages in OIDC mode without a token.
<!-- lore:019c9e98-7af4-7e25-95f4-fc06f7abf564 -->
* **Bun binary build requires SENTRY\_CLIENT\_ID env var**: The build script (\`script/bundle.ts\`) requires \`SENTRY\_CLIENT\_ID\` environment variable and exits with code 1 if missing. When building locally, use \`bun run --env-file=.env.local build\` or set the env var explicitly. The binary build (\`bun run build\`) also needs it. Without it you get: \`Error: SENTRY\_CLIENT\_ID environment variable is required.\`
<!-- lore:019c99d0-aa4a-7665-90f5-9abbb61104ae -->
* **marked and marked-terminal must be devDependencies in bundled CLI projects**: In the getsentry/cli project, all npm packages used at runtime must be bundled by the build step (esbuild). Packages like \`marked\` and \`marked-terminal\` belong in \`devDependencies\`, not \`dependencies\`. The CI \`check:deps\` step enforces this — anything in \`dependencies\` that isn't a true runtime requirement (native addon, bin entry) will fail the check. This applies to all packages consumed only through the bundle.
<!-- lore:019c99d0-aa44-79fa-9c0a-2c0e8bbcd333 -->
* **CodeQL flags incomplete markdown cell escaping — must escape backslash before pipe**: When escaping user content for markdown table cells, replacing only \`|\` with \`\\|\` triggers CodeQL's "Incomplete string escaping or encoding" alert (high severity). The fix is to escape backslashes first, then pipes: \`str.replace(/\\\\/g, "\\\\\\\\" ).replace(/\\|/g, "\\\\|")\`. In getsentry/cli this is centralized as \`escapeMarkdownCell()\` in \`src/lib/formatters/markdown.ts\`. All formatters that build markdown table rows (human.ts, log.ts, trace.ts) must use this helper instead of inline \`.replace()\` calls.
<!-- lore:019c969a-1c90-7041-88a8-4e4d9a51ebed -->
* **Multiple mockFetch calls replace each other — use unified mocks for multi-endpoint tests**: In getsentry/cli tests, \`mockFetch()\` sets \`globalThis.fetch\` to a new function. Calling it twice replaces the first mock entirely. A common bug: calling \`mockBinaryDownload()\` then \`mockGitHubVersion()\` means the binary download URL hits the version mock (returns 404). Fix: create a single unified fetch mock that handles ALL endpoints the test needs (version API, binary download, npm registry, version.json). Pattern: \`\`\`typescript mockFetch(async (url) => { const urlStr = String(url); if (urlStr.includes('releases/latest')) return versionResponse; if (urlStr.includes('version.json')) return nightlyResponse; return new Response(gzipped, { status: 200 }); // binary download }); \`\`\` This caused multiple test failures when trying to test the full upgrade→download→setup pipeline.
<!-- lore:019c977a-9c0b-76b8-a2e4-4bf8bf46e59d -->
* **marked-terminal@7 peer dependency requires marked < 16**: \`marked-terminal@7.3.0\` declares a peer dependency of \`marked@>=1 <16\`. Installing \`marked@17\` triggers a peer dependency warning and may cause runtime issues. Use \`marked@^15\` (e.g., \`marked@15.0.12\`) for compatibility. In Bun, peer dependency warnings don't block installation but the version mismatch can cause subtle breakage.
<!-- lore:019c992d-8e38-7148-91db-baa5029eb2c3 -->
* **ghcr.io blob download: curl -L breaks because auth header leaks to Azure redirect**: When downloading blobs from ghcr.io via raw HTTP, the registry returns a 307 redirect to a signed Azure Blob Storage URL (\`pkg-containers.githubusercontent.com\`). Using \`curl -L\` with the \`Authorization: Bearer \<token>\` header fails with 404 because curl forwards the auth header to Azure, which rejects it. Fix: don't use \`-L\`. Instead, extract the redirect URL and follow it separately: \`\`\`bash REDIR=$(curl -s -w '\n%{redirect\_url}' -o /dev/null -H "Authorization: Bearer $TOKEN" "$BLOB\_URL" | tail -1) curl -sf "$REDIR" -o output.file \`\`\` This affects any tool using raw HTTP to pull from ghcr.io — the ORAS CLI handles this internally but install scripts using plain curl need the two-step approach.
<!-- lore:019c992d-8e3a-761a-a6b4-44582d0eed4f -->
* **GHCR packages created as private by default — must manually make public once**: When first pushing to \`ghcr.io/getsentry/cli\` via ORAS or Docker, the container package is created with \`visibility: private\`. Anonymous pulls fail until the package is made public. This is a one-time manual step via GitHub UI at the package settings page (Danger Zone → Change visibility → Public). The GitHub Packages API for changing visibility requires org admin scopes that aren't available via \`gh auth\` by default. For the getsentry/cli nightly distribution, the package has already been made public.
<!-- lore:019c978a-18b3-7bc7-8533-dc2448ea8c5e -->
* **Craft gh-pages target wipes entire branch on publish**: Craft's \`GhPagesTarget.commitArchiveToBranch()\` runs \`git rm -r -f .\` before extracting the docs archive, deleting ALL existing files on the gh-pages branch. Any additional files placed there (e.g., nightly binaries in a \`nightly/\` directory) would be wiped on every stable release. The \`cli.sentry.dev\` site is served from the gh-pages branch (CNAME file confirms this). If using gh-pages for hosting non-docs files, either accept the brief outage window until the next main push re-adds them, add a \`postReleaseCommand\` in \`.craft.yml\` to restore the files, or use a different hosting mechanism entirely.
<!-- lore:019c9776-e3e3-7dba-a1a4-a7ea2270440f -->
* **upload-artifact strips directory prefix from glob paths**: When \`actions/upload-artifact@v4\` uploads with \`path: dist-bin/sentry-\*\`, it strips the \`dist-bin/\` directory prefix — the artifact stores files as \`sentry-linux-x64\`, \`sentry-linux-x64.gz\`, etc. at the root level. When \`actions/download-artifact@v4\` with \`merge-multiple: true\` and \`path: artifacts\` downloads these, files end up at \`artifacts/sentry-\*.gz\`, NOT \`artifacts/dist-bin/sentry-\*.gz\`. This caused the publish-nightly job to fail with \`no matches found for artifacts/dist-bin/\*.gz\`. The fix was changing the glob to \`artifacts/\*.gz\`.
<!-- lore:019c9776-e3dd-7632-88b8-358a19506218 -->
* **GitHub immutable releases prevent rolling nightly tag pattern**: The getsentry/cli repo has immutable releases enabled (org/repo setting, will NOT be turned off). This means: (1) once a release is published, its assets cannot be modified or deleted, (2) a tag used by a published release can NEVER be reused, even after deleting the release — \`gh release delete nightly --cleanup-tag\` followed by \`gh release create nightly\` fails with \`tag\_name was used by an immutable release\`. Draft releases ARE mutable but use unpredictable \`/download/untagged-xxx/\` URLs instead of tag-based URLs, and publishing a draft with a previously-used tag also fails. This breaks the original nightly design of a single rolling \`nightly\` tag. The \`nightly\` tag is now permanently poisoned. New approach needed: per-version release tags (e.g., \`0.13.0-dev.1772062077\`) with API-based discovery of the latest prerelease.
<!-- lore:019c9741-d78e-73b1-87c2-e360ef6c7475 -->
* **useTestConfigDir without isolateProjectRoot causes DSN scanning of repo tree**: In getsentry/cli tests, \`useTestConfigDir()\` creates temp dirs under \`.test-tmp/\` inside the repo tree. When code calls \`detectDsn(cwd)\` with this temp dir as cwd (e.g., via \`resolveOrg({ cwd })\`), \`findProjectRoot\` walks up from \`.test-tmp/prefix-xxx\` and finds the repo's \`.git\` directory, causing DSN detection to scan the actual source code for Sentry DSNs. This can trigger network calls that hit test fetch mocks (returning 404s or unexpected responses), leading to 5-second test timeouts. Fix: always use \`useTestConfigDir(prefix, { isolateProjectRoot: true })\` when the test exercises any code path that might call \`resolveOrg\`, \`detectDsn\`, or \`findProjectRoot\` with the config dir as cwd. The \`isolateProjectRoot\` option creates a \`.git\` directory inside the temp dir, stopping the upward walk immediately.
<!-- lore:019c969a-1c83-7d65-a76e-10c40473059d -->
* **mock.module bleeds across Bun test files — never include test/isolated/ in test:unit**: In Bun's test runner, \`mock.module()\` pollutes the shared module registry for ALL subsequently-loaded test files in the same \`bun test\` invocation. Including \`test/isolated/\` in \`test:unit\` caused 132 failures because the \`node:child\_process\` mock leaked into DB tests, config tests, and others that transitively import child\_process. The \`test:isolated\` script MUST remain separate from \`test:unit\`. This also means isolated test coverage does NOT appear in Codecov PR patch coverage — only \`test:unit\` feeds lcov. Accept that code paths requiring \`mock.module\` (e.g., \`node:child\_process spawn\` wrappers like \`runCommand\`, \`isInstalledWith\`, \`executeUpgradeHomebrew\`, \`executeUpgradePackageManager\`) will have zero Codecov coverage.
<!-- lore:019c94f0-2ab4-74b2-8bfa-d3ddfbb97d70 -->
* **GitHub Actions: use deterministic timestamps across jobs, not Date.now()**: When multiple GitHub Actions jobs need to agree on a timestamp-based version string (e.g., nightly builds where \`build-binary\` bakes the version in and \`publish-nightly\` creates version.json), never use \`Date.now()\` or \`Math.floor(Date.now()/1000)\` independently in each job. Jobs run at different times, producing different timestamps. Instead, derive the timestamp from a shared deterministic source like \`github.event.head\_commit.timestamp\` (the commit time). Convert to Unix seconds: \`date -d '\<iso-timestamp>' +%s\`. This ensures all matrix entries and downstream jobs produce the same version string.
<!-- lore:019c8b1b-d564-7a12-a9dc-bf3515707538 -->
* **version-check.test.ts has pre-existing unmocked fetch calls**: In getsentry/cli, \`test/lib/version-check.test.ts\` makes unmocked fetch calls to \`https://api.github.com/repos/getsentry/cli/releases/latest\` and to Sentry's ingest endpoint. These are pre-existing issues that produce \`\[TEST] Unexpected fetch call\` warnings in test output but don't cause test failures. Not related to any specific PR — existed before the Homebrew changes.
<!-- lore:019c8ab6-d119-7365-9359-98ecf464b704 -->
* **@sentry/api SDK passes Request object to custom fetch — headers lost on Node.js**: The @sentry/api SDK creates a \`Request\` object with Content-Type set in its headers, then calls \`\_fetch(request2)\` with only one argument (no init). In sentry-client.ts's \`authenticatedFetch\`, \`init\` is undefined, so \`prepareHeaders(init, token)\` creates empty headers from \`new Headers(undefined)\`. When \`fetch(Request, {headers})\` is called, Node.js strictly follows the spec where init headers replace Request headers entirely — stripping Content-Type. This causes HTTP 415 'Unsupported media type' errors on POST requests (e.g., startSeerIssueFix). Bun may merge headers instead, so the bug only manifests under Node.js runtime. Fix: \`prepareHeaders\` must accept the input parameter and fall back to \`input.headers\` when \`init\` is undefined. Also fix method extraction: \`init?.method\` returns undefined for Request-only calls, defaulting to 'GET' even for POST requests.
<!-- lore:019c8a7a-5321-7a48-a86c-1340ee3e90db -->
* **Several commands bypass telemetry by importing buildCommand from @stricli/core directly**: src/lib/command.ts wraps Stricli's buildCommand to auto-capture flag/arg telemetry via Sentry. But trace/list, trace/view, log/view, api.ts, and help.ts import buildCommand directly from @stricli/core, silently skipping telemetry. Fix: change their imports to use ../../lib/command.js. Consider adding a Biome lint rule (noRestrictedImports equivalent) to prevent future regressions.
<!-- lore:019c8a7a-531b-75b0-a89a-0f6bdcb22c5d -->
* **@sentry/api SDK issues filed to sentry-api-schema repo**: All @sentry/api SDK issues should be filed to https://github.com/getsentry/sentry-api-schema/ and assigned to @MathurAditya724. Two known issues: (1) unwrapResult() discards Link response headers, silently truncating listTeams/listRepositories at 100 items and preventing cursor pagination. (2) No paginated variants exist for team/repo/issue list endpoints, forcing callers to bypass the SDK with raw requests.
<!-- lore:4729229d-36b9-4118-b90b-ea8151e6928f -->
* **Esbuild banner template literal double-escape for newlines**: When using esbuild's \`banner\` option with a TypeScript template literal containing string literals that need \`\n\` escape sequences: use \`\\\\\\\n\` in the TS source. The chain is: TS template literal \`\\\\\\\n\` → esbuild banner output \`\\\n\` → JS runtime interprets as newline. Using only \`\\\n\` in the TS source produces a literal newline character inside a JS double-quoted string, which is a SyntaxError. This applies to any esbuild banner/footer that injects JS strings containing escape sequences. Discovered in script/bundle.ts for the Node.js version guard error message.
<!-- lore:019c9556-e369-791d-8fad-01be6aa3633a -->
* **Craft minVersion >= 2.21.0 silently disables custom bump-version.sh**: When \`minVersion\` in \`.craft.yml\` is >= 2.21.0 and no \`preReleaseCommand\` is defined, Craft switches from running the default \`bash scripts/bump-version.sh\` to automatic version bumping based on configured publish targets. If the only target is \`github\` (which doesn't support auto-bump — only npm, pypi, crates, gem, pub-dev, hex, nuget do), the version bump silently does nothing. The release gets tagged with unbumped files. Fix: explicitly set \`preReleaseCommand: bash scripts/bump-version.sh\` in \`.craft.yml\` when using a custom bump script with targets that don't support auto-bump. This caused the 26.2.0 release to ship with \`:nightly\` image tags.
<!-- lore:019c99d5-69f8-716b-8908-a42537cc5a83 -->
* **Streaming formatters can't use marked-terminal incrementally — tables need all rows**: Markdown tables rendered through marked-terminal (via cli-table3) require all rows upfront to compute column widths. You cannot incrementally render one row at a time through \`renderMarkdown()\`. For streaming/polling formatters like \`formatLogRow\`, \`formatTraceRow\`, \`formatLogsHeader\` that write row-by-row, two approaches: (1) TTY mode: keep current padded text with ANSI colors for efficient incremental display, (2) non-TTY mode: emit raw markdown table row syntax (\`| col | col |\`) which is independently readable without width calculation. Individual cell \*values\* can still be styled via \`renderInlineMarkdown()\` (using \`marked.parseInline()\`) — this renders inline markdown like \`\*\*bold\*\*\`, \`\` \`code\` \`\`, and \`\*italic\*\` without block-level wrapping. This lets streaming rows benefit from markdown formatting per-cell without needing the full table pipeline. This means streaming formatters bypass \`renderMarkdown()\` by design but can use the inline variant.

### Pattern

<!-- lore:019c9bb9-a79b-71e0-9f71-d94e77119b4b -->
* **CLI UX: auto-correct common user mistakes with stderr warnings instead of hard errors**: When a CLI command can unambiguously detect a common user mistake (like using the wrong separator character), prefer auto-correcting the input and printing a warning to stderr over throwing a hard error. This is safe when: (1) the input is already invalid and would fail anyway, (2) there's no ambiguity in the correction, and (3) the warning goes to stderr so it doesn't interfere with JSON/stdout output. Implementation pattern: normalize inputs at the command level before passing to pure parsing functions, keeping the parsers side-effect-free. The \`gh\` CLI (GitHub CLI) is the UX model — match its conventions.
<!-- lore:019c9e9c-fa91-758c-8be9-f8ddb4e46eb5 -->
* **esbuild metafile output bytes vs input bytes — use output for real size impact**: When analyzing bundle size with esbuild's metafile, \`result.metafile.inputs\` shows raw source file sizes BEFORE minification and tree-shaking — these are misleading for size impact analysis. A 3.3MB input file may contribute 0 bytes to output if tree-shaken. Use \`result.metafile.outputs\[outfile].inputs\` to see actual per-file output contribution after minification. To dump metafile: add \`import { writeFileSync } from 'node:fs'; writeFileSync('/tmp/meta.json', JSON.stringify(result.metafile));\` after the build call, then analyze with \`jq\`. The bundle script at script/bundle.ts generates metafile but doesn't write it to disk by default.
<!-- lore:019c969a-1c8a-7045-b8ee-ac7dcc245888 -->
* **Bun.spawn is writable — use direct assignment for test spying instead of mock.module**: Unlike \`node:child\_process\` imports (which require \`mock.module\` and isolated test files), \`Bun.spawn\` is a writable property on the global \`Bun\` object. Tests can replace it directly in \`beforeEach\`/\`afterEach\` without module-level mocking: \`\`\`typescript let originalSpawn: typeof Bun.spawn; beforeEach(() => { originalSpawn = Bun.spawn; Bun.spawn = ((cmd, \_opts) => ({ exited: Promise.resolve(0), })) as typeof Bun.spawn; }); afterEach(() => { Bun.spawn = originalSpawn; }); \`\`\` This avoids the mock.module bleed problem entirely and works in regular \`test:unit\` files (counts toward Codecov). Used successfully in \`test/commands/cli/upgrade.test.ts\` to test \`runSetupOnNewBinary\` and \`migrateToStandaloneForNightly\` which spawn child processes via \`Bun.spawn\`.
<!-- lore:019c977a-9c08-7bcb-8ce9-32c07dcc6b4d -->
* **ANSI codes survive marked-terminal + cli-table3 pipeline in table cells**: Pre-rendered ANSI escape codes (e.g., from chalk) embedded in markdown table cell values survive the \`marked\` → \`marked-terminal\` → \`cli-table3\` rendering pipeline. cli-table3 uses \`string-width\` which correctly treats ANSI codes as zero-width for column width calculation. This means you can pre-color individual cell values with chalk/ANSI before embedding them in a markdown table string, and the colors will render correctly in the terminal. Verified experimentally in getsentry/cli with \`marked@15\` + \`marked-terminal@7.3.0\` running under Bun. This enables per-cell semantic coloring (e.g., red for errors, green for resolved) in markdown-rendered tables without needing markdown color syntax (which doesn't exist).
<!-- lore:019c9793-fb21-77f5-bd3a-1991044fc379 -->
* **Formatter return type migration: string\[] to string for markdown rendering**: The formatter functions (\`formatLogDetails\`, \`formatTraceSummary\`, \`formatOrgDetails\`, \`formatProjectDetails\`, \`formatIssueDetails\`) were migrated from returning \`string\[]\` (array of lines) to returning \`string\` (rendered markdown). When updating tests for this migration: (1) remove \`.join("\n")\` calls, (2) replace \`.map(stripAnsi)\` with \`stripAnsi(result)\`, (3) replace \`Array.isArray(result)\` checks with \`typeof result === "string"\`, (4) replace line-by-line exact match tests (\`lines\[0] === "..."\`, \`lines.some(l => l.includes(...))\`) with content-based checks (\`result.includes(...)\`) since markdown tables render with Unicode box-drawing characters, not padded text columns. The \`writeTable()\` function also changed from text-padded columns to markdown table rendering.
<!-- lore:019c9793-fb1c-7986-936e-57949e9a30d0 -->
* **Markdown table structure for marked-terminal: blank header row + separator + data rows**: When building markdown tables for \`marked-terminal\` rendering in this codebase, the pattern is: blank header row (\`| | |\`), then separator (\`|---|---|\`), then data rows (\`| \*\*Label\*\* | value |\`). Putting data rows before the separator produces malformed tables where cell values don't render. This was discovered when the SDK section in \`log.ts\` had the data row before the separator, causing the SDK name to not appear in output. All key-value detail sections (Context, SDK, Trace, Source Location, OpenTelemetry) in \`formatLogDetails\`, \`formatOrgDetails\`, \`formatProjectDetails\`, \`formatIssueDetails\`, and \`formatTraceSummary\` use this pattern.
<!-- lore:019c972c-9f11-7c0d-96ce-3f8cc2641175 -->
* **Org-scoped SDK calls follow getOrgSdkConfig + unwrapResult pattern**: All org-scoped API calls in src/lib/api-client.ts follow this pattern: (1) call \`getOrgSdkConfig(orgSlug)\` which resolves the org's regional URL and returns an SDK client config, (2) spread config into the SDK function call: \`{ ...config, path: { organization\_id\_or\_slug: orgSlug, ... } }\`, (3) pass result to \`unwrapResult(result, errorContext)\`. There are 14+ usages of this pattern. The \`getOrgSdkConfig\` function (line ~167) calls \`resolveOrgRegion(orgSlug)\` then \`getSdkConfig(regionUrl)\`. Follow this exact pattern when adding new org-scoped endpoints like \`getIssueInOrg\`.
<!-- lore:5ac4e219-ea1f-41cb-8e97-7e946f5848c0 -->
* **PR workflow: wait for Seer and Cursor BugBot before resolving**: After pushing a PR in the getsentry/cli repo, the CI pipeline includes Seer Code Review and Cursor Bugbot as required or advisory checks. Both typically take 2-3 minutes. The workflow is: push → wait for all CI (including npm build jobs which test the actual bundle) → check for inline review comments from Seer/BugBot → fix if needed → repeat. Use \`gh pr checks \<PR> --watch\` to monitor. Review comments are fetched via \`gh api repos/OWNER/REPO/pulls/NUM/comments\` and \`gh api repos/OWNER/REPO/pulls/NUM/reviews\`.
<!-- lore:019c8b1b-d55e-7b5a-9e90-1a5b2dc2a695 -->
* **Isolated test files for mock.module in Bun tests**: In the getsentry/cli repo, tests that use Bun's \`mock.module()\` must be placed in \`test/isolated/\` as separate test files AND run via the separate \`test:isolated\` script (not \`test:unit\`). \`mock.module\` affects the entire module registry and bleeds into ALL subsequently-loaded test files in the same \`bun test\` invocation. Attempting to include \`test/isolated/\` in \`test:unit\` caused 132 test failures from \`node:child\_process\` mock pollution. Consequence: isolated test coverage does NOT appear in Codecov PR patch metrics. For code using \`Bun.spawn\` (not \`node:child\_process\`), prefer direct property assignment (\`Bun.spawn = mockFn\`) in regular test files instead — \`Bun.spawn\` is writable and doesn't require mock.module.
<!-- lore:019c91a8-88ed-747c-8216-dc7082b5c6fe -->
* **GitHub Actions: skipped needs jobs don't block downstream**: In GitHub Actions, if a job in \`needs\` is skipped due to its \`if\` condition evaluating to false, downstream jobs that depend on it still run (skipped ≠ failed). Output values from the skipped job are empty strings. This enables a pattern where a job like \`nightly-version\` has \`if: github.ref == 'refs/heads/main'\` and downstream jobs like \`build-binary\` list it in \`needs\` — on PRs the nightly job is skipped, outputs are empty, and conditional steps using \`if: needs.nightly-version.outputs.version != ''\` are safely skipped. No need for complex conditional \`needs\` expressions.
<!-- lore:4c542d55-d00a-4012-aed8-537f56309dc3 -->
* **OpenCode worktree blocks checkout of main — use stash + new branch instead**: When working in the getsentry/cli repo, \`git checkout main\` fails because main is used by an OpenCode worktree at \`~/.local/share/opencode/worktree/\`. Workaround: stash changes, fetch, create a new branch from origin/main (\`git stash && git fetch && git checkout -b \<branch> origin/main && git stash pop\`), then pop stash. Do NOT try to checkout main directly. This also applies when rebasing onto latest main — you must use \`origin/main\` as the target, never the local \`main\` branch.

### Preference

<!-- lore:019c9aa1-f75c-7cf4-921e-cc1d5fdccbe7 -->
* **Code style**: User prefers no backwards-compat shims, fix callers directly
<!-- lore:019c9aa1-f7a2-7c42-b067-a87eff21df63 -->
* **General coding preference**: Prefer explicit error handling over silent failures
<!-- lore:019ca136-0d56-7fa5-bf1c-0a7afd75dab3 -->
* **General coding preference**: Prefer explicit error handling over silent failures
<!-- lore:019ca136-0d16-7792-af27-51be8ee29d4e -->
* **Code style**: User prefers no backwards-compat shims, fix callers directly
<!-- lore:019c974a-546b-7c71-8249-0545c8342ca9 -->
* **.opencode directory should be gitignored**: The \`.opencode/\` directory (used by OpenCode for plans, session data, etc.) should be in \`.gitignore\` and never committed. It was added to \`.gitignore\` alongside \`.idea\` and \`.DS\_Store\` in the editor/tool ignore section.
<!-- lore:019c9700-0fc5-7e76-ab08-aa2cdf2a3267 -->
* **CI: define shared env vars at workflow level, not per-job**: Reviewer (BYK) prefers defining environment variables that are used by multiple jobs at the workflow-level \`env:\` block rather than repeating them in each job's step-level \`env:\`. GitHub Actions workflow-level \`env\` is inherited by all jobs and steps. Example: \`COMMIT\_TIMESTAMP\` was moved from being defined in both \`build-binary\` and \`publish-nightly\` to a single workflow-level declaration.
<!-- lore:019c9700-0fc3-730c-82c3-a290d5ecc2ea -->
* **CI scripts: prefer jq/sed over node -e for JSON manipulation**: Reviewer (BYK) prefers using standard Unix tools (\`jq\`, \`sed\`, \`awk\`) over \`node -e\` for simple JSON manipulation in CI workflow scripts. For example, reading/modifying package.json version: \`jq -r .version package.json\` to read, \`jq --arg v "$NEW" '.version = $v' package.json > tmp && mv tmp package.json\` to write. This avoids requiring Node.js to be installed in CI steps that only need basic JSON operations, and is more readable for shell-centric workflows.
<!-- End lore-managed section -->
