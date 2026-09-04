/**
 * `sendDefaultPii` becomes `dataCollection`.
 *
 * This is not a rename. In v10, leaving `sendDefaultPii` unset behaved like
 * `false` and was restrictive. In v11, leaving `dataCollection` unset collects
 * most categories. Cookies, request and response bodies, user info and
 * database query data all move from "not collected" to "collected".
 *
 * The task therefore does three different things, and which one applies
 * depends on the value it finds:
 *
 * | Found | Action |
 * | --- | --- |
 * | `sendDefaultPii: true` | Remove it. The v11 default already matches. |
 * | `sendDefaultPii: false` | Replace it with the explicit v10-equivalent baseline. |
 * | Anything else | Mark it. Choosing a branch would mean evaluating the expression. |
 * | Absent | Report only. There is no setting to migrate, but the default still widened. |
 *
 * The last row is the one that matters most and is easiest to get wrong. A
 * project that never set `sendDefaultPii` has no option for this task to find,
 * yet it is precisely the project whose data collection widens on upgrade. So
 * this task reports on every `Sentry.init()` it sees, whether or not it changed
 * anything.
 *
 * Every outcome also carries a review note. The baseline this task writes
 * reproduces v10 behaviour, which is the safe default rather than the right
 * answer. Only the user knows their data policy.
 */

import type { ObjectExpression } from "@babel/types";
import { locate } from "../../../api.js";
import { findProperty, findSentryInitOptions, rangeOf } from "../../../ast.js";
import { indentAt, removeProperty, replaceNode } from "../../../edits.js";
import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { isAlreadyOnV11 } from "../detect.js";
import { guide } from "../guide.js";
import { annotate } from "../marker.js";
import type { TaskFile } from "./_shared.js";

const OPTION = "sendDefaultPii";

/**
 * The header deny-list v10 applied when `sendDefaultPii` was off.
 *
 * Taken verbatim from the migration guide rather than derived. Inventing
 * entries here would silently change what gets scrubbed.
 */
const DENY = ["forwarded", "-ip", "remote-", "via", "-user"];

/** Written above a baseline this task generated. */
const REVIEW_BASELINE =
  "review this `dataCollection` config. It reproduces the v10 behaviour, which is the safe default rather than necessarily the one you want. Check request and response bodies in particular.";

/** Written where the option was removed because the v11 default already matches. */
const REVIEW_DEFAULT =
  "`sendDefaultPii: true` matched the v11 `dataCollection` default, so the option was removed. Set `dataCollection` explicitly if you want to narrow what is collected.";

/**
 * Match the file's dominant quote style, so a generated block does not look
 * pasted in from somewhere else.
 */
function quoteStyle(source: string): string {
  const single = (source.match(/'/g) ?? []).length;
  const double = (source.match(/"/g) ?? []).length;
  return single > double ? "'" : '"';
}

/** The v10-equivalent `dataCollection` baseline, indented for its new home. */
function baseline(source: string, indent: string): string {
  const q = quoteStyle(source);
  const deny = `{ deny: [${DENY.map((entry) => `${q}${entry}${q}`).join(", ")}] }`;
  const inner = `${indent}  `;

  return [
    "dataCollection: {",
    `${inner}userInfo: false,`,
    `${inner}cookies: false,`,
    `${inner}httpHeaders: {`,
    `${inner}  request: ${deny},`,
    `${inner}  response: ${deny},`,
    `${inner}},`,
    `${inner}httpBodies: [],`,
    `${inner}urlQueryParams: ${deny},`,
    `${inner}genAI: { inputs: false, outputs: false },`,
    `${inner}databaseQueryData: false,`,
    `${inner}graphQL: { document: false, variables: false },`,
    `${indent}}`,
  ].join("\n");
}

export const dataCollection = defineMigrationTask({
  id: "data-collection",
  description:
    "Replace `sendDefaultPii` with an explicit `dataCollection` config",
  docs: guide("data-collection"),
  run: ({ api }) => {
    const alreadyMigrated = isAlreadyOnV11(api.originalPkg);
    api.script((context) => {
      const edits: Edit[] = [];
      for (const options of findSentryInitOptions(context.ast)) {
        edits.push(
          ...migrateOne({ ...context, api }, options, alreadyMigrated)
        );
      }
      return edits;
    });
  },
});

function migrateOne(
  context: TaskFile,
  options: ObjectExpression,
  alreadyMigrated: boolean
): Edit[] {
  const { api, file, source } = context;
  const property = findProperty(options, OPTION);

  if (!property) {
    // No setting to migrate, but the defaults still widened underneath this
    // project. This is the common case and the one worth being loud about,
    // except on a project already on v11, which has lived with the new
    // defaults and does not need to hear about them on every run.
    if (!alreadyMigrated) {
      api.manual(
        "`sendDefaultPii` was not set, so v10 applied its restrictive default. v11 collects cookies, request and response bodies, user info and database query data by default. Set `dataCollection` explicitly if you need the old behaviour.",
        locate(file, source, options)
      );
    }
    return [];
  }

  const at = locate(file, source, property);
  const value = property.value;

  if (value.type !== "BooleanLiteral") {
    api.manual(
      `\`${OPTION}\` was replaced by \`dataCollection\`, and this value is not a literal so the equivalent config cannot be chosen automatically`,
      at
    );
    return annotate(
      source,
      property,
      `\`${OPTION}\` was replaced by \`dataCollection\`. Pick the per-category controls that match this value`
    );
  }

  if (value.value) {
    // `sendDefaultPii: true` and the v11 default collect the same categories,
    // so the option simply goes.
    api.fixed(
      `removed \`${OPTION}: true\`. The v11 \`dataCollection\` default already matches it`,
      at
    );
    api.manual(REVIEW_DEFAULT, at);
    return [
      ...annotate(source, property, REVIEW_DEFAULT),
      removeProperty(source, options, property),
    ];
  }

  const indent = indentAt(source, rangeOf(property).start);
  api.fixed(
    `replaced \`${OPTION}: false\` with the equivalent explicit \`dataCollection\` config`,
    at
  );
  api.manual(REVIEW_BASELINE, at);
  return [
    ...annotate(source, property, REVIEW_BASELINE),
    replaceNode(property, baseline(source, indent)),
  ];
}
