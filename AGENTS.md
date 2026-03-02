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

<!-- lore:019c9be1-33ca-714e-8ad9-dfda5350a106 -->
* **pnpm overrides with version-range keys don't force upgrades of already-compatible resolutions**: pnpm overrides gotchas: (1) Version-range selectors like \`"minimatch@>=10.0.0 <10.2.1": ">=10.2.1"\` don't reliably force re-resolution of already-compatible transitive deps. Workaround: blanket override \`"minimatch": ">=10.2.1"\` — but verify with \`pnpm why\` that no other major versions exist first. (2) \`>=\` targets can cross major versions — \`"ajv@<6.14.0": ">=6.14.0"\` resolves to v8.x, breaking v6 consumers. Always use \`^\` to constrain within the same major. (3) Overrides become orphaned when the dependency tree changes (package removal, transitive dep renames). Audit with \`pnpm why \<pkg>\` after tree changes; remove overrides that return empty. (4) For lockfile merge conflicts, just \`git checkout --theirs pnpm-lock.yaml\` then \`pnpm install\` — never manually resolve.
<!-- lore:019c992d-8e38-7148-91db-baa5029eb2c3 -->
* **ghcr.io blob download: curl -L breaks because auth header leaks to Azure redirect**: ghcr.io blob download: \`curl -L\` with Authorization header fails because curl forwards the auth header to the Azure redirect target, which rejects it with 404. Fix: two-step — extract redirect URL without following, then curl the redirect without auth header. ORAS CLI handles this internally but install scripts using plain curl need the manual approach.
<!-- lore:019c94f0-2ab4-74b2-8bfa-d3ddfbb97d70 -->
* **GitHub Actions: use deterministic timestamps across jobs, not Date.now()**: GitHub Actions gotchas: (1) Use deterministic timestamps across jobs — never use \`Date.now()\` independently per job. Derive from \`github.event.head\_commit.timestamp\` converted to Unix seconds. (2) Skipped \`needs\` jobs don't block downstream — outputs are empty strings, use conditional \`if: needs.job.outputs.value != ''\` to skip steps. (3) upload-artifact strips directory prefixes from glob paths — \`dist-bin/sentry-\*\` stores as \`sentry-\*\` at root. download-artifact puts files at \`artifacts/sentry-\*\`, not \`artifacts/dist-bin/sentry-\*\`.
<!-- lore:019c9e98-7af4-7e25-95f4-fc06f7abf564 -->
* **Bun binary build requires SENTRY\_CLIENT\_ID env var**: The build script (\`script/bundle.ts\`) requires \`SENTRY\_CLIENT\_ID\` environment variable and exits with code 1 if missing. When building locally, use \`bun run --env-file=.env.local build\` or set the env var explicitly. The binary build (\`bun run build\`) also needs it. Without it you get: \`Error: SENTRY\_CLIENT\_ID environment variable is required.\`
<!-- lore:019c99d0-aa4a-7665-90f5-9abbb61104ae -->
* **marked and marked-terminal must be devDependencies in bundled CLI projects**: In the getsentry/cli project, all npm packages used at runtime must be bundled by the build step (esbuild). Packages like \`marked\` and \`marked-terminal\` belong in \`devDependencies\`, not \`dependencies\`. The CI \`check:deps\` step enforces this — anything in \`dependencies\` that isn't a true runtime requirement (native addon, bin entry) will fail the check. This applies to all packages consumed only through the bundle.
<!-- lore:019c99d0-aa44-79fa-9c0a-2c0e8bbcd333 -->
* **CodeQL flags incomplete markdown cell escaping — must escape backslash before pipe**: When escaping user content for markdown table cells, replacing only \`|\` with \`\\|\` triggers CodeQL's "Incomplete string escaping or encoding" alert (high severity). The fix is to escape backslashes first, then pipes: \`str.replace(/\\\\/g, "\\\\\\\\" ).replace(/\\|/g, "\\\\|")\`. In getsentry/cli this is centralized as \`escapeMarkdownCell()\` in \`src/lib/formatters/markdown.ts\`. All formatters that build markdown table rows (human.ts, log.ts, trace.ts) must use this helper instead of inline \`.replace()\` calls.
<!-- lore:019c969a-1c90-7041-88a8-4e4d9a51ebed -->
* **Multiple mockFetch calls replace each other — use unified mocks for multi-endpoint tests**: In getsentry/cli tests, \`mockFetch()\` sets \`globalThis.fetch\` to a new function. Calling it twice replaces the first mock entirely. A common bug: calling \`mockBinaryDownload()\` then \`mockGitHubVersion()\` means the binary download URL hits the version mock (returns 404). Fix: create a single unified fetch mock that handles ALL endpoints the test needs (version API, binary download, npm registry, version.json). Pattern: \`\`\`typescript mockFetch(async (url) => { const urlStr = String(url); if (urlStr.includes('releases/latest')) return versionResponse; if (urlStr.includes('version.json')) return nightlyResponse; return new Response(gzipped, { status: 200 }); // binary download }); \`\`\` This caused multiple test failures when trying to test the full upgrade→download→setup pipeline.
<!-- lore:019c992d-8e3a-761a-a6b4-44582d0eed4f -->
* **GHCR packages created as private by default — must manually make public once**: When first pushing to \`ghcr.io/getsentry/cli\` via ORAS or Docker, the container package is created with \`visibility: private\`. Anonymous pulls fail until the package is made public. This is a one-time manual step via GitHub UI at the package settings page (Danger Zone → Change visibility → Public). The GitHub Packages API for changing visibility requires org admin scopes that aren't available via \`gh auth\` by default. For the getsentry/cli nightly distribution, the package has already been made public.
<!-- lore:019c978a-18b3-7bc7-8533-dc2448ea8c5e -->
* **Craft gh-pages target wipes entire branch on publish**: Craft's \`GhPagesTarget.commitArchiveToBranch()\` runs \`git rm -r -f .\` before extracting the docs archive, deleting ALL existing files on the gh-pages branch. Any additional files placed there (e.g., nightly binaries in a \`nightly/\` directory) would be wiped on every stable release. The \`cli.sentry.dev\` site is served from the gh-pages branch (CNAME file confirms this). If using gh-pages for hosting non-docs files, either accept the brief outage window until the next main push re-adds them, add a \`postReleaseCommand\` in \`.craft.yml\` to restore the files, or use a different hosting mechanism entirely.
<!-- lore:019c9776-e3dd-7632-88b8-358a19506218 -->
* **GitHub immutable releases prevent rolling nightly tag pattern**: The getsentry/cli repo has immutable releases enabled (org/repo setting, will NOT be turned off). This means: (1) once a release is published, its assets cannot be modified or deleted, (2) a tag used by a published release can NEVER be reused, even after deleting the release — \`gh release delete nightly --cleanup-tag\` followed by \`gh release create nightly\` fails with \`tag\_name was used by an immutable release\`. Draft releases ARE mutable but use unpredictable \`/download/untagged-xxx/\` URLs instead of tag-based URLs, and publishing a draft with a previously-used tag also fails. This breaks the original nightly design of a single rolling \`nightly\` tag. The \`nightly\` tag is now permanently poisoned. New approach needed: per-version release tags (e.g., \`0.13.0-dev.1772062077\`) with API-based discovery of the latest prerelease.
<!-- lore:019c9741-d78e-73b1-87c2-e360ef6c7475 -->
* **useTestConfigDir without isolateProjectRoot causes DSN scanning of repo tree**: In getsentry/cli tests, \`useTestConfigDir()\` creates temp dirs under \`.test-tmp/\` inside the repo tree. When code calls \`detectDsn(cwd)\` with this temp dir as cwd (e.g., via \`resolveOrg({ cwd })\`), \`findProjectRoot\` walks up from \`.test-tmp/prefix-xxx\` and finds the repo's \`.git\` directory, causing DSN detection to scan the actual source code for Sentry DSNs. This can trigger network calls that hit test fetch mocks (returning 404s or unexpected responses), leading to 5-second test timeouts. Fix: always use \`useTestConfigDir(prefix, { isolateProjectRoot: true })\` when the test exercises any code path that might call \`resolveOrg\`, \`detectDsn\`, or \`findProjectRoot\` with the config dir as cwd. The \`isolateProjectRoot\` option creates a \`.git\` directory inside the temp dir, stopping the upward walk immediately.
<!-- lore:019c969a-1c83-7d65-a76e-10c40473059d -->
* **mock.module bleeds across Bun test files — never include test/isolated/ in test:unit**: In Bun's test runner, \`mock.module()\` pollutes the shared module registry for ALL subsequently-loaded test files in the same \`bun test\` invocation. Including \`test/isolated/\` in \`test:unit\` caused 132 failures because the \`node:child\_process\` mock leaked into DB tests, config tests, and others that transitively import child\_process. The \`test:isolated\` script MUST remain separate from \`test:unit\`. This also means isolated test coverage does NOT appear in Codecov PR patch coverage — only \`test:unit\` feeds lcov. Accept that code paths requiring \`mock.module\` (e.g., \`node:child\_process spawn\` wrappers like \`runCommand\`, \`isInstalledWith\`, \`executeUpgradeHomebrew\`, \`executeUpgradePackageManager\`) will have zero Codecov coverage.
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
* **Craft minVersion >= 2.21.0 silently disables custom bump-version.sh**: Craft minVersion >= 2.21.0 with no \`preReleaseCommand\` switches from running \`bash scripts/bump-version.sh\` to automatic version bumping via publish targets. If the only target is \`github\` (which doesn't support auto-bump), the version bump silently does nothing. Fix: explicitly set \`preReleaseCommand: bash scripts/bump-version.sh\` in \`.craft.yml\`.
<!-- lore:019c9f57-aa13-7ab1-8f2a-e5c9e8df1e81 -->
* **npm OIDC only works for publish — npm info/view still needs traditional auth**: npm OIDC auth only works for \`publish\` — \`npm info\`, \`npm view\`, \`npm install\`, and \`npm access\` still need traditional auth (NPM\_TOKEN). For public packages, \`npm info\` works without auth. For private packages, a read-only NPM\_TOKEN is still needed alongside OIDC for version checks.

### Pattern

<!-- lore:019c9bb9-a79b-71e0-9f71-d94e77119b4b -->
* **CLI UX: auto-correct common user mistakes with stderr warnings instead of hard errors**: When a CLI command can unambiguously detect a common user mistake (like using the wrong separator character), prefer auto-correcting the input and printing a warning to stderr over throwing a hard error. This is safe when: (1) the input is already invalid and would fail anyway, (2) there's no ambiguity in the correction, and (3) the warning goes to stderr so it doesn't interfere with JSON/stdout output. Implementation pattern: normalize inputs at the command level before passing to pure parsing functions, keeping the parsers side-effect-free. The \`gh\` CLI (GitHub CLI) is the UX model — match its conventions.
<!-- lore:019c969a-1c8a-7045-b8ee-ac7dcc245888 -->
* **Bun.spawn is writable — use direct assignment for test spying instead of mock.module**: Unlike \`node:child\_process\` imports (which require \`mock.module\` and isolated test files), \`Bun.spawn\` is a writable property on the global \`Bun\` object. Tests can replace it directly in \`beforeEach\`/\`afterEach\` without module-level mocking: \`\`\`typescript let originalSpawn: typeof Bun.spawn; beforeEach(() => { originalSpawn = Bun.spawn; Bun.spawn = ((cmd, \_opts) => ({ exited: Promise.resolve(0), })) as typeof Bun.spawn; }); afterEach(() => { Bun.spawn = originalSpawn; }); \`\`\` This avoids the mock.module bleed problem entirely and works in regular \`test:unit\` files (counts toward Codecov). Used successfully in \`test/commands/cli/upgrade.test.ts\` to test \`runSetupOnNewBinary\` and \`migrateToStandaloneForNightly\` which spawn child processes via \`Bun.spawn\`.
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
<!-- lore:4c542d55-d00a-4012-aed8-537f56309dc3 -->
* **OpenCode worktree blocks checkout of main — use stash + new branch instead**: When working in the getsentry/cli repo, \`git checkout main\` fails because main is used by an OpenCode worktree at \`~/.local/share/opencode/worktree/\`. Workaround: stash changes, fetch, create a new branch from origin/main (\`git stash && git fetch && git checkout -b \<branch> origin/main && git stash pop\`), then pop stash. Do NOT try to checkout main directly. This also applies when rebasing onto latest main — you must use \`origin/main\` as the target, never the local \`main\` branch.

### Preference

<!-- lore:019c974a-546b-7c71-8249-0545c8342ca9 -->
* **.opencode directory should be gitignored**: The \`.opencode/\` directory (used by OpenCode for plans, session data, etc.) should be in \`.gitignore\` and never committed. It was added to \`.gitignore\` alongside \`.idea\` and \`.DS\_Store\` in the editor/tool ignore section.
<!-- lore:019c9700-0fc3-730c-82c3-a290d5ecc2ea -->
* **CI scripts: prefer jq/sed over node -e for JSON manipulation**: Reviewer (BYK) prefers using standard Unix tools (\`jq\`, \`sed\`, \`awk\`) over \`node -e\` for simple JSON manipulation in CI workflow scripts. For example, reading/modifying package.json version: \`jq -r .version package.json\` to read, \`jq --arg v "$NEW" '.version = $v' package.json > tmp && mv tmp package.json\` to write. This avoids requiring Node.js to be installed in CI steps that only need basic JSON operations, and is more readable for shell-centric workflows.
<!-- End lore-managed section -->
