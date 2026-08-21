/**
 * The marker this migration leaves in user code for follow-up work.
 *
 * Every annotation a task inserts carries this prefix, so a human or an agent
 * can find the complete set with one grep, and the report can tell them to.
 * The form follows this repo's existing v3-to-v4 codemod (`TODO(sentry-v4)`),
 * and names the SDK as well as the version because this CLI ships migrations
 * for more than one.
 *
 * That last part is why the marker lives here rather than in `edits.ts`. A
 * marker naming this migration, written by a future migration, would send the
 * reader to the wrong guide for work it did not do.
 */

import { annotator } from "../../edits.js";

export const TODO_MARKER = "TODO(sentry-javascript-v11)";

/** `annotate` for this migration's tasks, bound to its marker. */
export const annotate = annotator(TODO_MARKER);
