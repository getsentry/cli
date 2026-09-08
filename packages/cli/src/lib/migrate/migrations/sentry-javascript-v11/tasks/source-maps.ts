/**
 * Hoist `sourceMapsUploadOptions` to the top level.
 *
 * SvelteKit, Nuxt, SolidStart and React Router each document this change
 * against their own wrapper call. Rather than detect four wrappers, the task
 * keys off the option name. `sourceMapsUploadOptions` is specific enough to
 * Sentry that a false positive is implausible, and keying off it handles
 * whichever wrapper the user reached for, including the nesting the frameworks
 * disagree about.
 */

import type { ObjectExpression, ObjectProperty } from "@babel/types";
import { locate } from "../../../api.js";
import {
  collect,
  findProperty,
  isObjectExpression,
  propertyName,
  rangeOf,
} from "../../../ast.js";
import {
  dedentBlock,
  indentAt,
  indentDelta,
  removeProperty,
  replaceNode,
} from "../../../edits.js";
import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";
import { annotate } from "../marker.js";
import type { TaskFile } from "./_shared.js";

const OPTION = "sourceMapsUploadOptions";

/** Keys renamed on the way out. */
const RENAMES: Record<string, string> = { url: "sentryUrl" };

export const sourceMapsOptionsHoist = defineMigrationTask({
  id: "source-maps-options",
  description: "Hoist `sourceMapsUploadOptions` fields to the top level",
  // Four guide sections describe this one transform. The index is the honest
  // link when no single section covers the task.
  docs: guide(),
  run: ({ api }) => {
    api.script((context) => {
      const edits: Edit[] = [];
      for (const object of collect(context.ast, isObjectExpression)) {
        const property = findProperty(object, OPTION);
        if (property && property.value.type === "ObjectExpression") {
          edits.push(
            ...hoist({ ...context, api }, object, property, property.value)
          );
        }
      }
      return edits;
    });
  },
});

/**
 * Whether `enabled` blocks the rewrite.
 *
 * `enabled` became `sourcemaps.disable`, with the sense inverted. Hoisting
 * `enabled: false` verbatim would leave an unrecognised option behind and
 * silently re-enable source map upload, which is worse than not touching the
 * file at all. Only a literal `enabled: true` is safe, and only because it
 * matches the new default and so carries no information.
 */
function blocksRewrite(inner: ObjectExpression): boolean {
  const enabled = findProperty(inner, "enabled");
  if (!enabled) {
    return false;
  }
  return !(enabled.value.type === "BooleanLiteral" && enabled.value.value);
}

/** Source text for one hoisted field, with its key renamed if it moved. */
function hoistedField(
  source: string,
  entry: ObjectExpression["properties"][number],
  renamed: string[]
): string {
  const name = propertyName(entry);
  const { start, end } = rangeOf(entry);
  const replacement = name ? RENAMES[name] : undefined;

  if (name && replacement && entry.type === "ObjectProperty") {
    renamed.push(`${name} → ${replacement}`);
    return replacement + source.slice(rangeOf(entry.key).end, end);
  }
  return source.slice(start, end);
}

function hoist(
  { api, file, source }: TaskFile,
  object: ObjectExpression,
  property: ObjectProperty,
  inner: ObjectExpression
): Edit[] {
  const at = locate(file, source, property);

  // Nothing to hoist, so the option goes. It has to go through
  // `removeProperty` to take its separating comma with it. Blanking the
  // property's own range instead leaves `{ , adapter }`, a file that no longer
  // parses and that every later task then skips.
  if (inner.properties.length === 0) {
    api.fixed(`removed the empty \`${OPTION}\` option`, at);
    return [removeProperty(source, object, property)];
  }

  if (blocksRewrite(inner)) {
    api.manual(
      `\`${OPTION}.enabled\` has no direct replacement. It became \`sourcemaps.disable\`, with the sense inverted`,
      at
    );
    return annotate(
      source,
      property,
      `\`${OPTION}\` was removed: move these to the top level, and replace \`enabled\` with \`sourcemaps: { disable: … }\` (the sense is inverted)`
    );
  }

  const outerIndent = indentAt(source, rangeOf(property).start);
  const firstInner = inner.properties[0];
  // How much deeper the nested properties sit, so multi-line values can be
  // lifted a level without reformatting the whole file.
  const extra = indentDelta(
    outerIndent,
    firstInner ? indentAt(source, rangeOf(firstInner).start) : outerIndent
  );

  const renamed: string[] = [];
  const hoisted = inner.properties
    .filter((entry) => propertyName(entry) !== "enabled")
    .map((entry) =>
      dedentBlock(hoistedField(source, entry, renamed), outerIndent, extra)
    );

  // `enabled: true` was the only field, and it carries no information in v11.
  // Same reasoning as the empty case above: remove the property, do not blank
  // it, or the trailing comma is left behind.
  if (hoisted.length === 0) {
    api.fixed(
      `removed \`${OPTION}\`. \`enabled: true\` already matches the v11 default`,
      at
    );
    return [removeProperty(source, object, property)];
  }

  const suffix = renamed.length > 0 ? ` (${renamed.join(", ")})` : "";
  api.fixed(
    `hoisted ${hoisted.length} \`${OPTION}\` field${hoisted.length === 1 ? "" : "s"} to the top level${suffix}`,
    at
  );
  return [replaceNode(property, hoisted.join(`,\n${outerIndent}`))];
}
