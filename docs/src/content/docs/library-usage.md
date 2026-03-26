---
title: Library Usage
description: Use the Sentry CLI programmatically in Node.js or Bun
---

The Sentry CLI can be used as a JavaScript/TypeScript library, running commands
in-process without spawning a subprocess. This is useful for AI coding agents,
build tools, CI scripts, and other tools that want structured Sentry data.

## Installation

```bash
npm install sentry
```

## Quick Start

```typescript
import sentry from "sentry";

// Run any CLI command — returns parsed JSON by default
const issues = await sentry("issue", "list", "-l", "5");
console.log(issues.data); // Array of issue objects
```

## Typed SDK

For structured access with named parameters and TypeScript types, use `createSentrySDK`:

```typescript
import { createSentrySDK } from "sentry";

const sdk = createSentrySDK({ token: "sntrys_..." });
```

### Organizations

```typescript
const orgs = await sdk.organizations.list();
const org = await sdk.organizations.get("acme");
```

### Projects

```typescript
const projects = await sdk.projects.list({ target: "acme/" });
const project = await sdk.projects.get({ target: "acme/frontend" });
```

### Issues

```typescript
const issues = await sdk.issues.list({
  org: "acme",
  project: "frontend",
  limit: 10,
  query: "is:unresolved",
  sort: "date",
});

const issue = await sdk.issues.get({ issueId: "ACME-123" });
```

### Events, Traces, Spans

```typescript
const event = await sdk.events.get({ eventId: "abc123..." });

const traces = await sdk.traces.list({ target: "acme/frontend" });
const trace = await sdk.traces.get({ traceId: "abc123..." });

const spans = await sdk.spans.list({ target: "acme/frontend" });
```

### Teams

```typescript
const teams = await sdk.teams.list({ target: "acme/" });
```

The typed SDK invokes command handlers directly — bypassing CLI string parsing
for zero overhead beyond the command's own logic.

## Authentication

The `token` option provides an auth token for the current invocation. When
omitted, it falls back to environment variables and stored credentials:

1. `token` option (highest priority)
2. `SENTRY_AUTH_TOKEN` environment variable
3. `SENTRY_TOKEN` environment variable
4. Stored OAuth token from `sentry auth login`

```typescript
// Explicit token
const orgs = await sentry("org", "list", { token: "sntrys_..." });

// Or set the env var — it's picked up automatically
process.env.SENTRY_AUTH_TOKEN = "sntrys_...";
const orgs = await sentry("org", "list");
```

## Options

All options are optional. Pass them as the last argument:

```typescript
await sentry("issue", "list", { token: "...", text: true, cwd: "/my/project" });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `string` | Auto-detected | Auth token for this invocation |
| `text` | `boolean` | `false` | Return human-readable text instead of parsed JSON |
| `cwd` | `string` | `process.cwd()` | Working directory for DSN auto-detection |

## Return Values

By default, commands that support JSON output return a **parsed JavaScript object**
— no serialization overhead. Commands without JSON support (like `help` or `--version`)
return a trimmed string.

```typescript
// Data commands → parsed object
const issues = await sentry("issue", "list");
// { data: [...], hasMore: true, nextCursor: "..." }

// Single-entity commands → parsed object
const issue = await sentry("issue", "view", "PROJ-123");
// { id: "123", title: "Bug", status: "unresolved", ... }

// Text commands → string
const version = await sentry("--version");
// "sentry 0.21.0"
```

### Text Mode

Pass `{ text: true }` to get the human-readable output as a string:

```typescript
const text = await sentry("issue", "list", { text: true });
// "ID       TITLE              STATUS\n..."
```

## Error Handling

Commands that exit with a non-zero code throw a `SentryError`:

```typescript
import sentry, { SentryError } from "sentry";

try {
  await sentry("issue", "view", "NONEXISTENT-1");
} catch (err) {
  if (err instanceof SentryError) {
    console.error(err.message);   // Clean error message (no ANSI codes)
    console.error(err.exitCode);  // Non-zero exit code
    console.error(err.stderr);    // Raw stderr output
  }
}
```

## Environment Isolation

The library never mutates `process.env`. Each invocation creates an isolated
copy of the environment. This means:

- Your application's env vars are never touched
- Multiple sequential calls are safe
- Auth tokens passed via `token` don't leak to subsequent calls

:::note
Concurrent calls to `sentry()` are not supported in the current version.
Calls should be sequential (awaited one at a time).
:::

## Comparison with Subprocess

| | Library (`sentry()`) | Subprocess (`child_process`) |
|---|---|---|
| **Startup** | ~0ms (in-process) | ~200ms (process spawn + init) |
| **Output** | Parsed object (zero-copy) | String (needs JSON.parse) |
| **Errors** | `SentryError` with typed fields | Exit code + stderr string |
| **Auth** | `token` option or env vars | Env vars only |
| **Node.js** | ≥22 required | Any version |

## Requirements

- **Node.js ≥ 22** (required for `node:sqlite`)
- Or **Bun** (any recent version)
