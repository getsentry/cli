/**
 * Long-deprecated `withSentryConfig` options.
 *
 * Most of these moved under a `webpack` key in v10 and were removed outright
 * in v11. `next.config.js` is usually plain JavaScript, so TypeScript catches
 * none of it, which makes this one of the few v11 changes that fails silently
 * at build time rather than loudly.
 *
 * The task moves what it can and annotates what it cannot. Several options did
 * not simply relocate: `disableLogger` became a nested treeshake flag,
 * `disableManifestInjection` inverted into `routeManifestInjection`, and
 * `unstable_sentryWebpackPluginOptions` has no replacement at all. Guessing at
 * those would change build behaviour, so they get a marker comment instead.
 */

import type { ObjectExpression, ObjectProperty } from "@babel/types";
import { locate } from "../../../api.js";
import {
  findCallsTo,
  findProperty,
  isObjectExpression,
  propertyName,
  rangeOf,
} from "../../../ast.js";
import {
  dedentBlock,
  indentAt,
  indentDelta,
  removeEntries,
  replaceNode,
} from "../../../edits.js";
import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";
import { annotate } from "../marker.js";
import type { TaskFile } from "./_shared.js";

/** Options that moved verbatim under `webpack`. */
const MOVED_TO_WEBPACK = new Set([
  "autoInstrumentServerFunctions",
  "autoInstrumentMiddleware",
  "autoInstrumentAppDirectory",
  "automaticVercelMonitors",
  "excludeServerRoutes",
]);

/** Options whose replacement is not a straight move. */
const NEEDS_JUDGMENT: Record<string, string> = {
  disableSentryWebpackConfig: "renamed to `webpack.disableSentryConfig`",
  disableLogger:
    "replaced by `webpack.treeshake.removeDebugLogging`, which nests differently, so move it by hand",
  disableManifestInjection:
    "replaced by `routeManifestInjection: false`, with the sense inverted",
  unstable_sentryWebpackPluginOptions:
    "removed entirely; set the option you need directly on the Sentry build options",
  reactComponentAnnotation:
    "moved back to the top level with broader meaning. It now drives Turbopack too, which needs Next.js 16+",
};

/**
 * Build a `webpack: { … }` block from the options moving into it, lifted to
 * the indentation of their new home.
 */
function webpackBlock(
  source: string,
  outer: string,
  properties: ObjectProperty[]
): string {
  const inner = `${outer}  `;
  const entries = properties.map((property) => {
    const { start, end } = rangeOf(property);
    const extra = indentDelta(outer, indentAt(source, start));
    return inner + dedentBlock(source.slice(start, end), outer, extra);
  });
  return `webpack: {\n${entries.join(",\n")},\n${outer}}`;
}

export const nextjsRemovedOptions = defineMigrationTask({
  id: "nextjs-config",
  description: "Move removed `withSentryConfig` options under `webpack`",
  docs: guide("nextjs-removed-options"),
  run: ({ api }) => {
    api.script((context) => {
      const edits: Edit[] = [];
      for (const call of findCallsTo(context.ast, "withSentryConfig")) {
        // In `withSentryConfig(nextConfig, sentryOptions)` the options are the
        // second argument. A single-argument call has nothing to migrate.
        const options = call.arguments[1];
        if (options && isObjectExpression(options)) {
          edits.push(...migrateOptions({ ...context, api }, options));
        }
      }
      return edits;
    });
  },
});

function migrateOptions(
  { api, file, source }: TaskFile,
  options: ObjectExpression
): Edit[] {
  const edits: Edit[] = [];
  const moving: ObjectProperty[] = [];

  for (const entry of options.properties) {
    if (entry.type !== "ObjectProperty") {
      continue;
    }
    const name = propertyName(entry);
    if (!name) {
      continue;
    }

    const advice = NEEDS_JUDGMENT[name];
    if (advice) {
      edits.push(...annotate(source, entry, `\`${name}\` ${advice}`));
      api.manual(`\`${name}\` ${advice}`, locate(file, source, entry));
      continue;
    }

    if (MOVED_TO_WEBPACK.has(name)) {
      moving.push(entry);
    }
  }

  const first = moving[0];
  if (!first) {
    return edits;
  }

  // Merging into an existing `webpack` key would mean splicing into a nested
  // literal that may itself be a spread or a variable. Not worth guessing.
  if (findProperty(options, "webpack")) {
    edits.push(
      ...annotate(
        source,
        first,
        "these options moved under `webpack`, but this config already has a `webpack` key, so merge them by hand"
      )
    );
    api.manual(
      `${moving.length} option(s) belong under the existing \`webpack\` key`,
      locate(file, source, first)
    );
    return edits;
  }

  // Replace the first mover in place with the new block and delete the rest,
  // so the surrounding options keep their order and formatting. The deletions
  // go through `removeEntries` together, because movers are often adjacent and
  // adjacent removals share a separator.
  const outer = indentAt(source, rangeOf(first).start);
  edits.push(replaceNode(first, webpackBlock(source, outer, moving)));
  edits.push(...removeEntries(source, options.properties, moving.slice(1)));

  api.fixed(
    `moved ${moving.map((p) => `\`${propertyName(p)}\``).join(", ")} under \`webpack\``,
    locate(file, source, first)
  );
  return edits;
}
