/**
 * Options removed from the browser integrations.
 *
 * Three of these follow the same shape: an option of `browserTracingIntegration`
 * was removed, and the behaviour it controlled moved into a separate
 * integration the user must add.
 *
 * The task removes the dead option, which is unambiguous, and then reports the
 * integration to add. It does not insert the integration itself: doing so
 * needs a matching import, and emitting a call to a symbol that is not in
 * scope turns a working build into a broken one. That is the trade this whole
 * engine refuses to make.
 */

import { locate } from "../../../api.js";
import { findSentryCalls } from "../../../ast.js";
import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";
import { removeIntegrationOptions } from "./_shared.js";

export const browserUserTiming = defineMigrationTask({
  id: "browser-user-timing",
  description:
    "Move `ignorePerformanceApiSpans` to the new `userTimingIntegration`",
  docs: guide("browser-user-timing"),
  run: ({ api }) => {
    api.script((context) => {
      const scoped = { ...context, api };
      const edits: Edit[] = removeIntegrationOptions(scoped, {
        integrations: ["browserTracingIntegration"],
        options: [
          {
            option: "ignorePerformanceApiSpans",
            message:
              "removed `ignorePerformanceApiSpans`. It is now `ignore` on `userTimingIntegration()`",
            onFound: (property) => {
              const { start, end } = property.value.loc
                ? {
                    start: property.value.start ?? 0,
                    end: property.value.end ?? 0,
                  }
                : { start: 0, end: 0 };
              api.manual(
                `add \`userTimingIntegration({ ignore: ${context.source.slice(start, end)} })\` to your integrations`,
                locate(context.file, context.source, property)
              );
            },
          },
        ],
      });

      // `performance.mark()` and `performance.measure()` spans are no longer
      // captured at all by default, so anyone using browser tracing loses them
      // whether or not they configured the option.
      for (const call of findSentryCalls(
        context.ast,
        "browserTracingIntegration"
      )) {
        api.manual(
          "User Timing spans are no longer captured by default. Add `userTimingIntegration()` if you need `performance.mark()` and `performance.measure()`",
          locate(context.file, context.source, call)
        );
      }

      return edits;
    });
  },
});

export const trackFetchStreamPerformance = defineMigrationTask({
  id: "fetch-stream-performance",
  description:
    "Remove `trackFetchStreamPerformance` from `browserTracingIntegration`",
  docs: guide("track-fetch-stream-performance"),
  run: ({ api }) => {
    api.script((context) => {
      const scoped = { ...context, api };
      return removeIntegrationOptions(scoped, {
        integrations: ["browserTracingIntegration"],
        options: [
          {
            option: "trackFetchStreamPerformance",
            message:
              "removed `trackFetchStreamPerformance`. It is now `fetchStreamPerformanceIntegration()`",
            onFound: (property) => {
              api.manual(
                "add `fetchStreamPerformanceIntegration()` to your integrations to keep fetch stream timing",
                locate(context.file, context.source, property)
              );
            },
          },
        ],
      });
    });
  },
});

/**
 * CLS and LCP are no longer configurable. They are recorded as measurements on
 * the pageload span, or as dedicated spans under span streaming.
 */
export const browserWebVitalOptions = defineMigrationTask({
  id: "browser-web-vitals",
  description: "Remove the standalone CLS and LCP span options",
  docs: guide("browser-web-vital-options"),
  run: ({ api }) => {
    api.script((context) => {
      const scoped = { ...context, api };

      // Both options in one call: they are routinely adjacent entries of the
      // same object, and adjacent removals share a separator.
      return removeIntegrationOptions(scoped, {
        integrations: ["browserTracingIntegration", "webVitalsIntegration"],
        options: ["enableStandaloneClsSpans", "enableStandaloneLcpSpans"].map(
          (option) => ({
            option,
            message: `removed \`${option}\`. CLS and LCP are no longer configurable`,
            onFound: (property) => {
              api.manual(
                "if you built dashboards on standalone CLS or LCP spans, check they still resolve under your `traceLifecycle`",
                locate(context.file, context.source, property)
              );
            },
          })
        ),
      });
    });
  },
});

/**
 * The `console` option of `breadcrumbsIntegration` was removed. Console
 * breadcrumbs now come from a separate integration.
 */
export const consoleBreadcrumbs = defineMigrationTask({
  id: "console-breadcrumbs",
  description: "Remove the `console` option of `breadcrumbsIntegration`",
  docs: guide("console-breadcrumbs"),
  run: ({ api }) => {
    api.script((context) => {
      const scoped = { ...context, api };
      return removeIntegrationOptions(scoped, {
        integrations: ["breadcrumbsIntegration"],
        options: [
          {
            option: "console",
            message:
              "removed the `console` option of `breadcrumbsIntegration`. Console capture moved to `consoleIntegration`",
            onFound: (property) => {
              // `console` defaulted to true, so removing the option alone stops
              // console breadcrumbs for anyone who was not explicitly disabling
              // them. Which of those two cases this is depends on the value.
              const disabled =
                property.value.type === "BooleanLiteral" &&
                !property.value.value;
              if (!disabled) {
                api.manual(
                  "add `consoleIntegration()` from `@sentry/core` to keep capturing console breadcrumbs",
                  locate(context.file, context.source, property)
                );
              }
            },
          },
        ],
      });
    });
  },
});
