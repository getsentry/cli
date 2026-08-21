/**
 * Runtime options passed to the Astro integration.
 *
 * `sentryAstro()` no longer accepts runtime options. They move to
 * `sentry.client.config.ts` and `sentry.server.config.ts`.
 *
 * This is a detector, not a fix, and the reason is worth recording. Moving the
 * options means writing them into two files that may not exist yet, and
 * deciding for each option whether it belongs on the client, the server, or
 * both. `dsn` goes to both. `replaysSessionSampleRate` is client-only. A tool
 * that guessed would either duplicate options where they do nothing or, worse,
 * delete a `dsn` from the only place it was set and leave the project with no
 * DSN at all.
 *
 * So the task names every runtime option it finds and where it found it, and
 * leaves the move to a human or an agent that can read the rest of the project.
 */

import { locate } from "../../../api.js";
import { callOptions, findCallsTo, propertyName } from "../../../ast.js";
import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";
import { annotate } from "../marker.js";

/** Options that are runtime-only in v11 and must leave `sentryAstro()`. */
const RUNTIME_OPTIONS = new Set([
  "dsn",
  "environment",
  "sampleRate",
  "tracesSampleRate",
  "replaysSessionSampleRate",
  "replaysOnErrorSampleRate",
]);

export const astroRuntimeOptions = defineMigrationTask({
  id: "astro-runtime-options",
  description: "Locate runtime options that must leave `sentryAstro()`",
  docs: guide("astro-runtime-options"),
  guidance:
    "Runtime options moved out of `sentryAstro()` into `sentry.client.config.ts` / `sentry.server.config.ts`. Whether an option belongs in the client file, the server file or both depends on the option, and those files may not exist yet.",
  run: ({ api }) => {
    api.script(({ file, source, ast }) => {
      const edits: Edit[] = [];

      for (const name of ["sentryAstro", "sentry"]) {
        for (const call of findCallsTo(ast, name)) {
          const options = callOptions(call);
          if (!options) {
            continue;
          }

          const found = options.properties
            .map((property) => propertyName(property))
            .filter(
              (key): key is string => key !== null && RUNTIME_OPTIONS.has(key)
            );

          // `release` is build-time in v11 rather than removed, so its
          // presence alone is not a signal.
          if (found.length === 0) {
            continue;
          }

          edits.push(
            ...annotate(
              source,
              options,
              `these are runtime options in v11 and must move to sentry.client.config.ts / sentry.server.config.ts: ${found.join(", ")}`
            )
          );
          api.manual(
            `move ${found.join(", ")} to \`sentry.client.config.ts\` and/or \`sentry.server.config.ts\`. \`sentryAstro()\` now takes build-time options only`,
            locate(file, source, options)
          );
        }
      }

      return edits;
    });
  },
});
