# feat(bun): Add `@sentry/bun/light` entry point without OpenTelemetry

**Repo**: https://github.com/getsentry/sentry-javascript

## Problem

`@sentry/bun` imports `@sentry/node`, which eagerly loads the entire OpenTelemetry stack and **29+ auto-instrumentation modules** (Express, MongoDB, Redis, PostgreSQL, Kafka, Prisma, AI providers, etc.). For CLI tools and other non-server Bun applications, none of these instrumentations are relevant, yet they cost:

- **~150ms** additional import time
- **~24MB** in `node_modules` (36 `@opentelemetry/*` packages)

## Measured Impact

Benchmarks from our Bun CLI project ([getsentry/cli](https://github.com/getsentry/cli)):

| Import | Time | What Loads |
|--------|------|------------|
| `@sentry/bun` | **~285ms** | Full OTel stack + 29 auto-instrumentations (36 OTel packages) |
| `@sentry/node-core/light` | **~130ms** | Core SDK only, no OTel, AsyncLocalStorage for context |

The **~155ms difference** is entirely from OpenTelemetry packages that a CLI tool never uses. `@sentry/bun` adds only ~2ms on top of `@sentry/node` (it's a thin wrapper: `BunClient`, `bunServerIntegration`, `makeFetchTransport`).

## Proposal

Add `@sentry/bun/light` that mirrors what `@sentry/node-core/light` does for Node:

1. **Uses `@sentry/node-core/light` instead of `@sentry/node`** — no OpenTelemetry dependency
2. **Keeps Bun-specific niceties**:
   - `makeFetchTransport` as default transport (uses global `fetch()`)
   - `runtime: { name: 'bun', version: Bun.version }` in SDK metadata
   - SDK metadata tagged as `"bun-light"` (or similar)
3. **No `bunServerIntegration` in defaults** — it's for `Bun.serve()` which light-mode users (CLIs, scripts) likely don't need
4. **Uses `AsyncLocalStorage`** for context propagation (same as `@sentry/node-core/light`)

### Usage

```typescript
// Before (285ms):
import * as Sentry from "@sentry/bun";

// After (130ms):
import * as Sentry from "@sentry/bun/light";
```

All existing APIs (`captureException`, `startSpan`, `setTag`, `metrics`, `logger`, `createConsolaReporter`, etc.) would be available — just without the OTel auto-instrumentation overhead.

## Current Workaround

We switched from `@sentry/bun` to `@sentry/node-core/light` directly. This works but:
- Loses Bun-specific SDK metadata (runtime name shows as "node" instead of "bun")
- Doesn't use `makeFetchTransport` by default (falls back to Node's `http` module — works in Bun but isn't native)
- Requires users to know about the internal package structure

A first-party `@sentry/bun/light` would be more ergonomic and keep Bun users within the expected SDK.
