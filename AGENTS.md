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

<!-- lore:019c978a-18b5-7a0d-a55f-b72f7789bdac -->
* **cli.sentry.dev is served from gh-pages branch via GitHub Pages**: \`cli.sentry.dev\` is served from gh-pages branch via GitHub Pages. Craft's gh-pages target runs \`git rm -r -f .\` before extracting docs — persist extra files via \`postReleaseCommand\` in \`.craft.yml\`. Install script supports \`--channel nightly\`, downloading from the \`nightly\` release tag directly. version.json is only used by upgrade/version-check flow.

<!-- lore:2c3eb7ab-1341-4392-89fd-d81095cfe9c4 -->
* **npm bundle requires Node.js >= 22 due to node:sqlite polyfill**: The npm package (dist/bin.cjs) requires Node.js >= 22 because the bun:sqlite polyfill uses \`node:sqlite\`. A runtime version guard in the esbuild banner catches this early. When writing esbuild banner strings in TS template literals, double-escape: \`\\\\\\\n\` in TS → \`\\\n\` in output → newline at runtime. Single \`\\\n\` produces a literal newline inside a JS string, causing SyntaxError.

<!-- lore:019c972c-9f0f-75cd-9e24-9bdbb1ac03d6 -->
* **Numeric issue ID resolution returns org:undefined despite API success**: Numeric issue ID resolution in \`resolveNumericIssue()\`: (1) try DSN/env/config for org, (2) if found use \`getIssueInOrg(org, id)\` with region routing, (3) else fall back to unscoped \`getIssue(id)\`, (4) extract org from \`issue.permalink\` via \`parseSentryUrl\` as final fallback. The \`explicit-org-numeric\` case uses \`getIssueInOrg\`. \`resolveOrgAndIssueId\` no longer throws for bare numeric IDs when permalink contains the org slug.

<!-- lore:019c972c-9f0d-7c8e-95b1-7beda99c36a8 -->
* **parseSentryUrl does not handle subdomain-style SaaS URLs**: parseSentryUrl in src/lib/sentry-url-parser.ts handles both path-based (\`/organizations/{org}/...\`) and subdomain-style (\`https://{org}.sentry.io/issues/123/\`) URLs. \`matchSubdomainOrg()\` extracts org from hostname ending in \`.sentry.io\`. Region subdomains (\`us\`, \`de\`) filtered by requiring org slug length > 2. Supports \`/issues/{id}/\`, \`/issues/{id}/events/{eventId}/\`, and \`/traces/{traceId}/\` paths. Self-hosted uses path-based only.

### Decision

<!-- lore:019c99d5-69f2-74eb-8c86-411f8512801d -->
* **Raw markdown output for non-interactive terminals, rendered for TTY**: Output raw CommonMark when stdout is not a TTY; render through marked-terminal only for TTY. Detection: \`process.stdout.isTTY\`. Override precedence: \`SENTRY\_PLAIN\_OUTPUT\` > \`NO\_COLOR\` > auto-detect. \`--json\` always outputs JSON. Streaming formatters (log/trace) use ANSI-colored text for TTY, markdown table rows for non-TTY.

### Gotcha

<!-- lore:019c8ab6-d119-7365-9359-98ecf464b704 -->
* **@sentry/api SDK passes Request object to custom fetch — headers lost on Node.js**: @sentry/api SDK calls \`\_fetch(request)\` with no init object. In \`authenticatedFetch\`, \`init\` is undefined so \`prepareHeaders\` creates empty headers — on Node.js this strips Content-Type (HTTP 415). Fix: fall back to \`input.headers\` when \`init\` is undefined. Use \`unwrapPaginatedResult\` (not \`unwrapResult\`) to access the Response's Link header for pagination. \`per\_page\` is not in SDK types; cast query to pass it at runtime.

<!-- lore:019c9e98-7af4-7e25-95f4-fc06f7abf564 -->
* **Bun binary build requires SENTRY\_CLIENT\_ID env var**: The build script (\`script/bundle.ts\`) requires \`SENTRY\_CLIENT\_ID\` environment variable and exits with code 1 if missing. When building locally, use \`bun run --env-file=.env.local build\` or set the env var explicitly. The binary build (\`bun run build\`) also needs it. Without it you get: \`Error: SENTRY\_CLIENT\_ID environment variable is required.\`

<!-- lore:019c992d-8e38-7148-91db-baa5029eb2c3 -->
* **ghcr.io blob download: curl -L breaks because auth header leaks to Azure redirect**: ghcr.io gotchas: (1) \`curl -L\` with Authorization header fails on blob downloads because curl forwards the auth header to the Azure redirect target (404). Fix: two-step curl — extract redirect URL without following, then fetch without auth. (2) New GHCR packages default to private. Anonymous pulls fail until manually made public via GitHub UI package settings. This is a one-time step per package.

<!-- lore:019c94f0-2ab4-74b2-8bfa-d3ddfbb97d70 -->
* **GitHub Actions: use deterministic timestamps across jobs, not Date.now()**: GitHub Actions gotchas: (1) Use deterministic timestamps across jobs — never use \`Date.now()\` independently per job. Derive from \`github.event.head\_commit.timestamp\` converted to Unix seconds. (2) Skipped \`needs\` jobs don't block downstream — outputs are empty strings, use conditional \`if: needs.job.outputs.value != ''\` to skip steps. (3) upload-artifact strips directory prefixes from glob paths — \`dist-bin/sentry-\*\` stores as \`sentry-\*\` at root. download-artifact puts files at \`artifacts/sentry-\*\`, not \`artifacts/dist-bin/sentry-\*\`.

<!-- lore:019c9776-e3dd-7632-88b8-358a19506218 -->
* **GitHub immutable releases prevent rolling nightly tag pattern**: getsentry/cli has immutable GitHub releases — assets can't be modified and tags can NEVER be reused. Nightly uses per-version tags (e.g., \`0.13.0-dev.1772062077\`) with API-based latest discovery; deletes all existing assets before uploading. Craft minVersion >= 2.21.0 with no \`preReleaseCommand\` silently skips \`bump-version.sh\` if the only target is \`github\`. Fix: explicitly set \`preReleaseCommand: bash scripts/bump-version.sh\`.

<!-- lore:019c969a-1c83-7d65-a76e-10c40473059d -->
* **mock.module bleeds across Bun test files — never include test/isolated/ in test:unit**: Bun's \`mock.module()\` pollutes the shared module registry for ALL subsequently-loaded test files in the same \`bun test\` invocation. Tests using it must live in \`test/isolated/\` and run via \`test:isolated\` (never \`test:unit\`). Consequence: isolated test coverage doesn't appear in Codecov. For \`Bun.spawn\` (which is writable on the global \`Bun\` object), prefer direct property assignment (\`Bun.spawn = mockFn\`) in \`beforeEach\`/\`afterEach\` — this works in regular test files and counts toward coverage.

<!-- lore:019c969a-1c90-7041-88a8-4e4d9a51ebed -->
* **Multiple mockFetch calls replace each other — use unified mocks for multi-endpoint tests**: In getsentry/cli tests, \`mockFetch()\` replaces \`globalThis.fetch\`. Calling it twice replaces the first mock entirely. Fix: create a single unified fetch mock handling ALL endpoints the test needs, dispatching by URL pattern.

<!-- lore:019c8a7a-5321-7a48-a86c-1340ee3e90db -->
* **Several commands bypass telemetry by importing buildCommand from @stricli/core directly**: src/lib/command.ts wraps Stricli's buildCommand to auto-capture flag/arg telemetry via Sentry. But trace/list, trace/view, log/view, api.ts, and help.ts import buildCommand directly from @stricli/core, silently skipping telemetry. Fix: change their imports to use ../../lib/command.js. Consider adding a Biome lint rule (noRestrictedImports equivalent) to prevent future regressions.

<!-- lore:019c9741-d78e-73b1-87c2-e360ef6c7475 -->
* **useTestConfigDir without isolateProjectRoot causes DSN scanning of repo tree**: \`useTestConfigDir()\` creates temp dirs under \`.test-tmp/\` in the repo tree. Without \`{ isolateProjectRoot: true }\`, \`findProjectRoot\` walks up and finds the repo's \`.git\`, causing DSN detection to scan real source code and trigger network calls against test mocks (timeouts). Always pass \`isolateProjectRoot: true\` when tests exercise \`resolveOrg\`, \`detectDsn\`, or \`findProjectRoot\`.

### Pattern

<!-- lore:019c9793-fb1c-7986-936e-57949e9a30d0 -->
* **Markdown table structure for marked-terminal: blank header row + separator + data rows**: Markdown tables for marked-terminal: use blank header row (\`| | |\`), separator (\`|---|---|\`), then data rows (\`| \*\*Label\*\* | value |\`). Data rows before the separator produce malformed output. When escaping user content in table cells, escape backslashes first then pipes: \`str.replace(/\\\\/g, '\\\\\\\\').replace(/\\|/g, '\\\\|')\`. This is centralized as \`escapeMarkdownCell()\` in \`src/lib/formatters/markdown.ts\` — all formatters must use it (CodeQL flags incomplete escaping as high severity). Formatters return \`string\`; test with \`result.includes(...)\` since rendered markdown uses Unicode box-drawing characters.

<!-- lore:019c972c-9f11-7c0d-96ce-3f8cc2641175 -->
* **Org-scoped SDK calls follow getOrgSdkConfig + unwrapResult pattern**: All org-scoped API calls in src/lib/api-client.ts follow this pattern: (1) call \`getOrgSdkConfig(orgSlug)\` which resolves the org's regional URL and returns an SDK client config, (2) spread config into the SDK function call: \`{ ...config, path: { organization\_id\_or\_slug: orgSlug, ... } }\`, (3) pass result to \`unwrapResult(result, errorContext)\`. There are 14+ usages of this pattern. The \`getOrgSdkConfig\` function (line ~167) calls \`resolveOrgRegion(orgSlug)\` then \`getSdkConfig(regionUrl)\`. Follow this exact pattern when adding new org-scoped endpoints like \`getIssueInOrg\`.

<!-- lore:5ac4e219-ea1f-41cb-8e97-7e946f5848c0 -->
* **PR workflow: wait for Seer and Cursor BugBot before resolving**: After pushing a PR in the getsentry/cli repo, the CI pipeline includes Seer Code Review and Cursor Bugbot as required or advisory checks. Both typically take 2-3 minutes. The workflow is: push → wait for all CI (including npm build jobs which test the actual bundle) → check for inline review comments from Seer/BugBot → fix if needed → repeat. Use \`gh pr checks \<PR> --watch\` to monitor. Review comments are fetched via \`gh api repos/OWNER/REPO/pulls/NUM/comments\` and \`gh api repos/OWNER/REPO/pulls/NUM/reviews\`.

<!-- lore:019caee3-3139-773e-b2aa-44d7214748c2 -->
* **resolveAllTargets/resolveOrgAndProject should not call fetchProjectId — callers enrich**: The shared helpers \`resolveAllTargets\` and \`resolveOrgAndProject\` must NOT call \`fetchProjectId\`/\`getProject\` — many commands don't need projectId. Commands that need it (like \`issue list\`) should enrich targets themselves with silent fallback. \`toNumericId()\` validates with \`Number.isInteger(n) && n > 0\` (not truthiness) and accepts \`null\` since API responses can return null IDs.

### Preference

<!-- lore:019c9700-0fc3-730c-82c3-a290d5ecc2ea -->
* **CI scripts: prefer jq/sed over node -e for JSON manipulation**: Reviewer (BYK) prefers using standard Unix tools (\`jq\`, \`sed\`, \`awk\`) over \`node -e\` for simple JSON manipulation in CI workflow scripts. For example, reading/modifying package.json version: \`jq -r .version package.json\` to read, \`jq --arg v "$NEW" '.version = $v' package.json > tmp && mv tmp package.json\` to write. This avoids requiring Node.js to be installed in CI steps that only need basic JSON operations, and is more readable for shell-centric workflows.
<!-- End lore-managed section -->
