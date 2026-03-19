# feat(core): Add `@sentry/core/light` sub-path export to reduce import time for lightweight consumers

**Repo**: https://github.com/getsentry/sentry-javascript

## Problem

`@sentry/core` has a single barrel entry point (`index.js`) that eagerly loads **179 ESM modules** (~776 KB). This includes:

- AI tracing integrations: OpenAI, Anthropic, Google GenAI, LangChain, LangGraph, Vercel AI SDK (21 files, ~170 KB)
- MCP server integration (14 files, ~160 KB)
- Supabase integration (1 file, ~14 KB)
- Feature flags integrations (3 files, ~8 KB)
- Other unused server-framework-specific code: tRPC, fetch instrumentation, idle spans, etc.

Even `@sentry/node-core/light`, which was designed to be lightweight, re-exports from the full `@sentry/core` barrel, forcing consumers to pay the entire import cost.

## Measured Impact

On our Bun CLI project ([getsentry/cli](https://github.com/getsentry/cli)):

| Configuration | `@sentry/core` Import Time |
|---|---|
| Full barrel (current) | **~40ms** |
| Barrel with 29 unused export lines removed (59 transitive modules, 310 KB) | **~27ms** |

That's a **33% improvement** just by removing modules that lightweight consumers never use.

## Proposal

Add a `@sentry/core/light` sub-path export (similar to `@sentry/node-core/light`) that excludes:

- AI tracing integrations (OpenAI, Anthropic, Google GenAI, LangChain, LangGraph, Vercel AI SDK)
- MCP server integration
- Supabase integration
- Feature flags integrations (featureFlagsIntegration, growthbookIntegration)
- Server-framework-specific code (tRPC middleware, fetch instrumentation, idle spans)
- Other heavy modules not needed for basic error/tracing/session/logs usage

Then `@sentry/node-core/light` could import from `@sentry/core/light` instead of `@sentry/core`, further reducing the startup cost of lightweight mode.

## Our Patch (for reference)

We're currently removing these 32 export lines from the barrel via `bun patch`:

```
export { TRACING_DEFAULTS, startIdleSpan } from './tracing/idleSpan.js';
export { _INTERNAL_clearAiProviderSkips, ... } from './utils/ai/providerSkip.js';
export { moduleMetadataIntegration } from './integrations/moduleMetadata.js';
export { captureConsoleIntegration } from './integrations/captureconsole.js';
export { dedupeIntegration } from './integrations/dedupe.js';
export { extraErrorDataIntegration } from './integrations/extraerrordata.js';
export { rewriteFramesIntegration } from './integrations/rewriteframes.js';
export { instrumentSupabaseClient, supabaseIntegration } from './integrations/supabase.js';
export { instrumentPostgresJsSql } from './integrations/postgresjs.js';
export { zodErrorsIntegration } from './integrations/zoderrors.js';
export { thirdPartyErrorFilterIntegration } from './integrations/third-party-errors-filter.js';
export { featureFlagsIntegration } from './integrations/featureFlags/featureFlagsIntegration.js';
export { growthbookIntegration } from './integrations/featureFlags/growthbook.js';
export { conversationIdIntegration } from './integrations/conversationId.js';
export { profiler } from './profiling.js';
export { instrumentFetchRequest } from './fetch.js';
export { trpcMiddleware } from './trpc.js';
export { wrapMcpServerWithSentry } from './integrations/mcp-server/index.js';
export { addVercelAiProcessors } from './tracing/vercel-ai/index.js';
export { _INTERNAL_cleanupToolCallSpanContext, ... } from './tracing/vercel-ai/utils.js';
export { toolCallSpanContextMap as ... } from './tracing/vercel-ai/constants.js';
export { instrumentOpenAiClient } from './tracing/openai/index.js';
export { OPENAI_INTEGRATION_NAME } from './tracing/openai/constants.js';
export { instrumentAnthropicAiClient } from './tracing/anthropic-ai/index.js';
export { ANTHROPIC_AI_INTEGRATION_NAME } from './tracing/anthropic-ai/constants.js';
export { instrumentGoogleGenAIClient } from './tracing/google-genai/index.js';
export { GOOGLE_GENAI_INTEGRATION_NAME } from './tracing/google-genai/constants.js';
export { createLangChainCallbackHandler } from './tracing/langchain/index.js';
export { LANGCHAIN_INTEGRATION_NAME } from './tracing/langchain/constants.js';
export { instrumentLangGraph, instrumentStateGraphCompile } from './tracing/langgraph/index.js';
export { LANGGRAPH_INTEGRATION_NAME } from './tracing/langgraph/constants.js';
export { _INTERNAL_FLAG_BUFFER_SIZE, ... } from './utils/featureFlags.js';
```

We also remove the corresponding re-exports from `@sentry/node-core/light/index.js`.

Happy to contribute a PR if the approach is accepted.
