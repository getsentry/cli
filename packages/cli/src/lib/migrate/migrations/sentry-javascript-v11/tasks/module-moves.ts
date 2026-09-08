/**
 * Symbols and entry points that moved in v11.
 *
 * Each of these is a specifier rewrite with no judgment involved: the old path
 * or name no longer resolves, and exactly one replacement is correct.
 */

import { defineMigrationTask } from "../../../framework.js";
import { guide } from "../guide.js";
import {
  moveSpecifiers,
  renameSentryExport,
  rewriteModuleSources,
} from "./_shared.js";

/**
 * `@sentry/cloudflare/nodejs_compat` folded into the main entry point, because
 * `nodejs_compat` is now required for every Cloudflare user.
 */
export const cloudflareNodejsCompatSubpath = defineMigrationTask({
  id: "cloudflare-nodejs-compat-subpath",
  description:
    "Import from `@sentry/cloudflare` instead of the `nodejs_compat` subpath",
  docs: guide("cloudflare-nodejs-compat-subpath"),
  run: ({ api }) => {
    api.script((context) =>
      rewriteModuleSources(
        { ...context, api },
        (specifier) =>
          specifier === "@sentry/cloudflare/nodejs_compat"
            ? "@sentry/cloudflare"
            : null,
        (from, to) => `\`${from}\` → \`${to}\``
      )
    );
  },
});

/**
 * `wrapRequestHandler` moved the other way, off the main entry point and onto
 * a dedicated subpath.
 */
export const cloudflareWrapRequestHandler = defineMigrationTask({
  id: "cloudflare-wrap-request-handler",
  description: "Import `wrapRequestHandler` from `@sentry/cloudflare/request`",
  docs: guide("cloudflare-wrap-request-handler"),
  run: ({ api }) => {
    api.script((context) =>
      moveSpecifiers(
        { ...context, api },
        {
          from: "@sentry/cloudflare",
          to: "@sentry/cloudflare/request",
          symbols: new Set(["wrapRequestHandler"]),
        }
      )
    );
  },
});

/**
 * The SvelteKit Vite plugin moved to its own subpath.
 *
 * Re-exporting it from the main entry pulled the whole build-time module tree
 * (`@sentry/vite-plugin`, and through it `@babel/core`) into the server
 * runtime tree, which serverless bundlers then copied into the function.
 */
export const sveltekitVitePlugin = defineMigrationTask({
  id: "sveltekit-vite-subpath",
  description: "Import `sentrySvelteKit` from `@sentry/sveltekit/vite`",
  docs: guide("sveltekit-vite-subpath"),
  run: ({ api }) => {
    api.script((context) =>
      moveSpecifiers(
        { ...context, api },
        {
          from: "@sentry/sveltekit",
          to: "@sentry/sveltekit/vite",
          symbols: new Set(["sentrySvelteKit"]),
        }
      )
    );
  },
});

/**
 * `instrumentLangGraph` instruments only the `StateGraph` class, so it was
 * renamed to say so.
 */
export const instrumentStateGraphRename = defineMigrationTask({
  id: "instrument-state-graph",
  description: "Rename `instrumentLangGraph` to `instrumentStateGraph`",
  docs: guide("instrument-state-graph-rename"),
  run: ({ api }) => {
    api.script((context) =>
      renameSentryExport(
        { ...context, api },
        "instrumentLangGraph",
        "instrumentStateGraph"
      )
    );
  },
});
