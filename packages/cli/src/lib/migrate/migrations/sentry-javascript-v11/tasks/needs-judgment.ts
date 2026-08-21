/**
 * Detector-only tasks: find it exactly, refuse to fix it.
 *
 * Every task here covers a change that cannot be automated, because the right
 * replacement depends on what the user's code means rather than what it says.
 * `beforeSendTransaction` is the clearest case. Splitting it needs to know
 * whether a given callback was dropping events or scrubbing them, and
 * guessing wrong either silently keeps sending data the user meant to drop, or
 * silently drops data they meant to keep.
 *
 * But "cannot fix" is not the same as "cannot find". These tasks annotate the
 * exact call site and report a `file:line`, which turns a report entry from
 * "check whether this applies to you" into "go to this line". That is most of
 * the value an agent gets from the handoff file.
 *
 * So they annotate and report, and never rewrite. Finding something is not
 * fixing it.
 */

import type { File, Node } from "@babel/types";
import { locate } from "../../../api.js";
import {
  collect,
  findProperty,
  findSentryInitOptions,
  isImportDeclaration,
} from "../../../ast.js";
import { defineMigrationTask, type MigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";
import { annotate } from "../marker.js";

type OptionDetector = {
  option: string;
  /** Section of the guide covering this option. */
  anchor: string;
  /** Inserted as a marker comment above the option. */
  todo: string;
  /** Reported against each call site in the migration report. */
  report: string;
  /** Shown once, above the call sites: what the reader has to decide. */
  guidance: string;
};

const OPTION_DETECTORS: OptionDetector[] = [
  {
    option: "beforeSendTransaction",
    anchor: "before-send-transaction-removed",
    todo: "`beforeSendTransaction` no longer runs. Move dropping logic to `ignoreSpans`, and scrubbing logic to `beforeSendSpan` guarded on `span.is_segment`",
    report:
      "this callback no longer runs. Split it into `ignoreSpans` (for dropping) and `beforeSendSpan` guarded on `is_segment` (for scrubbing)",
    guidance:
      "`beforeSendTransaction` no-ops. Splitting it requires knowing what your callback did: dropping moves to `ignoreSpans`, scrubbing moves to `beforeSendSpan` guarded on `is_segment`. Automating this would have to guess which.",
  },
  {
    option: "beforeSendSpan",
    anchor: "before-send-span-format",
    todo: "`beforeSendSpan` now receives the streamed span format. Check the field names this callback reads and writes",
    report:
      "receives the streamed span format in v11; verify the fields this callback touches still exist",
    guidance:
      "`beforeSendSpan` receives a different shape. The field mapping depends on which fields your callback reads and writes.",
  },
  {
    option: "profilesSampleRate",
    anchor: "profiling-legacy-options",
    todo: "legacy profiling options were removed. Use `profileSessionSampleRate` with a `profileLifecycle` of `trace` or `manual`",
    report:
      "legacy profiling options were replaced by `profileSessionSampleRate` plus a `profileLifecycle`",
    guidance:
      "Legacy profiling options were replaced by `profileSessionSampleRate` plus a `profileLifecycle` of `trace` or `manual`. Which lifecycle is right depends on how you profile.",
  },
];

function optionDetector(detector: OptionDetector): MigrationTask {
  return defineMigrationTask({
    id: `detect-${detector.option}`,
    description: `Locate \`${detector.option}\``,
    docs: guide(detector.anchor),
    guidance: detector.guidance,
    run: ({ api }) => {
      api.script(({ file, source, ast }) => {
        const edits: Edit[] = [];
        for (const options of findSentryInitOptions(ast)) {
          const property = findProperty(options, detector.option);
          if (!property) {
            continue;
          }
          edits.push(...annotate(source, property, detector.todo));
          api.manual(
            `\`${detector.option}\`: ${detector.report}`,
            locate(file, source, property)
          );
        }
        return edits;
      });
    },
  });
}

export const optionDetectors: MigrationTask[] =
  OPTION_DETECTORS.map(optionDetector);

/**
 * Removed exports, and what to do instead.
 *
 * Seventeen unrelated removals, each with its own replacement, so the advice
 * is carried per symbol. The finding names both, which is more specific than
 * any single section of the guide could be.
 */
const REMOVED_EXPORTS: Record<string, { advice: string }> = {
  addAutoIpAddressToUser: {
    advice: "it was internal and is gone; remove the call",
  },
  createSpanEnvelope: {
    advice: "it existed only to send standalone spans as their own envelope",
  },
  disableInstrumentationWarnings: {
    advice:
      "instrumentation is channel-based now, so the warning it gated no longer exists",
  },
  isStreamedBeforeSendSpanCallback: {
    advice: "it was internal and is gone",
  },
  semanticAttributes: {
    advice: "import span attribute constants from `@sentry/core` directly",
  },
  SentryContextManager: {
    advice:
      "Sentry no longer sets up OpenTelemetry, so no context manager is needed",
  },
  SentryHttpInstrumentation: {
    advice: "use `instrumentHttpOutgoingRequests()` instead",
  },
  SentryNodeFetchInstrumentation: {
    advice: "use `nativeNodeFetchIntegration` instead",
  },
  generateInstrumentOnce: {
    advice:
      "it wrapped OpenTelemetry's `registerInstrumentations` and is no longer needed",
  },
  getTraceContextForScope: {
    advice: "it went with the OpenTelemetry decoupling",
  },
  getSentryResource: {
    advice: "it went with the OpenTelemetry decoupling",
  },
  SentrySampler: {
    advice:
      "export your own OpenTelemetry spans over OTLP using `Sentry.getOtlpTracesEndpoint()` instead",
  },
  SentrySpanProcessor: {
    advice:
      "export your own OpenTelemetry spans over OTLP using `Sentry.getOtlpTracesEndpoint()` instead",
  },
};

const SENTRY_PACKAGE = /^@sentry\//;

/** Named imports from a `@sentry/*` package, with their specifier nodes. */
function sentryNamedImports(ast: File): Array<{ name: string; node: Node }> {
  const found: Array<{ name: string; node: Node }> = [];

  for (const declaration of collect(ast, isImportDeclaration)) {
    if (!SENTRY_PACKAGE.test(declaration.source.value)) {
      continue;
    }
    for (const specifier of declaration.specifiers) {
      if (specifier.type !== "ImportSpecifier") {
        continue;
      }
      found.push({
        name:
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value,
        node: specifier,
      });
    }
  }

  return found;
}

/**
 * Find imports of exports that v11 removed.
 *
 * TypeScript already catches most of these at build time. This exists for the
 * plain-JavaScript configs where it does not, and because "your build will
 * fail somewhere" is a much worse handoff than a list of files and lines.
 */
export const removedExports = defineMigrationTask({
  id: "detect-removed-exports",
  description: "Locate imports of exports that v11 removed",
  // Spans four sections of the guide. Each finding names the export and its
  // replacement, so the index beats picking one of the four arbitrarily.
  docs: guide(),
  guidance:
    "Each of these exports was removed with its own replacement; the finding names it. TypeScript catches most of them at build time, but not in plain-JavaScript config files.",
  run: ({ api }) => {
    api.script(({ file, source, ast }) => {
      const edits: Edit[] = [];

      for (const { name, node } of sentryNamedImports(ast)) {
        const removal = REMOVED_EXPORTS[name];
        if (!removal) {
          continue;
        }
        const message = `\`${name}\` was removed: ${removal.advice}`;
        edits.push(...annotate(source, node, message));
        api.manual(message, locate(file, source, node));
      }

      return edits;
    });
  },
});
