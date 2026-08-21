/**
 * Changes that need a decision, found by pattern rather than by parsing.
 *
 * These sit between the codemod and the detector tasks. A detector task walks
 * the AST and can point at the exact call site. A check task matches text, so
 * it is broader and less certain. Each of these covers something a detector
 * cannot reach: an environment variable in a Dockerfile, an OpenTelemetry
 * provider from a package this migration does not model, a config key in a
 * file that is not a script.
 *
 * Where another task already locates something exactly, it is left out here:
 * `needs-judgment.ts` finds the removed Sentry exports, and the Next.js task
 * finds `reactComponentAnnotation`. Two tasks reporting the same call site
 * would double every entry in the report and make the exact hit look like one
 * guess among several.
 *
 * `when` gates a check on independent evidence, for patterns that are common
 * outside the change they describe. Without it, an Ember entry lands in every
 * project that calls `browserTracingIntegration`.
 */

import { defineCheckTask } from "../../../check-task.js";
import type { MigrationTask } from "../../../framework.js";
import { guide } from "../guide.js";

/** Source files a check looks at when it does not say otherwise. */
const CODE_FILES = "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";

export const judgmentChecks: MigrationTask[] = [
  defineCheckTask({
    id: "check-custom-otel-setup",
    description: "Custom OpenTelemetry provider bootstrap",
    docs: guide("custom-otel-setup"),
    include: CODE_FILES,
    // `SentrySampler`, `SentrySpanProcessor` and `SentryContextManager` are
    // located exactly by `detect-removed-exports`; only the provider itself,
    // which comes from an OpenTelemetry package, is left to match on.
    patterns: ["NodeTracerProvider"],
    guidance:
      "`SentrySampler`, `SentrySpanProcessor` and `SentryContextManager` were removed; a custom OpenTelemetry setup now exports over OTLP via `Sentry.getOtlpTracesEndpoint()`. This is a rewrite of your provider bootstrap, not a substitution.",
  }),
  defineCheckTask({
    id: "check-otlp-integration",
    description: "OTLP integration moved to the platform SDK",
    docs: guide("otlp-integration-changes"),
    include: CODE_FILES,
    patterns: ["otlpIntegration", "OTLPTraceExporter"],
    guidance:
      "The OTLP integration moved to your platform SDK and needs an exporter you configure, pointed at `Sentry.getOtlpTracesEndpoint(dsn)` or at your own collector.",
  }),
  defineCheckTask({
    id: "check-core-removed-apis",
    description: "Removed `@sentry/core` APIs used without an import",
    docs: guide("core-removed-apis"),
    include: CODE_FILES,
    patterns: [
      // Bare `.clear()` matches every Map and Set in the project, so the
      // pattern names the receivers `Scope.clear()` is actually reached
      // through.
      /\b(scope|getCurrentScope\(\)|getIsolationScope\(\)|getGlobalScope\(\))\.clear\s*\(\s*\)/i,
      "instrumentFetchRequest",
      "SpanEnvelope",
    ],
    guidance:
      "Seven unrelated `@sentry/core` exports were removed, each with its own replacement: `Scope.clear()`, `instrumentFetchRequest`'s positional `spanOrigin`, `createSpanEnvelope`, and others. TypeScript catches all but `disableInstrumentationWarnings`.",
  }),
  defineCheckTask({
    id: "check-node-removed-apis",
    description: "Removed `@sentry/node` APIs and options",
    docs: guide("node-removed-apis"),
    include: CODE_FILES,
    patterns: [
      "registerEsmLoaderHooks",
      "prismaInstrumentation",
      "setShouldHandleError",
      "disableAwsContextPropagation",
      "patchExpressModule",
      "connectIntegration",
    ],
    guidance:
      "Ten unrelated `@sentry/node` exports and options were removed, each with its own replacement. Most are caught by TypeScript.",
  }),
  defineCheckTask({
    id: "check-opentelemetry-env",
    description: "OpenTelemetry environment variables are no longer read",
    docs: guide("opentelemetry-removed-apis"),
    include: ["**/*.{js,ts,mjs,cjs,yml,yaml,env,sh}", "**/Dockerfile*"],
    patterns: ["OTEL_SERVICE_NAME", "OTEL_RESOURCE_ATTRIBUTES"],
    guidance:
      "`OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` are no longer read. Dashboards reading `contexts.otel.resource` need updating too.",
  }),
  defineCheckTask({
    id: "check-react-router-server-wrappers",
    description: "React Router server wrappers are no longer needed",
    docs: guide("react-router-server-wrappers"),
    include: CODE_FILES,
    patterns: ["wrapServerLoader", "wrapServerAction", "sentryHandleRequest"],
    guidance:
      "Loaders and actions are instrumented automatically now. The per-export wrappers come off and the instrumentation is exported from `entry.server.tsx` instead, which restructures that file.",
  }),
  defineCheckTask({
    id: "check-ember-v2-addon",
    description: "Ember addon moved to v2 format",
    docs: guide("ember-v2-addon"),
    include: "**/config/environment.js",
    patterns: ["@sentry/ember"],
    guidance:
      "The Ember addon moved to v2 format: initialization moves from `config/environment.js` to `app/app.ts`. This restructures application startup.",
  }),
  defineCheckTask({
    id: "check-ember-app-instance",
    description: "Ember browser tracing needs the application instance",
    docs: guide("ember-app-instance-required"),
    include: CODE_FILES,
    patterns: ["instrumentAppInstancePerformance", "browserTracingIntegration"],
    // `browserTracingIntegration` appears in every browser project that
    // traces. Only an Ember app has to pass the application instance.
    when: { include: "**/package.json", patterns: [/"@sentry\/ember"\s*:/] },
    guidance:
      "Browser tracing now needs the application instance passed explicitly, which depends on how your app is wired.",
  }),
  defineCheckTask({
    id: "check-child-process-integration",
    description: "`childProcessIntegration` split in two",
    docs: guide("child-process-worker-split"),
    include: CODE_FILES,
    patterns: ["childProcessIntegration"],
    guidance:
      "`childProcessIntegration` split, with worker-thread behavior moving to `workerIntegration`. Only affects you if you customized it; the default setup needs no change.",
  }),
  defineCheckTask({
    id: "check-hono-integration",
    description: "Built-in Hono integration was removed",
    docs: guide("hono-integration-removed"),
    include: CODE_FILES,
    patterns: ["honoIntegration"],
    guidance:
      "The built-in Hono integration was removed in favour of the `@sentry/hono` package. That is middleware rather than an integration, so it is a different wiring, not a rename.",
  }),
  defineCheckTask({
    id: "check-unstable-bundler-options",
    description: "`unstable_` bundler-plugin options were removed",
    docs: guide("unstable-bundler-plugin-options"),
    include: CODE_FILES,
    patterns: [/unstable_sentry\w*PluginOptions/],
    guidance:
      "The `unstable_` bundler-plugin escape hatch was removed. Most uses were `applicationKey`, which now has a top-level equivalent, but the mapping depends on what you set.",
  }),
];
