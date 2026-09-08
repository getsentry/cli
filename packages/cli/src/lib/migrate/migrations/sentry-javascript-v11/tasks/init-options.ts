/**
 * Options removed from or renamed in `Sentry.init()`.
 */

import type {
  ObjectExpression,
  ObjectMethod,
  ObjectProperty,
} from "@babel/types";
import { locate } from "../../../api.js";
import {
  findMember,
  findProperty,
  findSentryInitOptions,
  rangeOf,
} from "../../../ast.js";
import {
  dedentBlock,
  indentAt,
  indentDelta,
  prependProperty,
  removeEntries,
  renameProperty,
} from "../../../edits.js";
import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";
import { annotate } from "../marker.js";
import { EXPERIMENTS, removeInitOptions, type TaskFile } from "./_shared.js";

export const enableLogsRemoved = defineMigrationTask({
  id: "enable-logs",
  description: "Remove the `enableLogs` option; logging is opt-in by usage",
  docs: guide("enable-logs-removed"),
  run: ({ api }) => {
    api.script((context) =>
      removeInitOptions({ ...context, api }, [
        {
          key: "enableLogs",
          message:
            "removed `enableLogs`. Logs are captured whenever you use `Sentry.logger.*` or a logging integration",
        },
      ])
    );
  },
});

const METRICS_REMOVED =
  "removed `enableMetrics`. Metrics are captured whenever you use `Sentry.metrics.*`";

/**
 * `enableMetrics` was removed, and `beforeSendMetric` was promoted out of
 * `_experiments` to the top level at the same time. Deleting the option
 * without relocating the callback would silently drop the user's metric
 * scrubbing, so the two are decided together. In separate passes neither would
 * see the other's removal, and an `_experiments: {}` husk would be left
 * behind.
 */
export const enableMetricsRemoved = defineMigrationTask({
  id: "enable-metrics",
  description:
    "Remove `enableMetrics` and hoist `beforeSendMetric` to the top level",
  docs: guide("enable-metrics-removed"),
  run: ({ api }) => {
    api.script((context) => {
      const edits: Edit[] = [];
      for (const options of findSentryInitOptions(context.ast)) {
        edits.push(...migrateMetrics({ ...context, api }, options));
      }
      return edits;
    });
  },
});

function migrateMetrics(context: TaskFile, options: ObjectExpression): Edit[] {
  const { api, file, source } = context;
  const edits: Edit[] = [];

  const top = findProperty(options, "enableMetrics");
  if (top) {
    api.fixed(METRICS_REMOVED, locate(file, source, top));
  }

  const experiments = findProperty(options, EXPERIMENTS);
  const nestedHolder =
    experiments?.value.type === "ObjectExpression" ? experiments.value : null;

  const nested = nestedHolder
    ? findProperty(nestedHolder, "enableMetrics")
    : null;
  // The callback is as often a method shorthand as a property; the flag above
  // never is.
  const callback = nestedHolder
    ? findMember(nestedHolder, "beforeSendMetric")
    : null;
  const taken = [nested, callback].filter((node) => node !== null);

  if (callback && experiments) {
    edits.push(hoistCallback(context, options, experiments, callback));
  }

  if (nested) {
    api.fixed(
      `${METRICS_REMOVED} (was under \`${EXPERIMENTS}\`)`,
      locate(file, source, nested)
    );
  }

  // Every removal against one object goes through `removeEntries` in a single
  // call: `enableMetrics` and `beforeSendMetric` are routinely adjacent, and
  // adjacent removals share the comma between them.
  const emptiesExperiments =
    nestedHolder !== null && taken.length === nestedHolder.properties.length;

  const fromOptions = [
    ...(top ? [top] : []),
    ...(emptiesExperiments && experiments ? [experiments] : []),
  ];

  edits.push(...removeEntries(source, options.properties, fromOptions));
  if (nestedHolder && !emptiesExperiments) {
    edits.push(...removeEntries(source, nestedHolder.properties, taken));
  }

  return edits;
}

function hoistCallback(
  { api, file, source }: TaskFile,
  options: ObjectExpression,
  experiments: ObjectProperty,
  callback: ObjectProperty | ObjectMethod
): Edit {
  const { start, end } = rangeOf(callback);
  const outer = indentAt(source, rangeOf(experiments).start);
  const text = dedentBlock(
    source.slice(start, end),
    outer,
    indentDelta(outer, indentAt(source, start))
  );
  api.fixed(
    `moved \`beforeSendMetric\` out of \`${EXPERIMENTS}\` to the top level`,
    locate(file, source, callback)
  );
  return prependProperty(source, options, text);
}

/**
 * `ignoreTransactions` no-ops under span streaming; `ignoreSpans` replaces it.
 *
 * The rename is safe, but the semantics are not identical: `ignoreSpans`
 * matches *every* span rather than only root spans, so a name shared by a
 * child span now drops that child too. The task renames and then annotates,
 * because only the user knows whether their filter is specific enough.
 */
export const ignoreTransactionsRemoved = defineMigrationTask({
  id: "ignore-transactions",
  description: "Replace `ignoreTransactions` with `ignoreSpans`",
  docs: guide("ignore-transactions-removed"),
  run: ({ api }) => {
    api.script(({ file, source, ast }) => {
      const edits: Edit[] = [];

      for (const options of findSentryInitOptions(ast)) {
        const property = findProperty(options, "ignoreTransactions");
        if (!property) {
          continue;
        }

        const at = locate(file, source, property);
        edits.push(renameProperty(property, "ignoreSpans"));
        edits.push(
          ...annotate(
            source,
            property,
            "`ignoreSpans` matches every span, not only root spans. If child spans share this name, narrow it with the object form (`{ name, attributes }`)"
          )
        );
        api.fixed("renamed `ignoreTransactions` to `ignoreSpans`", at);
        api.manual(
          "check that the `ignoreSpans` patterns do not also match child spans, which are now dropped too",
          at
        );
      }

      return edits;
    });
  },
});
