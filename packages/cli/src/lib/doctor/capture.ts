/**
 * Stage 1: the filesystem, reduced to the facts checks need.
 *
 * One grep pass finds every file that mentions Sentry at all; classification
 * happens in our own code afterwards, because `include` globs would constrain
 * the whole pass and `GrepMatch` carries the matching line rather than the
 * file, so a bounded re-read is required either way.
 */

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { SENTRY_CLI_DSN } from "../constants.js";
import { createDetectedDsn, detectAllDsns, parseDsn } from "../dsn/index.js";
import { logger } from "../logger.js";
import { collectGlob, collectGrep } from "../scan/index.js";
import {
  captureBlock,
  extractKeys,
  gradlePlaceholderValues,
  resolveGradlePlaceholders,
} from "./capture-block.js";
import { isManifest, parseManifest } from "./manifests.js";
import {
  BUILD_MARKERS,
  INIT_MARKERS,
  type MarkerRule,
  markersForFile,
} from "./markers.js";
import { redactConfigText } from "./redact.js";
import type { Capture, CapturedBlock, ParsedManifest } from "./types.js";

export type CaptureOptions = {
  /** Wall-clock budget for the discovery walk. Default 1500ms (spec). */
  timeBudgetMs?: number;
  /** Cap on files re-read after the grep pass. Default 200. */
  maxFiles?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
};

/** Mutable accumulator populated during the classification phase. */
type CaptureAccumulator = {
  ecosystems: Set<string>;
  initSites: CapturedBlock[];
  buildConfigs: CapturedBlock[];
  manifests: Record<string, ParsedManifest>;
  placeholders: Map<string, Set<string>>;
};

const DEFAULT_TIME_BUDGET_MS = 1500;
const DEFAULT_MAX_FILES = 200;
const MAX_GREP_RESULTS = 5000;
const MAX_FILE_BYTES = 512 * 1024;

/** Broad enough to catch every marker table entry in a single pass. */
const SENTRY_PATTERN = /sentry/i;

/** Auto-init config files, even when gitignored. Not every xml/json. */
const CONFIG_FILE_GLOBS = [
  "AndroidManifest.xml",
  "application.properties",
  "application.yml",
  "application.yaml",
  "application-*.properties",
  "application-*.yml",
  "application-*.yaml",
  "appsettings.json",
  "appsettings.*.json",
  "sentry.php",
  "sentry.properties",
];

/** Basename extension to ecosystem, for files that identify a stack by existing. */
const ECOSYSTEM_BY_EXTENSION: readonly [RegExp, string][] = [
  [/\.(?:[cm]?[jt]sx?)$/, "javascript"],
  [/\.py$/, "python"],
  [/\.rb$/, "ruby"],
  [/\.php$/, "php"],
  [/\.go$/, "go"],
  [/\.(?:java|kt)$/, "java"],
  [/\.cs$/, "dotnet"],
  [/\.(?:swift|m)$/, "apple"],
  [/\.dart$/, "dart"],
  [/\.rs$/, "rust"],
];

function mergePlaceholderTable(
  into: Map<string, Set<string>>,
  from: Map<string, Set<string>>
): void {
  for (const [name, values] of from) {
    const set = into.get(name) ?? new Set<string>();
    for (const value of values) {
      set.add(value);
    }
    into.set(name, set);
  }
}

function ecosystemFor(path: string): string | undefined {
  for (const [pattern, ecosystem] of ECOSYSTEM_BY_EXTENSION) {
    if (pattern.test(path)) {
      return ecosystem;
    }
  }
  return;
}

/** Apply one marker rule to file content, producing a redacted block. */
function applyRule(
  rule: MarkerRule,
  relPath: string,
  content: string
): CapturedBlock | null {
  const span = captureBlock(content, rule.marker, rule.delims);
  if (!span) {
    return null;
  }

  const text = redactConfigText(span.text);
  return {
    kind: rule.kind,
    file: relPath,
    line: span.line,
    text,
    keys: extractKeys(text),
  };
}

/** Collect blocks matching `rules` from file content into `acc`. */
function collectBlocks(
  rules: readonly MarkerRule[],
  relPath: string,
  content: string,
  acc: CaptureAccumulator
): void {
  const base = basename(relPath);
  const target = rules === INIT_MARKERS ? acc.initSites : acc.buildConfigs;

  for (const rule of markersForFile(rules, base)) {
    const block = applyRule(rule, relPath, content);
    if (block) {
      acc.ecosystems.add(rule.ecosystem);
      target.push(block);
    }
  }
}

/** Run the grep pass and return deduplicated file paths. */
async function discoverCandidates(
  cwd: string,
  timeBudgetMs: number
): Promise<{ candidates: string[]; incomplete?: string }> {
  try {
    const { matches, stats } = await collectGrep({
      cwd,
      pattern: SENTRY_PATTERN,
      caseSensitive: false,
      minDepth: 3,
      maxResults: MAX_GREP_RESULTS,
      maxMatchesPerFile: 1,
      maxFileSize: MAX_FILE_BYTES,
      timeBudgetMs,
    });

    const candidates = [...new Set(matches.map((m) => m.path))];
    const { files: configFiles } = await collectGlob({
      cwd,
      patterns: CONFIG_FILE_GLOBS,
      respectGitignore: false,
      timeBudgetMs,
      maxResults: DEFAULT_MAX_FILES,
    });
    for (const file of configFiles) {
      if (!candidates.includes(file)) {
        candidates.push(file);
      }
    }
    const incomplete = stats.truncated
      ? `Search stopped after ${MAX_GREP_RESULTS} matches; some files were not read.`
      : undefined;

    return { candidates, incomplete };
  } catch (error) {
    logger.debug("doctor: discovery walk failed", error);
    return {
      candidates: [],
      incomplete: "Project search failed; results are partial.",
    };
  }
}

/** Read one file, classify it, and populate the accumulator. */
async function classifyFile(
  cwd: string,
  relPath: string,
  acc: CaptureAccumulator
): Promise<void> {
  let content: string;
  try {
    content = await readFile(join(cwd, relPath), "utf-8");
  } catch (error) {
    logger.debug(`doctor: could not read ${relPath}`, error);
    return;
  }

  const ecosystem = ecosystemFor(relPath);
  if (ecosystem) {
    acc.ecosystems.add(ecosystem);
  }

  collectBlocks(INIT_MARKERS, relPath, content, acc);
  collectBlocks(BUILD_MARKERS, relPath, content, acc);

  const base = basename(relPath);
  if (/^build\.gradle(?:\.kts)?$/.test(base)) {
    mergePlaceholderTable(acc.placeholders, gradlePlaceholderValues(content));
  }
  if (isManifest(base)) {
    const parsed = parseManifest(relPath, content);
    if (parsed) {
      acc.manifests[relPath] = parsed;
    }
  }
}

export async function capture(
  cwd: string,
  opts: CaptureOptions = {}
): Promise<Capture> {
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const now = opts.now ?? (() => Date.now());

  const acc: CaptureAccumulator = {
    ecosystems: new Set<string>(),
    initSites: [],
    buildConfigs: [],
    manifests: {},
    placeholders: new Map(),
  };
  let incomplete: string | undefined;

  const started = now();
  const discovery = await discoverCandidates(cwd, timeBudgetMs);
  let { candidates } = discovery;
  incomplete = discovery.incomplete;

  // `GrepStats.truncated` covers maxResults and stopOnFirst only (see
  // src/lib/scan/types.ts:379). Budget exhaustion is invisible there, so it
  // has to be measured from the outside.
  if (!incomplete && now() - started >= timeBudgetMs) {
    incomplete = `Project search hit its ${timeBudgetMs}ms budget; some files were not read.`;
  }

  if (candidates.length > maxFiles) {
    incomplete ??= `Read the first ${maxFiles} of ${candidates.length} matching files.`;
    candidates = candidates.slice(0, maxFiles);
  }

  for (const relPath of candidates) {
    await classifyFile(cwd, relPath, acc);
  }

  if (acc.placeholders.size > 0) {
    for (const site of acc.initSites) {
      resolveGradlePlaceholders(site.keys, acc.placeholders);
    }
  }

  let dsns: Capture["dsns"] = [];
  try {
    // The CLI's own DSN lives in this repo's source; sending a probe there
    // looks like a successful write to a project the user cannot open.
    const cliKey = parseDsn(SENTRY_CLI_DSN)?.publicKey;
    dsns = (await detectAllDsns(cwd)).all.filter((d) => d.publicKey !== cliKey);
    const seen = new Set(dsns.map((d) => d.raw));
    for (const site of acc.initSites) {
      const raw = site.keys.dsn?.value;
      if (!raw || site.keys.dsn?.dynamic || seen.has(raw)) {
        continue;
      }
      const extra = createDetectedDsn(raw, "code", site.file);
      if (extra && extra.publicKey !== cliKey) {
        dsns.push(extra);
        seen.add(raw);
      }
    }
  } catch (error) {
    logger.debug("doctor: DSN detection failed", error);
    incomplete ??= "DSN detection failed; DSN checks were skipped.";
  }

  return {
    cwd,
    ecosystems: [...acc.ecosystems].sort(),
    dsns,
    initSites: acc.initSites,
    buildConfigs: acc.buildConfigs,
    manifests: acc.manifests,
    incomplete,
  };
}
