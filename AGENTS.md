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

### Gotcha

<!-- lore:019c9a88-bf99-7322-b192-aafe4636c600 -->
* **getsentry/codecov-action enables JUnit XML test reporting by default**: The \`getsentry/codecov-action@main\` has \`enable-tests: true\` by default, which searches for JUnit XML files matching \`\*\*/\*.junit.xml\`. If the test framework doesn't produce JUnit XML, the action emits 3 warnings on every CI run: "No files found matching pattern", "No JUnit XML files found", and "Please ensure your test framework is generating JUnit XML output". Fix: either set \`enable-tests: false\` in the action inputs, or configure the test runner to output JUnit XML. For Bun, add \`\[test.reporter] junit = "test-results.junit.xml"\` to \`bunfig.toml\` and add \`\*.junit.xml\` to \`.gitignore\`.
<!-- lore:019c9a17-b4cd-7324-92f7-e90f8a40a90e -->
* **React useState async pitfall**: React useState setter is async — reading state immediately after setState returns stale value in dashboard components
<!-- lore:019c9a17-b481-7436-bee2-0e096d6fb7bf -->
* **TypeScript strict mode caveat**: TypeScript strict null checks require explicit undefined handling
<!-- lore:019c99c3-766b-7ae7-be1f-4d5e08da27d3 -->
* **Cherry-picking GHCR tests requires updating mocks from version.json to GHCR manifest flow**: When the nightly distribution was first implemented, tests mocked GitHub's \`version.json\` for nightly version fetching. After migrating to GHCR, all nightly test mocks must use the 3-step GHCR flow: (1) token exchange at \`ghcr.io/token\`, (2) manifest fetch at \`/manifests/nightly\` returning JSON with \`annotations.version\` and \`layers\[].annotations\["org.opencontainers.image.title"]\`, (3) blob download returning \`Response.redirect()\` to Azure. The \`mockNightlyVersion()\` helper in command tests and \`mockGhcrNightlyVersion()\` must handle all three URLs. Tests that still mock \`version.json\` will fail because \`fetchLatestNightlyVersion()\` now calls \`getAnonymousToken()\` + \`fetchNightlyManifest()\` + \`getNightlyVersion()\` instead of a single GitHub fetch. Platform-specific filenames in manifest layers (e.g., \`sentry-linux-x64.gz\`) must use \`if/else\` blocks (not nested ternaries, which Biome forbids).
<!-- lore:019c9994-d161-783e-8b3e-79457cd62f42 -->
* **Biome lint: Response.redirect() required, nested ternaries forbidden**: The Biome linter in this codebase enforces two rules that frequently trip up test code: 1. \*\*\`useResponseRedirect\`\*\*: When creating redirect responses in tests, use \`Response.redirect(url, status)\` instead of \`new Response(null, { status: 307, headers: { location: url } })\`. Exception: when testing a redirect \*without\* a Location header (e.g., testing error handling for missing Location), you must use \`new Response(null, { status: 307 })\` since \`Response.redirect()\` always includes a location. 2. \*\*\`noNestedTernary\`\*\*: Nested ternary expressions are forbidden. Replace with \`if/else if/else\` blocks assigning to a \`let\` variable. Common case: mapping \`process.platform\` to OS strings (\`darwin\`/\`windows\`/\`linux\`). Also: \`noComputedPropertyAccess\` — use \`obj.property\` instead of \`obj\["property"]\` for string literal keys.
<!-- lore:d87de42c-54fb-4d37-b0d5-efa046707120 -->
* **Sentry API silently caps limit parameter at 100**: The Sentry list issues API silently caps the \`limit\` query parameter at 100 — no error, no warning, just returns at most 100 results regardless of the requested limit. Any command requesting more than 100 items must implement client-side auto-pagination using Link header parsing. This applies to issues and likely other list endpoints. The \`orgScopedRequestPaginated()\` function already parses RFC 5988 Link headers for cursor-based pagination.
<!-- lore:019c9994-d165-738b-a445-f43a1d1570b3 -->
* **Biome complexity limit of 15 — extract helpers to stay under**: The Biome linter enforces a maximum cognitive complexity of 15 per function. When adding branching logic (e.g., nightly vs stable download paths) to an existing function that's already near the limit, extract each branch into a separate helper function rather than inlining. Examples: In \`upgrade.ts\`, \`downloadBinaryToTemp\` hit complexity 17 after adding nightly GHCR support — fixed by extracting \`downloadNightlyToPath(tempPath)\` and \`downloadStableToPath(version, tempPath)\` helpers. In \`upgrade.ts\` command, \`resolveTargetVersion\` hit complexity 16 after adding nightly detection — fixed by extracting \`fetchLatest(method, version)\` helper. Pattern: keep the dispatch function thin (condition check + delegate), put the logic in helpers.
<!-- lore:019c90f5-7ea5-7285-aa9a-d838978d5d71 -->
* **Bot review false positives recur across rounds — dismiss consistently**: Cursor BugBot and Sentry Seer Code Review bots re-raise the same false positives across multiple review rounds with slightly different wording. Known recurring false positives on this codebase: 1. \*\*"spinner contaminates JSON output"\*\* — flagged 6+ times across 3 review rounds. The spinner writes to stderr, JSON to stdout. Always dismiss. 2. \*\*"999E silently caps extreme values"\*\* — flagged 3+ times. The cap is unreachable for real Sentry counts (needs >= 10^21 events). Always dismiss. 3. \*\*"abbreviateCount breaks on huge numbers"\*\* — variant of #2. 4. \*\*"pagination progress exceeds limit"\*\* — flagged once, was a legitimate bug (fixed by capping onPage at limit). 5. \*\*"count abbreviation skips exactly 10k"\*\* — flagged when using \`raw.length <= COL\_COUNT\` check. This is intentional: numbers that fit in the column don't need abbreviation. 6. \*\*"string passed where number expected for issue\_id"\*\* — Seer flags \`getIssueInOrg\` for not using \`Number(issueId)\` like other functions. False positive: the \`RetrieveAnIssueData\` SDK type defines \`issue\_id\` as \`string\`, unlike \`RetrieveAnIssueEventData\`/\`StartSeerIssueFixData\`/\`RetrieveSeerIssueFixStateData\` which use \`number\`. When dismissing: reply with a clear technical explanation, then resolve the thread via GraphQL \`resolveReviewThread\` (use \`resolveReviewThread(input: {threadId: $id})\` with the \`pullRequestReviewThread\` node ID). The bots don't learn from previous resolutions. Expect to dismiss the same issue again in the next round.
<!-- lore:019c90f5-9134-7ddb-a009-43baceb7d66c -->
* **abbreviateCount toFixed(1) rounding at tier boundaries**: In \`abbreviateCount\` (src/lib/formatters/human.ts), multiple rounding boundary bugs were fixed across several review rounds: 1. \*\*toFixed(1) rounds past threshold\*\*: \`scaled = 99.95\` passes \`scaled < 100\` but \`toFixed(1)\` produces \`"100.0"\` → \`"100.0K"\` (6 chars). Fix: pre-compute \`rounded1dp = Number(scaled.toFixed(1))\` and compare \*that\* against \`< 100\`. 2. \*\*Math.round produces >= 1000\*\*: e.g. \`999.95\` → \`Math.round\` = \`1000\` → \`"1000K"\`. Fix: when \`rounded >= 1000\` and a higher tier exists, promote (divide by 1000, use next suffix). At max tier, cap at \`Math.min(rounded, 999)\`. 3. \*\*NaN input overflows column\*\*: \`padStart\` never truncates. Fix: return \`"?".padStart(COL\_COUNT)\` and report via \`Sentry.logger.warn()\`. 4. \*\*Hardcoded 10\_000 threshold\*\*: Reviewer requires using \`raw.length <= COL\_COUNT\` digit comparison rather than hardcoding \`10\_000\`, so it adapts if \`COL\_COUNT\` changes. 5. \*\*Negative numbers\*\*: \`n < 0\` also needs the early-return path since Sentry counts are non-negative. 6. \*\*Sentry reporting\*\*: Use \`Sentry.logger.warn()\` (structured logs) for the NaN case — \`captureMessage\` with warning level was rejected, \`captureException\` is for unexpected errors.
<!-- lore:019c8c31-f52f-7230-9252-cceb907f3e87 -->
* **Bugbot flags defensive null-checks as dead code — keep them with JSDoc justification**: Cursor Bugbot and Sentry Seer may flag null-checks or defensive guards as "dead code" when the current implementation can't trigger them. If removing the check would require a non-null assertion (which lint rules may ban, e.g., \`noNonNullAssertion\`), keep the defensive guard and add a JSDoc comment explaining: (1) why it's currently unreachable, and (2) why it's kept as a guard against future changes. Similarly, both bots repeatedly flag stderr spinner output during --json mode as a bug — this is always a false positive since progress goes to stderr not stdout. When bots raise known false positives, reply explaining the rationale and resolve.

### Preference

<!-- lore:019c9a17-b491-7f6a-9c66-a5f7b8947fa7 -->
* **General coding preference**: Prefer explicit error handling over silent failures
<!-- lore:019c9a17-b40b-7a08-bc4a-dea6bce2669b -->
* **Code style**: User prefers no backwards-compat shims, fix callers directly
<!-- lore:019c91e0-6d82-7f46-916a-f1e6555b8175 -->
* **General coding preference**: Prefer explicit error handling over silent failures
<!-- lore:019c91e0-6ce0-740b-b448-9fa0f31fedaf -->
* **Code style**: User prefers no backwards-compat shims, fix callers directly
<!-- lore:019c91a8-879a-70cd-bfe4-4bb5bfb7b4d1 -->
* **Use captureException (not captureMessage) for unexpected states, or Sentry logs**: When reporting unexpected/defensive-guard situations to Sentry (e.g., non-numeric input where a number was expected), the reviewer prefers \`Sentry.captureException(new Error(...))\` over \`Sentry.captureMessage(...)\`. \`captureMessage\` with 'warning' level was rejected in PR review. Alternatively, use the Sentry structured logger (\`Sentry.logger.warn(...)\`) for less severe diagnostic cases — this was accepted in the abbreviateCount NaN handler.
<!-- lore:019c91a8-87a0-769d-bcbb-eea898df3016 -->
* **Avoid hardcoded magic numbers — derive from constants**: Reviewer prefers deriving thresholds from existing constants rather than hardcoding magic numbers. Example: in \`abbreviateCount\`, the threshold for bypassing abbreviation was changed from \`n < 10\_000\` to \`raw.length <= COL\_COUNT\` — a digit-count comparison that adapts if the column width changes. The hardcoded \`10\_000\` only worked for COL\_COUNT=5. This pattern applies broadly: any threshold tied to a configurable constant should be derived from it.

### Pattern

<!-- lore:019c9a17-b483-7a62-b59c-5ba11c932690 -->
* **Kubernetes deployment pattern**: Use helm charts for Kubernetes deployments with resource limits
<!-- lore:019c90f5-9139-7280-b412-4bfd73c48971 -->
* **CLI stderr progress is safe alongside JSON stdout — reject bot false positives**: Bot reviewers (Cursor BugBot, Sentry Seer) repeatedly flag \`withProgress()\` spinner output during \`--json\` mode as a bug. This is a false positive: the spinner writes exclusively to \*\*stderr\*\*, while JSON goes to \*\*stdout\*\*. These are independent streams — stderr progress never contaminates JSON output. Consumers that merge stdout+stderr are doing so incorrectly for a CLI that emits structured JSON on stdout. When bots raise this, reply explaining the stderr/stdout separation and resolve.
<!-- lore:019c8c17-f5de-71f2-93b5-c78231e29519 -->
* **Make Bun.which testable by accepting optional PATH parameter**: When wrapping \`Bun.which()\` in a helper function, accept an optional \`pathEnv?: string\` parameter and pass it as \`{ PATH: pathEnv }\` to \`Bun.which\`. This makes the function deterministically testable without mocking — tests can pass a controlled PATH (e.g., \`/nonexistent\` for false, \`dirname(Bun.which('bash'))\` for true). Pattern: \`const opts = pathEnv !== undefined ? { PATH: pathEnv } : undefined; return Bun.which(name, opts) !== null;\`
<!-- lore:019c90f5-913b-7995-8bac-84289cf5d6d9 -->
* **Pagination contextKey must include all query-varying parameters with escaping**: The \`contextKey\` used for storing/retrieving pagination cursors must encode every parameter that changes the result set — not just \`sort\` and \`query\`, but also \`period\` and any future filter parameters. User-controlled values must be wrapped with \`escapeContextKeyValue()\` (which replaces \`|\` with \`%7C\`) to prevent key corruption via injected delimiters. Use the optional-chaining pattern: \`flags.period ? escapeContextKeyValue(flags.period) : "90d"\`. Important: \`flags.period\` may be \`undefined\` in test contexts (even though it has a default in the flag definition), so always provide a fallback before passing to \`escapeContextKeyValue()\` which calls \`.replaceAll()\` and will throw on \`undefined\`. This was caught in two review rounds — first the period was missing entirely, then it was added without escaping.
<!-- lore:019c90f5-9140-75d0-a59d-05b70b085561 -->
* **Multi-target concurrent progress needs per-target delta tracking**: When multiple targets fetch concurrently via \`Promise.all\` and each reports cumulative progress via \`onPage(fetched)\`, a shared \`setMessage\` callback causes the display to jump between individual target values. Fix: maintain a \`prevFetched\` array and a \`totalFetched\` running sum. Each callback computes \`delta = fetched - prevFetched\[i]\`, adds it to the running total, and updates the message. This gives monotonically-increasing combined progress. The array is unavoidable because \`onPage\` reports cumulative counts per target, not deltas — a simple running tally without per-target tracking would double-count. Use \`totalFetched += delta\` instead of \`reduce()\` on every callback for O(1) updates. The reviewer explicitly rejected the \`reduce()\` approach and asked for an inline comment explaining why the per-target array is still needed.
<!-- lore:019c90f5-9143-7b90-81ec-baa8836bc34e -->
* **Extract shared startSpinner helper to avoid poll/withProgress duplication**: Both \`poll()\` and \`withProgress()\` in src/lib/polling.ts shared identical spinner logic. This was consolidated into a \`startSpinner(stderr, initialMessage)\` helper that returns \`{ setMessage, stop }\`. Both callers now delegate to it. Key details: - \`stop()\` sets the stopped flag unconditionally (not guarded by a \`json\` check) — only the stderr cleanup (newline for poll vs \`\r\x1b\[K\` for withProgress) differs between callers. - In \`poll()\`, \`stopped = true\` must be set unconditionally in the finally block even in JSON mode (reviewer caught that it was incorrectly guarded by \`!json\`). - When adding new spinner use cases, use \`startSpinner()\` rather than reimplementing the animation loop. - The reviewer explicitly flagged the duplication and the \`stopped\` flag guard — both were addressed in the same commit.
<!-- lore:019c8a8a-64ee-703c-8c1e-ed32ae8a90a7 -->
* **PR review workflow: reply, resolve, amend, force-push**: When addressing PR review comments on this project: (1) Read unresolved threads via GraphQL API, (2) Make code changes addressing all feedback, (3) Run lint+typecheck+tests to verify, (4) Create a SEPARATE commit for each review round (not amend) — this enables incremental review, (5) Push normally (not force-push), (6) Reply to each review comment via REST API explaining what changed, (7) Resolve threads via GraphQL \`resolveReviewThread\` mutation using thread node IDs. Only amend+force-push when: (a) user explicitly asks, or (b) pre-commit hook auto-modified files that need including in the same commit.
<!-- lore:dbd63348-2049-42b3-bb99-d6a3d64369c7 -->
* **Branch naming and commit message conventions for Sentry CLI**: Branch naming: \`feat/\<short-description>\` or \`fix/\<issue-number>-\<short-description>\` (e.g., \`feat/ghcr-nightly-distribution\`, \`fix/268-limit-auto-pagination\`). Commit message format: \`type(scope): description (#issue)\` (e.g., \`fix(issue-list): auto-paginate --limit beyond 100 (#268)\`, \`feat(nightly): distribute via GHCR instead of GitHub Releases\`). Types seen: fix, refactor, meta, release, feat. PRs are created as drafts via \`gh pr create --draft\`. Implementation plans are attached to commits via \`git notes add\` rather than in PR body or commit message.

### Decision

<!-- lore:019c8f3b-84be-79be-9518-e5ecd2ea64b9 -->
* **Use -t (not -p) as shortcut alias for --period flag**: The --period flag on issue list uses -t (for 'time period') as its short alias, not -p. The rationale: -p could be confused with --platform from other CLI tools/contexts. -t maps naturally to 'time period' and avoids collision. This was a deliberate choice after initial implementation used -p.
<!-- lore:019c8f2c-d2cd-70b3-a467-bb990c35cc07 -->
* **CLI spinner animation interval: 50ms (20fps) matching ora/inquirer standard**: Terminal spinner animation interval set to 50ms (20fps), matching the standard used by ora, inquirer, and most popular CLI spinner libraries. With 10 braille frames, this gives a full cycle of 500ms. Alternatives considered: 16ms/60fps (too frantic for terminal), 33ms/30fps (smooth but unnecessary), 80ms/12.5fps (sluggish). The 50ms interval is fast enough to look smooth but not so fast it wastes CPU. This applies to the shared ANIMATION\_INTERVAL\_MS constant in polling.ts used by both the Seer polling spinner and pagination progress spinner.

### Architecture

<!-- lore:019c99aa-23f2-708f-82e8-f097d4412b8f -->
* **GHCR nightly distribution: version in OCI manifest annotations, manual redirect for blobs**: Nightly CLI binaries are distributed via ghcr.io using OCI artifacts pushed by ORAS. The \`:nightly\` tag is overwritten on each push (unlike immutable GitHub Releases). Key design: 1. \*\*Version discovery via manifest annotation\*\* — the OCI manifest has \`annotations.version\` so checking the latest nightly needs only token exchange + manifest fetch (2 requests). No separate version.json blob download needed. 2. \*\*Nightly version format\*\*: \`0.0.0-nightly.\<unix\_seconds>\` where timestamp comes from \`git log -1 --format='%ct'\` for determinism across CI jobs. Detection: \`version.includes('-nightly.')\`. 3. \*\*src/lib/ghcr.ts\*\* encapsulates the OCI download protocol: \`getAnonymousToken()\`, \`fetchNightlyManifest(token)\`, \`getNightlyVersion(manifest)\`, \`findLayerByFilename(manifest, filename)\`, \`downloadNightlyBlob(token, digest)\` with manual 307 redirect handling. 4. \*\*Routing\*\*: \`isNightlyVersion()\` in upgrade.ts gates whether to use GHCR or GitHub Releases. Both \`version-check.ts\` and the upgrade command check this. The install script has a \`--nightly\` flag. 5. \*\*CI\*\*: \`publish-nightly\` job runs on main only, uses \`oras push\` with \`--annotation "version=$VERSION"\`. All binaries are .gz compressed as OCI layers. 6. \*\*Channel architecture\*\*: Main branch uses a \`ReleaseChannel\` type ('stable' | 'nightly') with \`getReleaseChannel()\`/\`setReleaseChannel()\` persisted in DB. \`fetchLatestVersion(method, channel)\` dispatches to \`fetchLatestNightlyVersion()\` (GHCR) or \`fetchLatestFromGitHub()\`/\`fetchLatestFromNpm()\` based on channel. The \`migrateToStandaloneForNightly\` flow handles switching npm installs to standalone curl binaries when switching to nightly channel.
<!-- lore:a1f33ceb-6116-4d29-b6d0-0dc9678e4341 -->
* **Issue list auto-pagination beyond API's 100-item cap**: The Sentry API silently caps \`limit\` at 100 per request with no error. \`listIssuesAllPages()\` in api-client.ts provides auto-pagination: uses Math.min(limit, API\_MAX\_PER\_PAGE) as page size, loops over paginated responses using Link headers, bounded by MAX\_PAGINATION\_PAGES (50 pages = up to 5000 items safety limit), trims with .slice(0, limit). All modes now use auto-pagination consistently — \`--limit\` means "total results" everywhere (max 1000). Org-all mode auto-paginates from the start using \`fetchOrgAllIssues()\` helper, with single-page fetch when \`--cursor\` is explicitly provided to keep the cursor chain intact. A single exported \`API\_MAX\_PER\_PAGE\` constant (renamed from \`ISSUES\_MAX\_PER\_PAGE\`) in \`api-client.ts\` near the pagination infrastructure section is shared across all consumers — it replaces all hardcoded \`100\` page-size defaults in orgScopedPaginateAll, listProjectsPaginated, listIssuesAllPages, and listLogs. Default limit is 25.
<!-- End lore-managed section -->
