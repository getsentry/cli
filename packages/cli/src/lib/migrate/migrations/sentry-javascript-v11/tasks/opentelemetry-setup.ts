/**
 * `skipOpenTelemetrySetup` became `enableOpenTelemetrySetup`, inverted.
 *
 * The rename alone would silently reverse the user's intent, so the value is
 * inverted with it. Only a boolean literal can be inverted safely. Anything
 * else (a variable, an environment lookup, a ternary) is marked instead,
 * because wrapping it in a negation would be a guess about what the expression
 * means.
 */

import { locate } from "../../../api.js";
import { findProperty, findSentryInitOptions } from "../../../ast.js";
import { replaceNode } from "../../../edits.js";
import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";
import { annotate } from "../marker.js";

const OLD = "skipOpenTelemetrySetup";
const NEW = "enableOpenTelemetrySetup";

export const enableOpenTelemetrySetup = defineMigrationTask({
  id: "opentelemetry-setup",
  description: `Replace \`${OLD}\` with \`${NEW}\`, inverting the value`,
  docs: guide("enable-opentelemetry-setup"),
  run: ({ api }) => {
    api.script(({ file, source, ast }) => {
      const edits: Edit[] = [];

      for (const options of findSentryInitOptions(ast)) {
        const property = findProperty(options, OLD);
        if (!property) {
          continue;
        }

        const at = locate(file, source, property);
        const value = property.value;

        if (value.type !== "BooleanLiteral") {
          edits.push(
            ...annotate(
              source,
              property,
              `\`${OLD}\` became \`${NEW}\` with the opposite meaning. Rename it and invert this value by hand`
            )
          );
          api.manual(
            `\`${OLD}\` became \`${NEW}\` with the opposite meaning, and this value is not a literal so it cannot be inverted automatically`,
            at
          );
          continue;
        }

        edits.push(replaceNode(property.key, NEW));
        edits.push(replaceNode(value, String(!value.value)));
        api.fixed(
          `\`${OLD}: ${value.value}\` → \`${NEW}: ${!value.value}\``,
          at
        );
      }

      return edits;
    });
  },
});
