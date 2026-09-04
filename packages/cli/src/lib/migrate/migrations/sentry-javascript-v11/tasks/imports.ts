/**
 * Symbols that moved between packages.
 *
 * Three v11 changes are "this lives somewhere else now": the
 * `@sentry/node-core` merge, the `@sentry/types` removal, and the AI
 * instrumentation move to `@sentry/server-utils`. The first two are
 * whole-package redirects; the third moves a named subset out of a package
 * that still exists, which needs the import split.
 */

import type { File, VariableDeclarator } from "@babel/types";
import { locate, type TaskApi } from "../../../api.js";
import { collect } from "../../../ast.js";
import { replaceNode } from "../../../edits.js";
import { defineMigrationTask } from "../../../framework.js";
import type { Edit } from "../../../types.js";
import { guide } from "../guide.js";
import { annotate } from "../marker.js";
import {
  moduleSpecifier,
  moduleSpecifiers,
  moveSpecifiers,
  removeInitOptions,
  type TaskFile,
} from "./_shared.js";

/**
 * Build a task that redirects every import of one package to another.
 *
 * Subpath imports (`@sentry/node-core/light`) are annotated rather than
 * rewritten. The replacement package does not necessarily publish the same
 * subpaths, and a rewrite that produces an unresolvable specifier turns a
 * working build into a broken one, which is worse than leaving a comment.
 */
function packageRedirect(config: {
  id: string;
  docs: string;
  description: string;
  from: string;
  to: string;
  reason: string;
}) {
  return defineMigrationTask({
    id: config.id,
    description: config.description,
    docs: config.docs,
    run: ({ api }) => {
      api.script(({ file, source, ast }) => {
        const edits: Edit[] = [];

        for (const { node, value } of moduleSpecifiers(ast)) {
          const at = locate(file, source, node);

          if (value === config.from) {
            edits.push(replaceNode(node, JSON.stringify(config.to)));
            api.fixed(
              `\`${config.from}\` → \`${config.to}\` (${config.reason})`,
              at
            );
            continue;
          }

          if (value.startsWith(`${config.from}/`)) {
            const subpath = value.slice(config.from.length);
            edits.push(
              ...annotate(
                source,
                node,
                `\`${config.from}\` was removed. Move this to \`${config.to}\`, but check that the \`${subpath}\` subpath exists there`
              )
            );
            api.manual(
              `subpath import \`${value}\` needs a manual move to \`${config.to}\``,
              at
            );
          }
        }

        return edits;
      });
    },
  });
}

export const nodeCoreMerged = packageRedirect({
  id: "node-core-imports",
  description: "Redirect `@sentry/node-core` imports to `@sentry/node`",
  docs: guide("node-core-merged"),
  from: "@sentry/node-core",
  to: "@sentry/node",
  reason: "merged back in v11",
});

export const sentryTypesRemoved = packageRedirect({
  id: "types-imports",
  description: "Redirect `@sentry/types` imports to `@sentry/core`",
  docs: guide("sentry-types-removed"),
  from: "@sentry/types",
  to: "@sentry/core",
  reason: "no longer published",
});

/**
 * AI instrumentation helpers that moved from `@sentry/core` to
 * `@sentry/server-utils`. Imports from a platform SDK such as `@sentry/node`
 * are unaffected and must not be touched.
 */
const AI_HELPERS = new Set([
  "instrumentOpenAiClient",
  "instrumentAnthropicAiClient",
  "instrumentGoogleGenAIClient",
  "instrumentWorkersAiClient",
  "createLangChainCallbackHandler",
  "instrumentLangChainEmbeddings",
  "instrumentStateGraph",
  "instrumentStateGraphCompile",
  "instrumentCreateReactAgent",
  "addVercelAiProcessors",
]);

/** Redirect or split `import { … } from "@sentry/core"` declarations. */
function moveEsmImports(context: TaskFile): Edit[] {
  return moveSpecifiers(context, {
    from: "@sentry/core",
    to: "@sentry/server-utils",
    symbols: AI_HELPERS,
    describe: (moved) =>
      `moved ${moved.join(", ")} from \`@sentry/core\` to \`@sentry/server-utils\``,
  });
}

/**
 * Annotate `const { … } = require("@sentry/core")` destructurings.
 *
 * Splitting one would mean rewriting a destructuring pattern and adding a
 * second require in the right scope, which is more machinery than the case is
 * worth. Saying nothing would leave a CommonJS user with no signal at all.
 */
function flagCjsRequires(
  api: TaskApi,
  file: string,
  source: string,
  ast: File
) {
  const edits: Edit[] = [];

  for (const declarator of collect(
    ast,
    (node): node is VariableDeclarator => node.type === "VariableDeclarator"
  )) {
    if (
      declarator.id.type !== "ObjectPattern" ||
      !declarator.init ||
      declarator.init.type !== "CallExpression" ||
      moduleSpecifier(declarator.init)?.value !== "@sentry/core"
    ) {
      continue;
    }

    const moved = declarator.id.properties
      .map((property) =>
        property.type === "ObjectProperty" && property.key.type === "Identifier"
          ? property.key.name
          : null
      )
      .filter((name): name is string => name !== null && AI_HELPERS.has(name));

    if (moved.length === 0) {
      continue;
    }

    edits.push(
      ...annotate(
        source,
        declarator,
        `${moved.join(", ")} moved to \`@sentry/server-utils\`. Require them from there instead`
      )
    );
    api.manual(
      `${moved.join(", ")} must be required from \`@sentry/server-utils\` (CommonJS requires are not rewritten automatically)`,
      locate(file, source, declarator)
    );
  }

  return edits;
}

export const aiExportsMoved = defineMigrationTask({
  id: "ai-exports",
  description: "Move AI instrumentation imports to `@sentry/server-utils`",
  docs: guide("ai-exports-moved"),
  run: ({ api }) => {
    api.script((context) => [
      ...moveEsmImports({ ...context, api }),
      ...flagCjsRequires(api, context.file, context.source, context.ast),
      ...removeInitOptions({ ...context, api }, [
        {
          key: "enableTruncation",
          message:
            "removed `enableTruncation`. Gen AI input is no longer truncated",
        },
        {
          key: "streamGenAiSpans",
          message:
            "removed `streamGenAiSpans`. Gen AI spans are always streamed in v11",
        },
      ]),
    ]);
  },
});
