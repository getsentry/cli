/**
 * `InboundFilters` → `EventFilters`.
 *
 * The integration was renamed, the deprecated `inboundFiltersIntegration`
 * export was dropped, and the integration now reports itself as
 * `EventFilters`. Code that looks it up by name, typically to disable it via
 * the `integrations` callback, breaks silently rather than loudly. Both halves
 * have to move together.
 */

import { locate } from "../../../api.js";
import { collect, isStringLiteral, rangeOf } from "../../../ast.js";
import { replaceNode } from "../../../edits.js";
import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";
import { renameSentryExport, type TaskFile } from "./_shared.js";

const OLD_EXPORT = "inboundFiltersIntegration";
const NEW_EXPORT = "eventFiltersIntegration";
const OLD_NAME = "InboundFilters";
const NEW_NAME = "EventFilters";

export const eventFiltersRename = defineMigrationTask({
  id: "event-filters",
  description: "Rename `InboundFilters` to `EventFilters`",
  docs: guide("event-filters-rename"),
  run: ({ api }) => {
    api.script((context) => {
      const scoped = { ...context, api };
      return [
        // The export rename is the shared one: import specifier, then every
        // reference to the binding it introduced.
        ...renameSentryExport(scoped, OLD_EXPORT, NEW_EXPORT),
        ...renameIntegrationName(scoped),
      ];
    });
  },
});

/**
 * The integration's reported name, used in `integrations` callbacks and
 * `getIntegrationByName()` lookups. Missing this is the half that fails
 * silently rather than loudly.
 */
function renameIntegrationName({ api, file, source, ast }: TaskFile): Edit[] {
  const edits: Edit[] = [];

  for (const literal of collect(ast, isStringLiteral)) {
    if (literal.value !== OLD_NAME) {
      continue;
    }
    const quote = source[rangeOf(literal).start] === "'" ? "'" : '"';
    edits.push(replaceNode(literal, `${quote}${NEW_NAME}${quote}`));
    api.fixed(
      `integration name \`${OLD_NAME}\` → \`${NEW_NAME}\``,
      locate(file, source, literal)
    );
  }

  return edits;
}
