/**
 * Shared platform validation for Sentry projects.
 *
 * Source of truth: sentry/src/sentry/models/project.py GETTING_STARTED_DOCS_PLATFORMS
 */

import { isPlainOutput } from "./formatters/markdown.js";
import { buildMarkdownTable, type Column } from "./formatters/table.js";
import { renderTextTable } from "./formatters/text-table.js";
import { levenshtein } from "./fuzzy.js";

/** Full list of valid Sentry platform identifiers (112 from backend + "other"). */
export const VALID_PLATFORMS = [
  "android",
  "apple",
  "apple-ios",
  "apple-macos",
  "bun",
  "capacitor",
  "cordova",
  "dart",
  "deno",
  "dotnet",
  "dotnet-aspnet",
  "dotnet-aspnetcore",
  "dotnet-awslambda",
  "dotnet-gcpfunctions",
  "dotnet-maui",
  "dotnet-uwp",
  "dotnet-winforms",
  "dotnet-wpf",
  "dotnet-xamarin",
  "electron",
  "elixir",
  "flutter",
  "go",
  "go-echo",
  "go-fasthttp",
  "go-fiber",
  "go-gin",
  "go-http",
  "go-iris",
  "go-martini",
  "go-negroni",
  "godot",
  "ionic",
  "java",
  "java-log4j2",
  "java-logback",
  "java-spring",
  "java-spring-boot",
  "javascript",
  "javascript-angular",
  "javascript-astro",
  "javascript-ember",
  "javascript-gatsby",
  "javascript-nextjs",
  "javascript-nuxt",
  "javascript-react",
  "javascript-react-router",
  "javascript-remix",
  "javascript-solid",
  "javascript-solidstart",
  "javascript-svelte",
  "javascript-sveltekit",
  "javascript-tanstackstart-react",
  "javascript-vue",
  "kotlin",
  "minidump",
  "native",
  "native-qt",
  "nintendo-switch",
  "node",
  "node-awslambda",
  "node-azurefunctions",
  "node-cloudflare-pages",
  "node-cloudflare-workers",
  "node-connect",
  "node-express",
  "node-fastify",
  "node-gcpfunctions",
  "node-hapi",
  "node-hono",
  "node-koa",
  "node-nestjs",
  "other",
  "php",
  "php-laravel",
  "php-symfony",
  "playstation",
  "powershell",
  "python",
  "python-aiohttp",
  "python-asgi",
  "python-awslambda",
  "python-bottle",
  "python-celery",
  "python-chalice",
  "python-django",
  "python-falcon",
  "python-fastapi",
  "python-flask",
  "python-gcpfunctions",
  "python-pylons",
  "python-pymongo",
  "python-pyramid",
  "python-quart",
  "python-rq",
  "python-sanic",
  "python-serverless",
  "python-starlette",
  "python-tornado",
  "python-tryton",
  "python-wsgi",
  "react-native",
  "ruby",
  "ruby-rack",
  "ruby-rails",
  "rust",
  "unity",
  "unreal",
  "xbox",
] as const;

/** O(1) lookup set for platform validation. */
export const VALID_PLATFORM_SET: ReadonlySet<string> = new Set(VALID_PLATFORMS);

/** Curated subset shown in help text when platform is missing or invalid. */
export const COMMON_PLATFORMS = [
  "javascript",
  "javascript-react",
  "javascript-nextjs",
  "javascript-vue",
  "javascript-angular",
  "javascript-svelte",
  "javascript-remix",
  "javascript-astro",
  "node",
  "node-express",
  "python",
  "python-django",
  "python-flask",
  "python-fastapi",
  "go",
  "ruby",
  "ruby-rails",
  "php",
  "php-laravel",
  "java",
  "android",
  "dotnet",
  "react-native",
  "apple-ios",
  "rust",
  "elixir",
  "flutter",
] as const;

/** Check if a platform string is valid. */
export function isValidPlatform(platform: string): boolean {
  return VALID_PLATFORM_SET.has(platform);
}

/** Build a 3-column grid string from a flat list of platforms. */
export function renderPlatformGrid(items: readonly string[]): string {
  const COLS = 3;
  const rows: string[][] = [];
  for (let i = 0; i < items.length; i += COLS) {
    const row = items.slice(i, i + COLS);
    while (row.length < COLS) {
      row.push("");
    }
    rows.push(row);
  }

  if (isPlainOutput()) {
    const columns: Column<string[]>[] = Array.from(
      { length: COLS },
      (_, ci) => ({
        header: " ",
        value: (row: string[]) => row[ci] ?? "",
      })
    );
    return buildMarkdownTable(rows, columns);
  }

  const [first, ...rest] = rows;
  return renderTextTable(first ?? [], rest, {
    headerSeparator: false,
  });
}

function addUnique(arr: string[], value: string): void {
  if (!arr.includes(value)) {
    arr.push(value);
  }
}

function findSuffixMatches(invalid: string): string[] {
  const results: string[] = [];
  const suffix = `-${invalid}`;
  for (const p of VALID_PLATFORMS) {
    if (p.endsWith(suffix)) {
      results.push(p);
    }
  }
  return results;
}

function findPrefixMatches(invalid: string): string[] {
  const results: string[] = [];
  const prefix = `${invalid}-`;
  for (const p of VALID_PLATFORMS) {
    if (p.startsWith(prefix)) {
      results.push(p);
    }
  }
  return results;
}

function findSwapMatches(invalid: string): string[] {
  const dashIdx = invalid.indexOf("-");
  if (dashIdx <= 0) {
    return [];
  }

  const results: string[] = [];
  const suffix = invalid.slice(dashIdx + 1);

  if (VALID_PLATFORM_SET.has(suffix)) {
    results.push(suffix);
  }

  const swapped = `${suffix}-${invalid.slice(0, dashIdx)}`;
  if (VALID_PLATFORM_SET.has(swapped)) {
    results.push(swapped);
  }

  // Try suffix as a family prefix (e.g. "node-*" for suffix "node")
  const suffixPrefix = `${suffix}-`;
  // Try suffix as a component in other platforms (e.g. "*-hono" for suffix "hono")
  const suffixSuffix = `-${suffix}`;
  // Also match suffix as a middle component (e.g. "cloudflare" in "node-cloudflare-workers")
  const suffixMiddle = `-${suffix}-`;
  for (const p of VALID_PLATFORMS) {
    if (p.startsWith(suffixPrefix) && p !== swapped) {
      results.push(p);
    } else if (p.endsWith(suffixSuffix) && p !== invalid) {
      results.push(p);
    } else if (p.includes(suffixMiddle)) {
      results.push(p);
    }
  }

  return results;
}

function findFuzzyMatches(invalid: string): string[] {
  const threshold = Math.max(2, Math.floor(invalid.length / 3));
  const scored: { platform: string; dist: number }[] = [];
  for (const p of VALID_PLATFORMS) {
    const dist = levenshtein(invalid, p);
    if (dist <= threshold) {
      scored.push({ platform: p, dist });
    }
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.map((s) => s.platform);
}

/**
 * Suggest close matches for an invalid platform string.
 * Returns up to 15 suggestions sorted by relevance.
 */
export function suggestPlatform(invalid: string): string[] {
  const suggestions: string[] = [];

  for (const m of findSuffixMatches(invalid)) {
    addUnique(suggestions, m);
  }
  for (const m of findPrefixMatches(invalid)) {
    addUnique(suggestions, m);
  }
  for (const m of findSwapMatches(invalid)) {
    addUnique(suggestions, m);
  }

  if (suggestions.length === 0) {
    for (const m of findFuzzyMatches(invalid)) {
      addUnique(suggestions, m);
      // Also include family members (e.g. "node" → "node-express", "node-hono")
      for (const child of findPrefixMatches(m)) {
        addUnique(suggestions, child);
      }
    }
  }

  return suggestions.slice(0, 15);
}
