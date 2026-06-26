/**
 * Deterministic, keyword-driven Sentry docs lookup for the local init agent.
 *
 * The agent calls this repeatedly throughout its run (e.g. "nextjs install",
 * then "nextjs sourcemaps", then "react session replay privacy"); it maps
 * keywords to feature slugs, seeds candidate doc paths from the doctree, runs
 * substring search, fetches the top pages, and returns bounded Markdown with
 * source URLs for the agent to synthesize from. Ported from the retired
 * docs-mcp `get-docs-by-keywords` tool.
 */

import type { DocPageHit } from "./doctree.js";
import { libFeaturePath, libToPlatformPath, searchPages } from "./doctree.js";
import { buildDocsUrl, fetchDocPage, normalizeDocPath } from "./fetcher.js";

const DEFAULT_MAX_PAGES = 4;
const HARD_MAX_PAGES = 8;
const MAX_PAGE_CHARS = 16_000;
const MAX_SEARCH_HITS_PER_QUERY = 8;
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;
const TITLE_RE = /^title:\s*["']?(.+?)["']?\s*$/m;
const WHITESPACE_RE = /\s+/g;
const TOKEN_SPLIT_RE = /[^a-z0-9+.#-]+/g;
const TRAILING_SLASH_RE = /\/$/;
const HEADING_MARKER_RE = /^#\s+/;

const LIB_HINT_ALIASES: Record<string, string> = {
  "next.js": "nextjs",
  next: "nextjs",
  nextjs: "nextjs",
  react: "react",
  node: "node",
  "node.js": "node",
  django: "django",
  flask: "flask",
  fastapi: "fastapi",
  rails: "rails",
  ruby: "ruby",
  go: "go",
  flutter: "flutter",
  android: "android",
  ios: "ios",
};

const KEYWORD_ALIASES: Record<string, string> = {
  "error monitoring": "error-monitoring",
  errors: "error-monitoring",
  logging: "logs",
  logs: "logs",
  performance: "tracing",
  profiling: "profiling",
  replay: "session-replay",
  "session replay": "session-replay",
  "session replay privacy": "session-replay",
  "source maps": "source-maps",
  sourcemap: "source-maps",
  sourcemaps: "source-maps",
  tracing: "tracing",
};

export type DocsByKeywordsInput = {
  keywords: string[];
  libs?: string[];
  maxPages?: number;
  stackSummary?: string;
};

type FetchedDocPage = {
  content: string;
  path: string;
  title: string;
  url: string;
};

type CandidatePage = {
  path: string;
  rank: number;
};

function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(WHITESPACE_RE, " ");
}

function normalizeKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map(normalizeText).filter(Boolean))];
}

function normalizeLibs(libs: string[] | undefined): string[] {
  return [...new Set((libs ?? []).map(normalizeText).filter(Boolean))];
}

function libsWithKeywordHints(keywords: string[], libs: string[]): string[] {
  const resolved = new Set(libs);
  for (const keyword of keywords) {
    const tokens = keyword.split(TOKEN_SPLIT_RE).filter(Boolean);
    for (const token of tokens) {
      const lib = LIB_HINT_ALIASES[token];
      if (lib) {
        resolved.add(lib);
      }
    }
  }
  return [...resolved];
}

function clampMaxPages(maxPages: number | undefined): number {
  if (!maxPages || Number.isNaN(maxPages)) {
    return DEFAULT_MAX_PAGES;
  }
  return Math.min(Math.max(Math.floor(maxPages), 1), HARD_MAX_PAGES);
}

function keywordToFeature(keyword: string): string | null {
  if (KEYWORD_ALIASES[keyword]) {
    return KEYWORD_ALIASES[keyword];
  }
  for (const [alias, feature] of Object.entries(KEYWORD_ALIASES)) {
    if (keyword.includes(alias)) {
      return feature;
    }
  }
  return null;
}

function includesPrivacy(keywords: string[]): boolean {
  return keywords.some((keyword) => keyword.includes("privacy"));
}

function addCandidate(
  candidates: Map<string, CandidatePage>,
  path: string,
  rank: number
): void {
  const normalizedPath = normalizeDocPath(path);
  const existing = candidates.get(normalizedPath);
  if (!existing || rank > existing.rank) {
    candidates.set(normalizedPath, { path: normalizedPath, rank });
  }
}

function pathFromHit(hit: DocPageHit): string {
  return normalizeDocPath(hit.url);
}

function pathMatchesLib(path: string, libs: string[]): boolean {
  if (libs.length === 0) {
    return false;
  }
  const lowerPath = path.toLowerCase();
  return libs.some((lib) => {
    const platformPath = libToPlatformPath(lib);
    if (platformPath && lowerPath.startsWith(normalizeDocPath(platformPath))) {
      return true;
    }
    return lowerPath.includes(`/${lib.replace(WHITESPACE_RE, "-")}/`);
  });
}

function pathMatchesKeyword(path: string, keywords: string[]): boolean {
  const lowerPath = path.toLowerCase();
  return keywords.some((keyword) => {
    const feature = keywordToFeature(keyword);
    const pathKeyword = keyword.replace(WHITESPACE_RE, "-");
    return (
      lowerPath.includes(pathKeyword) ||
      (feature ? lowerPath.includes(feature) : false)
    );
  });
}

function rankSearchHit(hit: DocPageHit, keywords: string[], libs: string[]) {
  const path = pathFromHit(hit);
  let rank = 20;
  if (pathMatchesLib(path, libs)) {
    rank += 35;
  }
  if (pathMatchesKeyword(path, keywords)) {
    rank += 25;
  }
  if (hit.title) {
    const title = normalizeText(hit.title);
    for (const keyword of keywords) {
      if (title.includes(keyword)) {
        rank += 10;
      }
    }
  }
  return rank;
}

function directCandidates(keywords: string[], libs: string[]): CandidatePage[] {
  const candidates = new Map<string, CandidatePage>();
  const wantsPrivacy = includesPrivacy(keywords);

  for (const lib of libs) {
    const platformPath = libToPlatformPath(lib);
    if (platformPath) {
      addCandidate(candidates, platformPath, 50);
    }
    for (const keyword of keywords) {
      const feature = keywordToFeature(keyword);
      if (!feature) {
        continue;
      }
      const featurePath = libFeaturePath(lib, feature);
      if (!featurePath) {
        continue;
      }
      addCandidate(candidates, featurePath, 100);
      if (feature === "session-replay" && wantsPrivacy) {
        addCandidate(
          candidates,
          `${featurePath.replace(TRAILING_SLASH_RE, "")}/privacy/`,
          120
        );
      }
    }
  }

  return [...candidates.values()];
}

function searchQueries(
  keywords: string[],
  libs: string[],
  stackSummary?: string
): string[] {
  const queries = new Set<string>();

  for (const keyword of keywords) {
    queries.add(keyword);
    for (const token of keyword.split(TOKEN_SPLIT_RE)) {
      if (token.length > 2 && !LIB_HINT_ALIASES[token]) {
        queries.add(token);
      }
    }
    const feature = keywordToFeature(keyword);
    if (feature) {
      queries.add(feature);
    }
    for (const lib of libs) {
      queries.add(`${lib} ${keyword}`);
      if (feature) {
        queries.add(`${lib} ${feature}`);
      }
    }
  }

  if (stackSummary) {
    const stack = normalizeText(stackSummary);
    for (const keyword of keywords) {
      queries.add(`${stack} ${keyword}`);
    }
  }

  return [...queries].filter(Boolean).slice(0, 16);
}

async function discoverCandidates(
  keywords: string[],
  libs: string[],
  stackSummary: string | undefined,
  maxPages: number
): Promise<CandidatePage[]> {
  const candidates = new Map<string, CandidatePage>();

  for (const candidate of directCandidates(keywords, libs)) {
    addCandidate(candidates, candidate.path, candidate.rank);
  }

  const queries = searchQueries(keywords, libs, stackSummary);
  const searchResults = await Promise.all(
    queries.map(async (query) => {
      try {
        return await searchPages(query, MAX_SEARCH_HITS_PER_QUERY);
      } catch {
        return [];
      }
    })
  );

  for (const hits of searchResults) {
    for (const hit of hits) {
      addCandidate(
        candidates,
        pathFromHit(hit),
        rankSearchHit(hit, keywords, libs)
      );
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path))
    .slice(0, maxPages * 3);
}

function extractTitle(markdown: string, fallbackPath: string): string {
  const frontmatterTitle = markdown.match(TITLE_RE)?.[1]?.trim();
  if (frontmatterTitle) {
    return frontmatterTitle;
  }
  const heading = markdown
    .replace(FRONTMATTER_RE, "")
    .split("\n")
    .find((line) => line.startsWith("# "));
  return heading?.replace(HEADING_MARKER_RE, "").trim() || fallbackPath;
}

function sanitizeMarkdown(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, "").trim();
}

async function fetchCandidatePages(
  candidates: CandidatePage[],
  maxPages: number
): Promise<FetchedDocPage[]> {
  const pages: FetchedDocPage[] = [];

  for (const candidate of candidates) {
    if (pages.length >= maxPages) {
      break;
    }
    try {
      const content = await fetchDocPage(candidate.path);
      const cleanContent = sanitizeMarkdown(content);
      if (!cleanContent) {
        continue;
      }
      pages.push({
        content:
          cleanContent.length > MAX_PAGE_CHARS
            ? `${cleanContent.slice(0, MAX_PAGE_CHARS).trimEnd()}\n\n[... truncated, ${cleanContent.length - MAX_PAGE_CHARS} more chars ...]`
            : cleanContent,
        path: candidate.path,
        title: extractTitle(content, candidate.path),
        url: buildDocsUrl(candidate.path),
      });
    } catch {
      // Best-effort: a missing/failed page is skipped, others still return.
    }
  }

  return pages;
}

function formatLookupMarkdown(
  input: Required<Pick<DocsByKeywordsInput, "keywords">> &
    Pick<DocsByKeywordsInput, "libs" | "stackSummary">,
  pages: FetchedDocPage[]
): string {
  const lines = [
    "# Sentry Docs Lookup",
    "",
    `Keywords: ${input.keywords.join(", ")}`,
  ];

  if (input.libs && input.libs.length > 0) {
    lines.push(`Libraries: ${input.libs.join(", ")}`);
  }
  if (input.stackSummary) {
    lines.push(`Stack: ${input.stackSummary}`);
  }

  if (pages.length === 0) {
    lines.push(
      "",
      "No matching docs pages were found for this keyword lookup."
    );
    return lines.join("\n");
  }

  for (const page of pages) {
    lines.push(
      "",
      `## ${page.title}`,
      "",
      `Source: ${page.url}`,
      "",
      page.content
    );
  }

  lines.push("", "## Sources");
  for (const page of pages) {
    lines.push(`- ${page.url}`);
  }

  return lines.join("\n");
}

/** Look up Sentry docs by keywords and return bounded Markdown with sources. */
export async function getDocsByKeywords({
  keywords,
  libs,
  stackSummary,
  maxPages,
}: DocsByKeywordsInput): Promise<string> {
  const normalizedKeywords = normalizeKeywords(keywords);
  const normalizedLibs = libsWithKeywordHints(
    normalizedKeywords,
    normalizeLibs(libs)
  );
  const pageLimit = clampMaxPages(maxPages);

  if (normalizedKeywords.length === 0) {
    throw new Error("At least one non-empty keyword is required");
  }

  const candidates = await discoverCandidates(
    normalizedKeywords,
    normalizedLibs,
    stackSummary,
    pageLimit
  );
  const pages = await fetchCandidatePages(candidates, pageLimit);

  return formatLookupMarkdown(
    { keywords: normalizedKeywords, libs: normalizedLibs, stackSummary },
    pages
  );
}
