/**
 * The `/loader`, `/init` and `/preload` entry points.
 *
 * Now that instrumentation is channel-based, these no longer do anything. The
 * `/loader` entry points have a direct replacement, so they are rewritten.
 * `/init` and `/preload` do not. Replacing those means writing an instrument
 * file that calls `Sentry.init()`, which only the user can author, so they are
 * marked instead.
 *
 * These paths appear in `node --import` arguments as often as in source, so
 * the task covers scripts, Dockerfiles and CI files too.
 */

import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";
import { rewriteModuleSources } from "./_shared.js";

/** `@sentry/<pkg>/loader`, replaced by `/import` in the same package. */
const LOADER_SUBPATH = /^(@sentry\/[\w-]+)\/loader$/;

/** Entry points with no drop-in replacement. */
const NO_REPLACEMENT = /@sentry\/node\/(init|preload)\b/;

const RUN_COMMAND_FILES = [
  "**/Dockerfile*",
  "**/Procfile",
  ".github/workflows/*.{yml,yaml}",
  ".circleci/*.{yml,yaml}",
  ".gitlab-ci.yml",
];

/** `@sentry/x/loader` wherever it appears in a shell command. */
const LOADER_IN_COMMAND = /(@sentry\/[\w-]+)\/loader\b/g;

export const nodeLoaderEntryPoints = defineMigrationTask({
  id: "node-entry-points",
  description:
    "Replace the removed `/loader`, `/init` and `/preload` entry points",
  docs: guide("node-loader-entry-points"),
  run: ({ api }) => {
    api.script((context) => {
      const edits: Edit[] = [
        ...rewriteModuleSources(
          { ...context, api },
          (specifier) => {
            const match = LOADER_SUBPATH.exec(specifier);
            return match ? `${match[1]}/import` : null;
          },
          (from, to) => `\`${from}\` → \`${to}\``
        ),
      ];

      // `preloadOpenTelemetry()` and the `/init` and `/preload` entry points
      // need an instrument file the user has to write, so they are marked
      // rather than guessed at.
      for (const [index, line] of context.source.split("\n").entries()) {
        if (
          !(NO_REPLACEMENT.test(line) || line.includes("preloadOpenTelemetry"))
        ) {
          continue;
        }
        api.manual(
          "this entry point was removed. Create an instrument file that calls `Sentry.init()` and preload it with `node --import ./instrument.mjs`",
          { file: context.file, line: index + 1 }
        );
      }

      return edits;
    });

    // The same subpath, in the command that starts the app.
    api.files(
      {
        include: RUN_COMMAND_FILES,
        where: (content) => content.includes("/loader"),
      },
      (content, file) => {
        const updated = content.replace(LOADER_IN_COMMAND, "$1/import");
        if (updated === content) {
          return false;
        }
        api.fixed("`/loader` → `/import` in the run command", {
          file,
          line: content.slice(0, content.indexOf("/loader")).split("\n").length,
        });
        return updated;
      }
    );

    // And in npm scripts.
    api.manifest((pkg) => {
      const scripts = pkg.scripts;
      if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
        return false;
      }

      let changed = false;
      const entries = scripts as Record<string, unknown>;
      for (const [name, command] of Object.entries(entries)) {
        if (typeof command !== "string") {
          continue;
        }
        const updated = command.replace(LOADER_IN_COMMAND, "$1/import");
        if (updated !== command) {
          entries[name] = updated;
          changed = true;
          api.fixed(`scripts.${name}: \`/loader\` → \`/import\``, {
            file: "package.json",
            line: 1,
          });
        }
      }
      return changed;
    });
  },
});
