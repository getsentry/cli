/**
 * Changes whose fix is not a code edit.
 *
 * A runtime minimum, a layer ARN, a compatibility flag, a `<script>` tag: no
 * codemod can make these, and none of them live in a file this migration
 * rewrites. What it can do is establish that they apply to *this* project and
 * say where to look.
 *
 * The minimum-version checks read the range the manifest actually declares and
 * stay quiet when it already clears the floor. Keying them on an inferred
 * framework instead would be wrong in both directions: a Fastify app installs
 * `@sentry/node` and would be read as a plain Node project, so the entry
 * written for it never appears; and a project already on React 19 would still
 * be told that React 17 is the minimum.
 */

import { defineCheckTask } from "../../../check-task.js";
import { defineMigrationTask, type MigrationTask } from "../../../framework.js";
import { guide } from "../guide.js";
import { belowFloor, declaredRange } from "../versions.js";

/**
 * A dependency whose minimum version rose, reported only when the project
 * still declares something below it.
 *
 * `packages` is a list because the same minimum can arrive under more than one
 * name. React Router ships as `react-router` and as `@react-router/*`.
 */
function minimumVersion(options: {
  slug: string;
  description: string;
  packages: string[];
  floor: string;
  guidance: string;
}): MigrationTask {
  return defineMigrationTask({
    id: `check-${options.slug}`,
    description: options.description,
    docs: guide(options.slug),
    guidance: options.guidance,
    run: ({ api }) => {
      const pkg = api.originalPkg;
      if (!pkg) {
        return;
      }
      for (const name of options.packages) {
        const declared = declaredRange(pkg, name);
        if (declared && belowFloor(declared, options.floor)) {
          api.manual(`\`${name}\` is declared at \`${declared}\``, {
            file: "package.json",
            line: 1,
          });
          return;
        }
      }
    },
  });
}

export const environmentChecks: MigrationTask[] = [
  minimumVersion({
    slug: "astro-min-version",
    description: "Astro 4 is the new minimum",
    packages: ["astro"],
    floor: "4.0.0",
    guidance:
      "Astro 4 is the new minimum. Upgrade Astro first, since the SDK will not build against Astro 3.",
  }),
  minimumVersion({
    slug: "fastify-min-version",
    description: "Fastify 3.21 is the new minimum",
    packages: ["fastify"],
    floor: "3.21.0",
    guidance:
      "Fastify 3.21 is the new minimum. Upgrade Fastify before upgrading the SDK.",
  }),
  minimumVersion({
    slug: "nextjs-min-version",
    description: "Next.js 14 is the new minimum",
    packages: ["next"],
    floor: "14.0.0",
    guidance:
      "Next.js 14 is the new minimum. Upgrade Next.js before upgrading the SDK.",
  }),
  minimumVersion({
    slug: "react-min-version",
    description: "React 17 is the new minimum",
    packages: ["react"],
    floor: "17.0.0",
    guidance:
      "React 17 is the new minimum. Upgrade React before upgrading the SDK.",
  }),
  minimumVersion({
    slug: "react-router-min-version",
    description: "React Router 7.15 is the new minimum",
    packages: ["react-router", "@react-router/node", "@react-router/dev"],
    floor: "7.15.0",
    guidance:
      "React Router 7.15 is the new minimum. Upgrade React Router before upgrading the SDK.",
  }),
  minimumVersion({
    slug: "remix-min-version",
    description: "`@remix-run/node` v2 is the new minimum",
    packages: ["@remix-run/node"],
    floor: "2.0.0",
    guidance:
      "`@remix-run/node` v2 is the new minimum. Upgrade Remix before upgrading the SDK.",
  }),

  // The Deno runtime is not declared anywhere this can read, so the SDK
  // package is the only available signal that the advice applies at all.
  defineCheckTask({
    id: "check-deno-version",
    description: "Deno 2.8.3 is the new minimum",
    docs: guide("deno-version"),
    include: "**/package.json",
    patterns: [/"@sentry\/deno"\s*:/],
    guidance:
      "Deno 2.8.3 is the new minimum. Upgrade the runtime in your CI images and deploy targets.",
  }),

  defineCheckTask({
    id: "check-cloudflare-nodejs-compat",
    description: "Cloudflare `nodejs_compat` flag and compatibility date",
    docs: guide("cloudflare-nodejs-compat"),
    include: ["**/wrangler.toml", "**/wrangler.json", "**/wrangler.jsonc"],
    patterns: ["nodejs_compat", "compatibility_date"],
    guidance:
      "The `nodejs_compat` flag and compatibility date live in `wrangler.toml` / `wrangler.jsonc`, not in source.",
  }),
  defineCheckTask({
    id: "check-aws-lambda-layer",
    description: "AWS Lambda layer ARN",
    docs: guide("aws-lambda-layer"),
    include: "**/*.{yml,yaml,tf,json}",
    patterns: [/arn:aws:lambda:[^:]+:\d+:layer:Sentry[\w-]*/i],
    guidance:
      "The layer ARN lives in your infrastructure config. Point your functions at the new ARN.",
  }),
  defineCheckTask({
    id: "check-metrics-cdn-bundle",
    description: "CDN bundle `<script>` tag",
    docs: guide("metrics-cdn-bundle"),
    include: "**/*.{html,htm,ejs,hbs,liquid,njk}",
    patterns: [/browser\.sentry-cdn\.com/],
    guidance:
      "The CDN bundle is selected by a `<script>` tag, so the change is in your HTML or template, not in JavaScript.",
  }),
  defineCheckTask({
    id: "check-remix-action-form-data",
    description: "Renamed Remix action span attributes",
    docs: guide("remix-action-form-data"),
    include: "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    patterns: ["formData."],
    // `formData.` appears in any app that handles a form. Only a Remix project
    // is affected by the rename, and only the SDK package proves it is one.
    when: { include: "**/package.json", patterns: [/"@sentry\/remix"\s*:/] },
    guidance:
      "Nothing in your code changes: `formData.*` span attributes were renamed to `remix.action_form_data.*`. Update dashboards, alerts and saved searches.",
  }),
];
