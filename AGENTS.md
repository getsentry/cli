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

<!-- This section is maintained by the coding agent via lore (https://github.com/BYK/opencode-lore) -->
## Long-term Knowledge

### Architecture

<!-- lore:365e4299-37cf-48e0-8f2e-8503d4a249dd -->
* **API client wraps all errors as CliError subclasses — no raw exceptions escape**: The API client (src/lib/api-client.ts) wraps ALL errors as CliError subclasses (ApiError or AuthError) — no raw exceptions escape. Commands don't need try-catch for error display; the central handler in app.ts formats CliError cleanly. Only add try-catch when a command needs to handle errors specially (e.g., login continuing despite user-info fetch failure).
<!-- lore:019c8b60-d21a-7d44-8a88-729f74ec7e02 -->
* **Sentry CLI resolve-target cascade has 5 priority levels with env var support**: Resolve-target cascade (src/lib/resolve-target.ts) has 5 priority levels: (1) Explicit CLI flags, (2) SENTRY\_ORG/SENTRY\_PROJECT env vars, (3) SQLite config defaults, (4) DSN auto-detection, (5) Directory name inference. SENTRY\_PROJECT supports combo notation \`org/project\` — when used, SENTRY\_ORG is ignored. If combo parse fails (e.g. \`org/\`), the entire value is discarded. The \`resolveFromEnvVars()\` helper is injected into all four resolution functions.
<!-- lore:019c8b60-d221-718a-823b-7c2c6e4ca1d5 -->
* **Sentry API: events require org+project, issues have legacy global endpoint**: Sentry API scoping: Events require org+project in URL path (\`/projects/{org}/{project}/events/{id}/\`). Issues use legacy global endpoint (\`/api/0/issues/{id}/\`) without org context. Traces need only org (\`/organizations/{org}/trace/{traceId}/\`). Two-step lookup for events: fetch issue → extract org/project from response → fetch event. Cross-project event search possible via Discover endpoint \`/organizations/{org}/events/\` with \`query=id:{eventId}\`.
<!-- lore:019c8c72-b871-7d5e-a1a4-5214359a5a77 -->
* **Sentry CLI has two distribution channels with different runtimes**: Sentry CLI ships via two pipelines: (1) Standalone binary — \`Bun.build()\` with \`compile: true\`, produces native executables with embedded Bun runtime. (2) npm package — esbuild produces CJS \`dist/bin.cjs\` requiring Node.js 22+. esbuild aliases \`@sentry/bun\` → \`@sentry/node\` and injects Bun API polyfills from \`script/node-polyfills.ts\` covering \`Bun.file()\`, \`Bun.write()\`, \`Bun.which()\`, \`Bun.spawn()\`, \`Bun.sleep()\`, \`Bun.Glob\`, \`Bun.randomUUIDv7()\`, \`Bun.semver.order()\`, and \`bun:sqlite\`. \`Bun.$\` has NO polyfill — use \`execSync\` from \`node:child\_process\` instead. \`require()\` in ESM is safe: Bun supports it natively, and esbuild resolves it at bundle time.

### Decision

<!-- lore:019c8f05-c86f-7b46-babc-5e4faebff2e9 -->
* **Sentry CLI config dir should stay at ~/.sentry/, not move to XDG**: Config dir stays at \`~/.sentry/\` (not XDG). The readonly DB errors on macOS are from \`sudo brew install\` creating root-owned files. Fixes: (1) bestEffort() makes setup steps non-fatal, (2) tryRepairReadonly() detects root-owned files and prints \`sudo chown\` instructions, (3) \`sentry cli fix\` handles ownership repair. Ownership must be checked BEFORE permissions — root-owned files cause chmod to EPERM.
<!-- lore:019c9f9c-40ee-76b5-b98d-acf1e5867ebc -->
* **Issue list global limit with fair per-project distribution and representation guarantees**: \`issue list --limit\` is a global total across all detected projects. \`fetchWithBudget\` Phase 1 divides evenly, Phase 2 redistributes surplus via cursor resume. \`trimWithProjectGuarantee\` ensures at least 1 issue per project before filling remaining slots. JSON output wraps in \`{ data, hasMore }\` with optional \`errors\` array. Compound cursor (pipe-separated) enables \`-c last\` for multi-target pagination, keyed by sorted target fingerprint.
<!-- lore:00166785-609d-4ab5-911e-ee205d17b90c -->
* **whoami should be separate from auth status command**: The \`sentry auth whoami\` command should be a dedicated command separate from \`sentry auth status\`. They serve different purposes: \`status\` shows everything about auth state (token, expiry, defaults, org verification), while \`whoami\` just shows user identity (name, email, username, ID) by fetching live from \`/auth/\` endpoint. \`sentry whoami\` should be a top-level alias (like \`sentry issues\` → \`sentry issue list\`). \`whoami\` should support \`--json\` for machine consumption and be lightweight — no credential verification, no defaults listing.

### Gotcha

<!-- lore:019c8b78-965f-7f67-ae31-d24961133260 -->
* **Codecov patch coverage requires --coverage flag on ALL test invocations**: The test script runs \`bun run test:unit && bun run test:isolated\`. Only \`test:unit\` has \`--coverage\`. Code paths exercised only in isolated tests won't count toward Codecov patch coverage. Fix: add \`--coverage\` to the isolated script, or write unit tests calling real (non-mocked) functions where possible.
<!-- lore:ce43057f-2eff-461f-b49b-fb9ebaadff9d -->
* **Sentry /users/me/ endpoint returns 403 for OAuth tokens — use /auth/ instead**: The Sentry \`/users/me/\` endpoint returns 403 for OAuth tokens. Use \`/auth/\` instead — it works with ALL token types and lives on the control silo. In the CLI, \`getControlSiloUrl()\` handles routing correctly. \`SentryUserSchema\` (with \`.passthrough()\`) handles the \`/auth/\` response since it only requires \`id\`.
<!-- lore:8c0fabbb-590c-4a7b-812b-15accf978748 -->
* **pagination\_cursors table schema mismatch requires repair migration**: The pagination\_cursors SQLite table may have wrong PK (single-column instead of composite). Migration 5→6 detects via \`hasCompositePrimaryKey()\` and drops/recreates. \`repairWrongPrimaryKeys()\` in \`repairSchema()\` handles auto-repair. \`isSchemaError()\` catches 'on conflict clause does not match' to trigger repair. Data loss acceptable since cursors are ephemeral (5-min TTL).
<!-- lore:019c8ee1-affd-7198-8d01-54aa164cde35 -->
* **brew is not in VALID\_METHODS but Homebrew formula passes --method brew**: Homebrew install: \`isHomebrewInstall()\` detects via Cellar realpath (checked before stored install info). Upgrade command tells users \`brew upgrade getsentry/tools/sentry\`. Formula runs \`sentry cli setup --method brew --no-modify-path\` as post\_install. Version pinning throws 'unsupported\_operation'. Uses .gz artifacts. Tap at getsentry/tools.
<!-- lore:70319dc2-556d-4e30-9562-e51d1b68cf45 -->
* **Bun mock.module() leaks globally across test files in same process**: Bun's mock.module() replaces modules globally and leaks across test files in the same process. Solution: tests using mock.module() must run in a separate \`bun test\` invocation. In package.json, use \`bun run test:unit && bun run test:isolated\` instead of \`bun test\`. The \`test/isolated/\` directory exists for these tests. This was the root cause of ~100 test failures (getsentry/cli#258).
<!-- lore:019c8bbe-bc63-7b5e-a4e0-de7e968dcacb -->
* **Stricli defaultCommand blends default command flags into route completions**: When a Stricli route map has \`defaultCommand\` set, requesting completions for that route (e.g. \`\["issues", ""]\`) returns both the subcommand names AND the default command's flags/positional completions. This means completion tests that compare against \`extractCommandTree()\` subcommand lists will fail for groups with defaultCommand, since the actual completions include extra entries like \`--limit\`, \`--query\`, etc. Solution: track \`hasDefaultCommand\` in the command tree and skip strict subcommand-matching assertions for those groups.
<!-- lore:a28c4f2a-e2b6-4f24-9663-a85461bc6412 -->
* **Multiregion mock must include all control silo API routes**: When changing which Sentry API endpoint a function uses (e.g., switching getCurrentUser() from /users/me/ to /auth/), the mock route must be updated in BOTH test/mocks/routes.ts (single-region) AND test/mocks/multiregion.ts createControlSiloRoutes() (multi-region). Missing the multiregion mock causes 404s in multi-region test scenarios. The multiregion control silo mock serves auth, user info, and region discovery routes. Cursor Bugbot caught this gap when /api/0/auth/ was added to routes.ts but not multiregion.ts.
<!-- lore:5efa0434-09ff-49b6-b0a1-d8a7e740855b -->
* **resolveCursor must be called inside org-all closure, not before dispatch**: In list commands using dispatchOrgScopedList with cursor pagination (e.g., project/list.ts), resolveCursor() must be called inside the 'org-all' override closure, not before dispatchOrgScopedList. If called before, it throws a ContextError before dispatch can throw the correct ValidationError for --cursor being used in non-org-all modes.
<!-- lore:76c673bf-0417-47cb-a73d-9c941fbd182c -->
* **handleProjectSearch ContextError resource must be "Project" not config.entityName**: In src/lib/org-list.ts handleProjectSearch, the first argument to ContextError is the resource name rendered as "${resource} is required.". Always pass "Project" (not config.entityName like "team" or "repository") since the error is about a missing project slug, not a missing entity of the command's type. A code comment documents the rationale inline.

### Pattern

<!-- lore:d441d9e5-3638-4b5a-8148-f88c349b8979 -->
* **Non-essential DB cache writes should be guarded with try-catch**: Non-essential DB cache writes (e.g., \`setUserInfo()\` in whoami.ts and login.ts) must be wrapped in try-catch. If the DB is broken, the cache write shouldn't crash the command when its primary operation already succeeded. In login.ts specifically, \`getCurrentUser()\` failure after token save must not block authentication — wrap in try-catch, log warning to stderr, let login succeed. This differs from \`getUserRegions()\` failure which should \`clearAuth()\` and fail hard (indicates invalid token).
<!-- lore:019c8aed-445f-7bc6-98cd-971408673b04 -->
* **Sentry CLI issue resolution wraps getIssue 404 in ContextError with ID hint**: In resolveIssue() (src/commands/issue/utils.ts), bare getIssue() calls for numeric and explicit-org-numeric cases should catch ApiError with status 404 and re-throw as ContextError that includes: (1) the ID the user provided, (2) a hint about access/deletion, (3) a suggestion to use short-ID format (\<project>-\<id>) if the user confused numeric group IDs with short-ID suffixes. Without this, the user gets a generic 'Issue not found' without knowing which ID failed or what to try instead.
<!-- lore:019c8aed-4458-79c5-b5eb-01a3f7e926e0 -->
* **Sentry CLI setFlagContext redacts sensitive flags before telemetry**: The setFlagContext() function in src/lib/telemetry.ts must redact sensitive flag values (like --token) before setting Sentry tags. A SENSITIVE\_FLAGS set contains flag names that should have their values replaced with '\[REDACTED]' instead of the actual value. This prevents secrets from leaking into telemetry. The scrub happens at the source (in setFlagContext itself) rather than in beforeSend, so the sensitive value never reaches the Sentry SDK.
<!-- lore:019c9bb9-a797-725d-a271-702795d11894 -->
* **Sentry CLI api command: normalizeFields auto-corrects colon separators with stderr warning**: The \`sentry api\` command's \`--field\`/\`--raw-field\` flags require \`key=value\` format. \`normalizeFields()\` auto-corrects \`:\` to \`=\` with a stderr warning when no \`=\` exists, but must skip JSON-shaped strings (starting with \`{\` or \`\[\`) to avoid silent data corruption. A \`--data\`/\`-d\` flag (curl convention) handles inline JSON bodies directly, mutually exclusive with \`--input\` and field flags. Positional args as implicit body was rejected: context-dependent behavior violates least surprise, ambiguity with mistyped endpoints, even curl uses explicit \`-d\`. When bare JSON is detected in a field value, auto-detect and use as body with a stderr hint suggesting \`--data\`. General pattern: auto-correct unambiguous user mistakes at command level with stderr warnings, keeping parsing functions pure.

### Preference

<!-- lore:019c9f9c-40f3-7b3e-99ba-a3af2e56e519 -->
* **Progress message format: 'N and counting (up to M)...' pattern**: User prefers progress messages that frame the limit as a ceiling rather than an expected total. Format: \`Fetching issues, 30 and counting (up to 50)...\` — not \`Fetching issues... 30/50\`. The 'up to' framing makes it clear the denominator is a max, not an expected count, avoiding confusion when fewer items exist than the limit. For multi-target fetches, include target count: \`Fetching issues from 10 projects, 30 and counting (up to 50)...\`. Initial message before any results: \`Fetching issues (up to 50)...\` or \`Fetching issues from 10 projects (up to 50)...\`.
<!-- End lore-managed section -->
