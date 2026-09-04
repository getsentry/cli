/**
 * Cloudflare-specific removals.
 */

import type { ObjectProperty } from "@babel/types";
import { locate } from "../../../api.js";
import {
  collect,
  findSentryCalls,
  propertyName,
  rangeOf,
} from "../../../ast.js";
import { replaceNode } from "../../../edits.js";
import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";

/**
 * `instrumentD1WithSentry` was removed. `withSentry()` instruments every D1
 * binding on `env` automatically, so the wrapper comes off and the binding is
 * used directly.
 */
export const cloudflareInstrumentD1 = defineMigrationTask({
  id: "cloudflare-d1",
  description: "Remove the `instrumentD1WithSentry` wrapper",
  docs: guide("cloudflare-instrument-d1"),
  run: ({ api }) => {
    api.script(({ file, source, ast }) => {
      const edits: Edit[] = [];

      for (const call of findSentryCalls(ast, "instrumentD1WithSentry")) {
        const binding = call.arguments[0];
        if (!binding) {
          continue;
        }
        // Replace the whole call with its argument: `Sentry.instrumentD1WithSentry(env.DB)`
        // becomes `env.DB`.
        const { start, end } = rangeOf(binding);
        edits.push(replaceNode(call, source.slice(start, end)));
        api.fixed(
          "removed the `instrumentD1WithSentry` wrapper. D1 bindings are instrumented automatically",
          locate(file, source, call)
        );
      }

      return edits;
    });
  },
});

/**
 * `instrumentPrototypeMethods` was replaced by `enableRpcTracePropagation`,
 * which v10 introduced for the purpose.
 */
export const cloudflarePrototypeMethods = defineMigrationTask({
  id: "cloudflare-prototype-methods",
  description:
    "Rename `instrumentPrototypeMethods` to `enableRpcTracePropagation`",
  docs: guide("cloudflare-instrument-prototype-methods"),
  run: ({ api }) => {
    api.script(({ file, source, ast }) => {
      const edits: Edit[] = [];

      // The option sits inside a callback passed to
      // `instrumentDurableObjectWithSentry`, so it is found by key name rather
      // than by walking the call's arguments. The name is specific enough to
      // Sentry that a false match is implausible.
      for (const property of collect(
        ast,
        (node): node is ObjectProperty => node.type === "ObjectProperty"
      )) {
        if (propertyName(property) !== "instrumentPrototypeMethods") {
          continue;
        }
        edits.push(replaceNode(property.key, "enableRpcTracePropagation"));
        api.fixed(
          "`instrumentPrototypeMethods` → `enableRpcTracePropagation`",
          locate(file, source, property)
        );
      }

      return edits;
    });
  },
});
