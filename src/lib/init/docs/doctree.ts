/**
 * Navigates the docs.sentry.io doctree (the hierarchical sitemap published at
 * /doctree.json) to find candidate documentation pages by lib/feature seeds
 * and free-text search. Ported from the retired docs-mcp worker.
 */

import { buildDocsUrl, fetchDocTree, normalizeDocPath } from "./fetcher.js";

export type DocTreeNode = {
  children?: DocTreeNode[];
  frontmatter?: {
    description?: string;
    sidebar_hidden?: boolean;
    sidebar_order?: number;
    title?: string;
  };
  path: string;
  slug?: string;
};

export type DocPageHit = {
  title: string;
  url: string;
  description?: string;
};

const TRAILING_SLASH_RE = /\/$/;

let doctreeCache: DocTreeNode | null = null;
let doctreeInflight: Promise<DocTreeNode> | null = null;

/** Parse and return the doctree, cached for the process lifetime. */
export function getDoctree(): Promise<DocTreeNode> {
  if (doctreeCache) {
    return Promise.resolve(doctreeCache);
  }
  if (doctreeInflight) {
    return doctreeInflight;
  }
  doctreeInflight = (async () => {
    try {
      const json = await fetchDocTree();
      doctreeCache = JSON.parse(json) as DocTreeNode;
      return doctreeCache;
    } finally {
      doctreeInflight = null;
    }
  })();
  return doctreeInflight;
}

/**
 * Lib slug -> canonical Sentry docs platform path. For framework-flavored
 * guides the path is `/platforms/<lang>/guides/<framework>/`; for the bare
 * runtime/SDK it is just `/platforms/<lang>/`.
 */
const LIB_TO_PLATFORM_PATH: Record<string, string> = {
  nextjs: "/platforms/javascript/guides/nextjs/",
  "next.js": "/platforms/javascript/guides/nextjs/",
  next: "/platforms/javascript/guides/nextjs/",
  node: "/platforms/javascript/guides/node/",
  "node.js": "/platforms/javascript/guides/node/",
  express: "/platforms/javascript/guides/express/",
  bun: "/platforms/javascript/guides/bun/",
  react: "/platforms/javascript/guides/react/",
  vue: "/platforms/javascript/guides/vue/",
  svelte: "/platforms/javascript/guides/svelte/",
  sveltekit: "/platforms/javascript/guides/sveltekit/",
  nestjs: "/platforms/javascript/guides/nestjs/",
  nuxt: "/platforms/javascript/guides/nuxt/",
  astro: "/platforms/javascript/guides/astro/",
  remix: "/platforms/javascript/guides/remix/",
  angular: "/platforms/javascript/guides/angular/",
  browser: "/platforms/javascript/",
  javascript: "/platforms/javascript/",
  "react native": "/platforms/react-native/",
  "react-native": "/platforms/react-native/",
  "tanstackstart-react": "/platforms/javascript/guides/tanstackstart-react/",
  "tanstack-start": "/platforms/javascript/guides/tanstackstart-react/",
  "tanstack-start-react": "/platforms/javascript/guides/tanstackstart-react/",
  solid: "/platforms/javascript/guides/solid/",
  solidstart: "/platforms/javascript/guides/solidstart/",
  gatsby: "/platforms/javascript/guides/gatsby/",
  ember: "/platforms/javascript/guides/ember/",
  "react-router": "/platforms/javascript/guides/react-router/",
  hono: "/platforms/javascript/guides/hono/",
  fastify: "/platforms/javascript/guides/fastify/",
  koa: "/platforms/javascript/guides/koa/",
  hapi: "/platforms/javascript/guides/hapi/",
  cloudflare: "/platforms/javascript/guides/cloudflare/",
  electron: "/platforms/javascript/guides/electron/",
  capacitor: "/platforms/javascript/guides/capacitor/",
  deno: "/platforms/javascript/guides/deno/",
  "aws-lambda": "/platforms/javascript/guides/aws-lambda/",
  "azure-functions": "/platforms/javascript/guides/azure-functions/",
  "gcp-functions": "/platforms/javascript/guides/gcp-functions/",
  firebase: "/platforms/javascript/guides/firebase/",
  python: "/platforms/python/",
  django: "/platforms/python/integrations/django/",
  flask: "/platforms/python/integrations/flask/",
  fastapi: "/platforms/python/integrations/fastapi/",
  celery: "/platforms/python/integrations/celery/",
  go: "/platforms/go/",
  ruby: "/platforms/ruby/",
  rails: "/platforms/ruby/guides/rails/",
  dotnet: "/platforms/dotnet/",
  ".net": "/platforms/dotnet/",
  ios: "/platforms/apple/guides/ios/",
  cocoa: "/platforms/apple/",
  android: "/platforms/android/",
  flutter: "/platforms/dart/guides/flutter/",
  dart: "/platforms/dart/",
  elixir: "/platforms/elixir/",
  php: "/platforms/php/",
  laravel: "/platforms/php/guides/laravel/",
  rust: "/platforms/rust/",
  java: "/platforms/java/",
  kotlin: "/platforms/android/",
};

/** Feature slug -> docs sub-path under a platform guide. */
const FEATURE_TO_SUBPATH: Record<string, string> = {
  "error-monitoring": "",
  tracing: "tracing/",
  performance: "tracing/",
  "session-replay": "session-replay/",
  profiling: "profiling/",
  logs: "logs/",
  logging: "logs/",
  "source-maps": "sourcemaps/",
  sourcemaps: "sourcemaps/",
  crons: "crons/",
  metrics: "metrics/",
  "ai-monitoring": "tracing/instrumentation/ai-agents-module/",
  "mcp-observability": "",
  "user-feedback": "user-feedback/",
};

const FEATURE_EXTRA_PATHS: Record<string, string[]> = {
  "mcp-observability": ["/ai/monitoring/mcp/getting-started/"],
};

const DEFAULT_SEED_LIMIT = 20;

/** Resolve a lib slug to its canonical docs.sentry.io platform path. */
export function libToPlatformPath(lib: string): string | null {
  const normalized = lib.toLowerCase().trim();
  return LIB_TO_PLATFORM_PATH[normalized] ?? null;
}

/** Build a candidate doc path for a (lib, feature) combo, or null if unknown. */
export function libFeaturePath(lib: string, feature: string): string | null {
  const platformPath = libToPlatformPath(lib);
  if (!platformPath) {
    return null;
  }
  const subpath = FEATURE_TO_SUBPATH[feature.toLowerCase().trim()];
  if (subpath === undefined) {
    return null;
  }
  return `${platformPath.replace(TRAILING_SLASH_RE, "")}/${subpath}`.replace(
    TRAILING_SLASH_RE,
    ""
  );
}

/** Find seed doc pages for a (libs[], features[]) combo. */
export function findPagesForLibsFeatures(
  libs: string[],
  features: string[],
  limit: number = DEFAULT_SEED_LIMIT
): string[] {
  const paths = new Set<string>();

  for (const lib of libs) {
    if (paths.size >= limit) {
      break;
    }
    const platformPath = libToPlatformPath(lib);
    if (platformPath) {
      const base = platformPath.replace(TRAILING_SLASH_RE, "");
      paths.add(normalizeDocPath(platformPath));
      paths.add(normalizeDocPath(`${base}/install/`));
      paths.add(normalizeDocPath(`${base}/manual-setup/`));
    }
  }

  outer: for (const feature of features) {
    for (const lib of libs) {
      if (paths.size >= limit) {
        break outer;
      }
      const path = libFeaturePath(lib, feature);
      if (path) {
        paths.add(normalizeDocPath(path));
      }
    }
    const extraPaths = FEATURE_EXTRA_PATHS[feature.toLowerCase().trim()] ?? [];
    for (const extraPath of extraPaths) {
      if (paths.size >= limit) {
        break outer;
      }
      paths.add(normalizeDocPath(extraPath));
    }
  }

  return [...paths];
}

function* walkDoctree(node: DocTreeNode): Generator<DocTreeNode> {
  if (node.frontmatter?.sidebar_hidden) {
    return;
  }
  yield node;
  if (node.children) {
    for (const child of node.children) {
      yield* walkDoctree(child);
    }
  }
}

const INSTALL_SYNONYMS_RE =
  /\/(install|manual-setup|manual-install|quick-start|getting-started)\//;

function scoreNode(node: DocTreeNode, queryLower: string): number {
  const title = node.frontmatter?.title?.toLowerCase() ?? "";
  const description = node.frontmatter?.description?.toLowerCase() ?? "";
  const path = node.path.toLowerCase();

  let score = 0;
  if (title === queryLower) {
    score += 100;
  }
  if (title.includes(queryLower)) {
    score += 25;
  }
  if (path.includes(queryLower)) {
    score += 15;
  }
  if (description.includes(queryLower)) {
    score += 5;
  }

  const isInstallQuery = ["install", "setup", "manual"].some((kw) =>
    queryLower.includes(kw)
  );
  if (isInstallQuery && INSTALL_SYNONYMS_RE.test(path)) {
    score += 12;
  }

  return score;
}

/** Substring search over the doctree's titles, descriptions, and paths. */
export async function searchPages(
  query: string,
  limit = 8
): Promise<DocPageHit[]> {
  const root = await getDoctree();
  const queryLower = query.toLowerCase().trim();
  if (!queryLower) {
    return [];
  }

  const hits: Array<{ node: DocTreeNode; score: number }> = [];
  for (const node of walkDoctree(root)) {
    const score = scoreNode(node, queryLower);
    if (score > 0) {
      hits.push({ node, score });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map(({ node }) => ({
    title: node.frontmatter?.title ?? node.slug ?? node.path,
    url: buildDocsUrl(node.path),
    description: node.frontmatter?.description,
  }));
}
