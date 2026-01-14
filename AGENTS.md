# AGENTS.md

Guidelines for AI agents working in this codebase.

## Cursor Rules (Important!)

Before working on this codebase, read the Cursor rules:

- **`.cursor/rules/bun-cli.mdc`** — Bun API usage, file I/O, process spawning, testing
- **`.cursor/rules/ultracite.mdc`** — Code style, formatting, linting rules

## Quick Reference: Commands

> **Note**: Always check `package.json` and `packages/cli/package.json` for the latest scripts.

```bash
# Development
bun install                              # Install dependencies
bun run dev                              # Run CLI in dev mode (from packages/cli)
bun run --env-file=../../.env.local src/bin.ts  # Dev with env vars

# Build
bun run build                            # Build for current platform
bun run build:all                        # Build for all platforms
turbo build                              # Build all packages

# Type Checking
turbo typecheck                          # Check all packages
bun run typecheck                        # Check single package (from packages/cli)

# Linting & Formatting
npx ultracite check                      # Check for issues
npx ultracite fix                        # Auto-fix issues (run before committing)

# Testing
bun test                                 # Run all tests
bun test path/to/file.test.ts            # Run single test file
bun test --watch                         # Watch mode
bun test --filter "test name"            # Run tests matching pattern
```

## Rules: Use Bun APIs

**CRITICAL**: This project uses Bun as runtime. Always prefer Bun-native APIs over Node.js equivalents.

Read the full guidelines in `.cursor/rules/bun-cli.mdc`.

**Bun Documentation**: https://bun.sh/docs — Consult these docs when unsure about Bun APIs.

### Quick Bun API Reference

| Task | Use This | NOT This |
|------|----------|----------|
| Read file | `await Bun.file(path).text()` | `fs.readFileSync()` |
| Write file | `await Bun.write(path, content)` | `fs.writeFileSync()` |
| Check file exists | `await Bun.file(path).exists()` | `fs.existsSync()` |
| Spawn process | `Bun.spawn()` | `child_process.spawn()` |
| Shell commands | `Bun.$\`command\`` | `child_process.exec()` |
| Find executable | `Bun.which("git")` | `which` package |
| Glob patterns | `new Bun.Glob()` | `glob` / `fast-glob` packages |
| Sleep | `await Bun.sleep(ms)` | `setTimeout` with Promise |
| Parse JSON file | `await Bun.file(path).json()` | Read + JSON.parse |

**Exception**: Use `node:fs` for directory creation with permissions:
```typescript
import { mkdirSync } from "node:fs";
mkdirSync(dir, { recursive: true, mode: 0o700 });
```

## Architecture

```
stellar-orchid/
├── packages/
│   └── cli/                    # Main CLI package
│       ├── src/
│       │   ├── bin.ts          # Entry point
│       │   ├── app.ts          # Stricli application setup
│       │   ├── context.ts      # Dependency injection context
│       │   ├── commands/       # CLI commands (auth/, issue/, org/, project/)
│       │   ├── lib/            # Shared utilities (api-client, config, oauth)
│       │   └── types/          # TypeScript types and Zod schemas
│       └── script/             # Build scripts
├── .cursor/rules/              # Cursor AI rules (read these!)
├── biome.jsonc                 # Linting config (extends ultracite)
└── turbo.json                  # Turborepo config
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
- Re-export from `src/types/index.ts`
- Use `type` imports: `import type { MyType } from "../types/index.js"`

### Error Handling

```typescript
// Custom error classes extend Error
export class SentryApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SentryApiError";
    this.status = status;
  }
}

// In commands: catch and write to stderr
try {
  // ...
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}
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

## Testing (bun:test)

```typescript
import { describe, expect, test, mock } from "bun:test";

describe("feature", () => {
  test("should work", async () => {
    expect(await someFunction()).toBe(expected);
  });
});

// Mock modules
mock.module("./some-module", () => ({
  default: () => "mocked",
}));
```

## File Locations

| What | Where |
|------|-------|
| Add new command | `packages/cli/src/commands/<domain>/` |
| Add API types | `packages/cli/src/types/sentry.ts` |
| Add config types | `packages/cli/src/types/config.ts` |
| Add utility | `packages/cli/src/lib/` |
| Build scripts | `packages/cli/script/` |
