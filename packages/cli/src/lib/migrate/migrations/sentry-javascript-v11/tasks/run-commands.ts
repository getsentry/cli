/**
 * How the app is started: `node --require` → `node --import`.
 *
 * Node re-runs `--require` preloads on the internal loader thread it spawns
 * for `Module.register()`, which the SDK triggers itself when it installs
 * instrumentation hooks. A `--require`d instrument file therefore ran
 * `Sentry.init()` a second time, on a thread that never executes user code.
 * v11 detects this and warns instead of initialising.
 *
 * This is the clearest case for the non-JavaScript surfaces existing at all.
 * The flag almost never appears in source: it lives in an npm script, a
 * Dockerfile `CMD`, a Procfile, or a CI job. A source-only migration would
 * report this item as "nothing found" on a repo where it is in production use.
 */

import { defineMigrationTask } from "../../../framework.js";
import { guide } from "../guide.js";

/**
 * `node … --require`, with the flag still attached to a `node` invocation.
 *
 * Anchoring on `node` matters: `--require` is also a flag of `mocha`, `tsx`
 * and `nyc`, where it has nothing to do with this change and rewriting it
 * would break the command.
 */
const SHELL_FORM = /(\bnode\b[^\n"']*?)\s--require(=|\s)/g;

/**
 * The same flag in *exec form*: `CMD ["node", "--require", "./instrument.js"]`.
 * Both forms are idiomatic in a Dockerfile, and matching only the shell form
 * would miss the production entrypoint of any Dockerfile written the
 * recommended way.
 */
const EXEC_FORM = /("node"\s*,\s*)"--require"/g;

/** Files whose run command is worth rewriting. */
const RUN_COMMAND_FILES = [
  "**/Dockerfile*",
  "**/Procfile",
  ".github/workflows/*.{yml,yaml}",
  ".circleci/*.{yml,yaml}",
  ".gitlab-ci.yml",
];

const MESSAGE = "`node --require` → `node --import`";

/** Replace the flag, leaving the surrounding command untouched. */
function swapFlag(content: string): string {
  return content
    .replace(SHELL_FORM, "$1 --import$2")
    .replace(EXEC_FORM, '$1"--import"');
}

export const requireToImport = defineMigrationTask({
  id: "require-to-import",
  description:
    "Replace `node --require` with `node --import` in scripts and run commands",
  docs: guide("require-to-import"),
  run: ({ api }) => {
    // npm scripts.
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
        const updated = swapFlag(command);
        if (updated !== command) {
          entries[name] = updated;
          changed = true;
          api.fixed(`scripts.${name}: ${MESSAGE}`, {
            file: "package.json",
            line: 1,
          });
        }
      }
      return changed;
    });

    // Dockerfiles, Procfiles and CI YAML. Matched by regex rather than a
    // parser: three unrelated grammars, and the only thing changing is one
    // flag inside a shell command that none of them model anyway.
    api.files(
      {
        include: RUN_COMMAND_FILES,
        where: (content) => content.includes("--require"),
      },
      (content, file) => {
        const updated = swapFlag(content);
        if (updated === content) {
          return false;
        }
        api.fixed(MESSAGE, {
          file,
          line: content.slice(0, content.indexOf("--require")).split("\n")
            .length,
        });
        return updated;
      }
    );
  },
});
