/**
 * Directory-level debug ID injection.
 *
 * Scans a directory for JavaScript files and their companion sourcemaps,
 * then injects Sentry debug IDs into each pair.
 */

import { open, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve as resolvePath, sep } from "node:path";
import ignore from "ignore";
import { NODE_MODULES_DIRNAME } from "../constants.js";
import { ValidationError } from "../errors.js";
import { logger } from "../logger.js";
import { walkFiles } from "../scan/index.js";
import { EXISTING_DEBUGID_RE, injectDebugId } from "./debug-id.js";

const log = logger.withTag("sourcemap.inject");

/** Default JavaScript file extensions to scan. */
const DEFAULT_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);

/** Result of injecting a single file pair. */
export type InjectResult = {
  /** Path to the JavaScript file. */
  jsPath: string;
  /** Path to the companion sourcemap. */
  mapPath: string;
  /** Whether debug IDs were injected (false if already present or skipped). */
  injected: boolean;
  /** The debug ID (injected or pre-existing). */
  debugId: string;
};

/** Options for directory-level injection. */
export type InjectDirectoryOptions = {
  /** File extensions to process (default: .js, .cjs, .mjs). */
  extensions?: string[];
  /** If true, report what would be modified without writing. */
  dryRun?: boolean;
  /** Glob patterns (gitignore-style) to exclude from processing. */
  ignorePatterns?: string[];
  /** Pre-built ignore matcher (takes precedence over ignorePatterns). */
  ignoreMatcher?: ReturnType<typeof ignore>;
};

/**
 * Scan a directory for JS + sourcemap pairs and inject debug IDs.
 *
 * Recursively discovers `.js`/`.mjs`/`.cjs` files, checks for a
 * companion `.map` file, and injects debug IDs into each pair.
 *
 * @param dir - Directory to scan
 * @param options - Scanning options
 * @returns Array of results (one per file pair found)
 */
export async function injectDirectory(
  dir: string,
  options: InjectDirectoryOptions = {}
): Promise<InjectResult[]> {
  const extensions = options.extensions
    ? new Set(options.extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)))
    : DEFAULT_EXTENSIONS;

  const ig =
    options.ignoreMatcher ?? (await buildIgnoreMatcher(options.ignorePatterns));
  const filePairs = await discoverFilePairs(dir, extensions, ig);

  const results: InjectResult[] = [];
  for (const { jsPath, mapPath } of filePairs) {
    if (options.dryRun) {
      // Check if file already has a debug ID without modifying it
      const js = await readFile(jsPath, "utf-8");
      const existing = js.match(EXISTING_DEBUGID_RE);
      const wouldInject = !existing;
      const id = existing?.[1] ?? "(pending)";
      results.push({ jsPath, mapPath, injected: wouldInject, debugId: id });
      continue;
    }
    const { debugId, wasInjected } = await injectDebugId(jsPath, mapPath);
    results.push({ jsPath, mapPath, injected: wasInjected, debugId });
  }
  return results;
}

/** A discovered JS + sourcemap pair. */
export type FilePair = { jsPath: string; mapPath: string };

/**
 * Regex matching `//# sourceMappingURL=<url>` or `//@ sourceMappingURL=<url>`.
 *
 * Uses global + multiline flags so we can iterate all matches and take the
 * **last** one — the source map spec says the last directive is authoritative.
 * Concatenated bundles or string literals in the file tail may produce earlier
 * false positives; only the final match matters.
 */
const SOURCE_MAPPING_URL_RE = /\/\/[#@]\s*sourceMappingURL\s*=\s*(\S+)\s*$/gm;

/**
 * Matches a `sourceMappingURL` that points at a remote `http(s)://` location
 * (as opposed to an inline `data:` URL or a local companion path).
 */
const REMOTE_SOURCE_MAPPING_URL_RE = /^https?:\/\//i;

/**
 * Read the last ~512 bytes of a file efficiently.
 *
 * We only need the very end of the JS file to find the
 * `sourceMappingURL` directive. Reading just the tail avoids
 * loading multi-megabyte bundles into memory.
 */
async function readFileTail(filePath: string, maxBytes = 512): Promise<string> {
  const fh = await open(filePath, "r");
  try {
    const fstat = await fh.stat();
    const fileSize = fstat.size;
    if (fileSize === 0) {
      return "";
    }
    const readSize = Math.min(maxBytes, fileSize);
    const offset = fileSize - readSize;
    const buf = Buffer.alloc(readSize);
    await fh.read(buf, 0, readSize, offset);
    return buf.toString("utf-8");
  } finally {
    await fh.close();
  }
}

/**
 * Extract the **last** `sourceMappingURL` value from the tail of a JS file.
 *
 * The source map spec says the last directive is authoritative. Concatenated
 * bundles may have multiple directives; we iterate all matches and return
 * the final one.
 *
 * Returns `undefined` if no directive is found.
 */
async function extractSourceMappingUrl(
  jsPath: string
): Promise<string | undefined> {
  try {
    const tail = await readFileTail(jsPath);
    let lastUrl: string | undefined;
    for (const match of tail.matchAll(SOURCE_MAPPING_URL_RE)) {
      lastUrl = match[1];
    }
    return lastUrl;
  } catch {
    return;
  }
}

/**
 * Check if a file exists and is a regular file.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Find the companion sourcemap for a JS file.
 *
 * Resolution order:
 * 1. Convention: `<jsPath>.map` on disk
 * 2. `//# sourceMappingURL=<relative-path>` directive in the JS file
 *    (only external file references — `data:` URLs are logged and skipped)
 *
 * @returns The map path if a companion exists, undefined otherwise.
 */
async function findCompanionMap(jsPath: string): Promise<string | undefined> {
  // Fast path: convention-based naming (most bundlers use this)
  const conventionPath = `${jsPath}.map`;
  if (await fileExists(conventionPath)) {
    return conventionPath;
  }

  // Slow path: parse sourceMappingURL from the file tail
  const url = await extractSourceMappingUrl(jsPath);
  if (!url) {
    return;
  }

  // Skip data: URLs (inline sourcemaps) — we can't inject debug IDs
  // into inline sourcemaps without re-encoding the entire base64 blob
  // back into the JS file. Log and move on.
  if (url.startsWith("data:")) {
    log.debug(
      `skipping inline sourcemap in ${jsPath} (data: URL not supported for injection)`
    );
    return;
  }

  // Skip absolute URLs (http/https) — can't inject into remote maps
  if (url.startsWith("http://") || url.startsWith("https://")) {
    log.debug(`skipping remote sourcemap URL in ${jsPath}: ${url}`);
    return;
  }

  // Strip query strings and fragments (e.g. "app.js.map?v=abc123")
  // that bundlers like Vite/Rollup may append. indexOf returns -1 when
  // no delimiter is found, and slice(0, -1) would chop the last char —
  // so only slice when the delimiter actually exists.
  let cleanUrl = url;
  const qIdx = cleanUrl.indexOf("?");
  if (qIdx !== -1) {
    cleanUrl = cleanUrl.slice(0, qIdx);
  }
  const hIdx = cleanUrl.indexOf("#");
  if (hIdx !== -1) {
    cleanUrl = cleanUrl.slice(0, hIdx);
  }

  // Resolve relative path against the JS file's directory
  const jsDir = dirname(jsPath);
  const resolvedMapPath = resolvePath(jsDir, cleanUrl);
  if (await fileExists(resolvedMapPath)) {
    return resolvedMapPath;
  }

  return;
}

/**
 * Recursively discover JS files with companion .map files.
 *
 * Uses the shared `walkFiles` engine from `src/lib/scan/` for
 * directory traversal. Sourcemap injection targets build output
 * directories — so we:
 *
 * - Disable `respectGitignore` (build outputs like `dist/` are
 *   typically gitignored; the walker would otherwise prune them).
 * - Skip dotfiles + `node_modules` only (via `SOURCEMAP_SKIP_DIRS`);
 *   the walker's `DEFAULT_SKIP_DIRS` is too broad — it prunes
 *   `dist`/`build`/`.next` etc., which are exactly the dirs users
 *   want to scan into.
 * - Disable the `maxFileSize` cap. The walker defaults to 256 KB,
 *   but webpack / rollup / Next.js bundles routinely exceed that.
 *   The old hand-rolled `readdir` loop had no size limit; silently
 *   dropping large JS files would skip debug-ID injection on the
 *   exact bundles users care about most.
 */
const SOURCEMAP_SKIP_DIRS: readonly string[] = [NODE_MODULES_DIRNAME];

/**
 * Build an `ignore` matcher from user-provided patterns and/or an
 * ignore-file path. Returns `undefined` when no patterns are active.
 */
export async function buildIgnoreMatcher(
  patterns?: string[],
  ignoreFilePath?: string
): Promise<ReturnType<typeof ignore> | undefined> {
  const hasPatterns = patterns && patterns.length > 0;
  if (!(hasPatterns || ignoreFilePath)) {
    return;
  }
  const ig = ignore();
  if (hasPatterns) {
    ig.add(patterns);
  }
  if (ignoreFilePath) {
    try {
      const content = await readFile(ignoreFilePath, "utf-8");
      ig.add(content);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new ValidationError(
          `Ignore file '${ignoreFilePath}' does not exist.`,
          "ignore-file"
        );
      }
      throw err;
    }
  }
  return ig;
}

/**
 * Read-only discovery pass — returns the list of JS + sourcemap pairs
 * without injecting debug IDs. Used as a pre-check by the upload
 * command so the directory isn't mutated when the upload won't
 * proceed (empty dir, missing credentials, etc.).
 */
export async function discoverFilePairs(
  dir: string,
  extensions: Set<string> = DEFAULT_EXTENSIONS,
  ignoreMatcher?: ReturnType<typeof ignore>
): Promise<FilePair[]> {
  // `walkFiles` requires an absolute cwd. CLI callers pass
  // user-supplied positional args like `./dist` directly through to
  // `injectDirectory`, so we resolve here rather than push the
  // requirement up to every caller.
  const absDir = resolvePath(dir);
  const pairs: FilePair[] = [];
  for await (const entry of walkFiles({
    cwd: absDir,
    extensions,
    alwaysSkipDirs: SOURCEMAP_SKIP_DIRS,
    hidden: false,
    respectGitignore: false,
    maxFileSize: Number.POSITIVE_INFINITY,
  })) {
    if (ignoreMatcher) {
      // Use POSIX relative path for gitignore-style matching
      const rel = relative(absDir, entry.absolutePath).replaceAll("\\", "/");
      if (ignoreMatcher.ignores(rel)) {
        continue;
      }
    }
    const mapPath = await findCompanionMap(entry.absolutePath);
    if (mapPath) {
      // Guard against sourceMappingURL directives that resolve outside the
      // upload directory (e.g. "../../other/app.js.map"). Convention-based
      // maps (foo.js.map) are always adjacent so they're inherently safe.
      // Trailing separator prevents prefix collisions (e.g. /dist vs /dist-backup).
      // Use path.sep for Windows compatibility (backslash separators).
      const dirPrefix = absDir.endsWith(sep) ? absDir : `${absDir}${sep}`;
      if (!mapPath.startsWith(dirPrefix)) {
        log.debug(
          `skipping sourcemap outside directory: ${mapPath} (resolved from ${entry.absolutePath})`
        );
        continue;
      }
      pairs.push({ jsPath: entry.absolutePath, mapPath });
    }
  }
  return pairs;
}

/**
 * Throw {@link ValidationError} if `dir` doesn't exist or isn't a
 * readable directory. Distinct messages per failure mode so the user
 * gets a useful pointer instead of "no sourcemaps found".
 */
export async function assertDirectoryReadable(dir: string): Promise<void> {
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) {
      throw new ValidationError(
        `Path '${dir}' is not a directory.`,
        "directory"
      );
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      throw err;
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ValidationError(
        `Directory '${dir}' does not exist.`,
        "directory"
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(
      `Cannot read directory '${dir}': ${msg}`,
      "directory"
    );
  }
}

/**
 * Counts of JS and `.map` files in a directory, used by
 * {@link buildEmptyDiscoveryError} to tailor the zero-pairs error.
 */
export type DiscoveryDiagnostic = {
  jsFiles: number;
  mapFiles: number;
};

/**
 * Count JS and `.map` files in a single walker pass. Only called on
 * the zero-pairs error path.
 */
export async function diagnoseEmptyDiscovery(
  dir: string,
  options: InjectDirectoryOptions = {}
): Promise<DiscoveryDiagnostic> {
  // Build one set covering JS extensions + `.map` so the walker visits
  // both in a single pass.
  const extensions = options.extensions
    ? new Set(options.extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)))
    : new Set(DEFAULT_EXTENSIONS);
  extensions.add(".map");

  const absDir = resolvePath(dir);
  let jsFiles = 0;
  let mapFiles = 0;
  for await (const entry of walkFiles({
    cwd: absDir,
    extensions,
    alwaysSkipDirs: SOURCEMAP_SKIP_DIRS,
    hidden: false,
    respectGitignore: false,
    maxFileSize: Number.POSITIVE_INFINITY,
  })) {
    if (entry.absolutePath.endsWith(".map")) {
      mapFiles += 1;
    } else {
      jsFiles += 1;
    }
  }
  return { jsFiles, mapFiles };
}

/**
 * Read-only resolution result for a single JavaScript file, produced by
 * {@link resolveDirectorySourcemaps}. Mirrors the legacy `sentry-cli
 * sourcemaps resolve` diagnostic output without mutating any files.
 */
export type SourcemapResolution = {
  /** Absolute path to the JavaScript file. */
  jsPath: string;
  /**
   * Absolute path to the resolved companion sourcemap, or `undefined`
   * when no external `.map` file could be located on disk.
   */
  mapPath?: string;
  /**
   * Raw value of the last `//# sourceMappingURL=` directive in the file,
   * or `undefined` when no directive is present.
   */
  sourceMappingUrl?: string;
  /**
   * True when the `sourceMappingURL` is an inline `data:` URL (embedded
   * base64 sourcemap) rather than an external file reference.
   */
  inline: boolean;
  /**
   * True when the `sourceMappingURL` is a remote `http(s)://` reference.
   */
  remote: boolean;
  /**
   * The embedded `//# debugId=<uuid>` value, or `undefined` when the
   * file has not been injected yet.
   */
  debugId?: string;
};

/**
 * Byte-wise (code-unit) comparison of two strings for `Array.prototype.sort`.
 *
 * Used to order discovered paths deterministically without the locale-dependent
 * (and slower) `localeCompare`. Returns a negative, zero, or positive number.
 *
 * @param a - First string
 * @param b - Second string
 * @returns `-1` if `a < b`, `1` if `a > b`, `0` if equal
 */
function compareByteWise(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Read-only diagnostic pass over a build directory.
 *
 * For every discovered JavaScript file this reports how its sourcemap
 * resolves (convention `<name>.map`, an external `sourceMappingURL`
 * directive, an inline `data:` URL, or none) and whether a Sentry debug
 * ID has been injected. Unlike {@link discoverFilePairs}, files **without**
 * a companion map are still included so the user can see what is missing.
 *
 * Never mutates files — this powers `sentry sourcemap resolve`.
 *
 * @param dir - Directory to scan (resolved to an absolute path internally)
 * @param extensions - JS extensions to consider
 * @param ignoreMatcher - Optional gitignore-style matcher
 * @returns One {@link SourcemapResolution} per JS file, sorted by path
 */
export async function resolveDirectorySourcemaps(
  dir: string,
  extensions: Set<string> = DEFAULT_EXTENSIONS,
  ignoreMatcher?: ReturnType<typeof ignore>
): Promise<SourcemapResolution[]> {
  const absDir = resolvePath(dir);
  const results: SourcemapResolution[] = [];
  for await (const entry of walkFiles({
    cwd: absDir,
    extensions,
    alwaysSkipDirs: SOURCEMAP_SKIP_DIRS,
    hidden: false,
    respectGitignore: false,
    maxFileSize: Number.POSITIVE_INFINITY,
  })) {
    const jsPath = entry.absolutePath;
    if (ignoreMatcher) {
      const rel = relative(absDir, jsPath).replaceAll("\\", "/");
      if (ignoreMatcher.ignores(rel)) {
        continue;
      }
    }

    const sourceMappingUrl = await extractSourceMappingUrl(jsPath);
    const inline = sourceMappingUrl?.startsWith("data:") ?? false;
    const remote =
      !!sourceMappingUrl && REMOTE_SOURCE_MAPPING_URL_RE.test(sourceMappingUrl);
    const mapPath = await findCompanionMap(jsPath);

    let debugId: string | undefined;
    try {
      const js = await readFile(jsPath, "utf-8");
      debugId = js.match(EXISTING_DEBUGID_RE)?.[1];
    } catch (err) {
      log.debug(`failed to read JS file for debug ID: ${jsPath}`, err);
    }

    results.push({
      jsPath,
      mapPath,
      sourceMappingUrl,
      inline,
      remote,
      debugId,
    });
  }

  // Byte-wise comparison is sufficient and stable for filesystem paths; the
  // locale-aware `localeCompare` is unnecessary (and slower) here. Matches the
  // plain `.sort()` used for paths in `upload.ts`.
  results.sort((a, b) => compareByteWise(a.jsPath, b.jsPath));
  return results;
}

/**
 * Build an actionable error for the zero-pairs case, tailored to
 * which side of the JS/map pairing is missing.
 */
export function buildEmptyDiscoveryError(
  dir: string,
  diag: DiscoveryDiagnostic
): ValidationError {
  const { jsFiles, mapFiles } = diag;
  if (jsFiles === 0 && mapFiles === 0) {
    return new ValidationError(
      `Directory '${dir}' contains no JS or sourcemap files. ` +
        "Check the path points at your build output, or pass " +
        "--allow-empty to suppress this error.",
      "directory"
    );
  }
  if (jsFiles > 0 && mapFiles === 0) {
    return new ValidationError(
      `Found ${jsFiles} JS file(s) in '${dir}' but no companion .map ` +
        "files. Your bundler is not emitting sourcemaps. For Vite/Astro: " +
        "`vite.environments.client.build.sourcemap: 'hidden'`. For webpack: " +
        "`devtool: 'hidden-source-map'`. Pass --allow-empty to suppress.",
      "directory"
    );
  }
  if (mapFiles > 0 && jsFiles === 0) {
    return new ValidationError(
      `Found ${mapFiles} .map file(s) in '${dir}' but no companion JS ` +
        "files. Ensure your build emits both JS and maps to the same " +
        "directory. Pass --allow-empty to suppress.",
      "directory"
    );
  }
  return new ValidationError(
    `Found ${jsFiles} JS and ${mapFiles} .map file(s) in '${dir}' but ` +
      "no JS file has a matching `<name>.map` companion. Check that your " +
      "bundler emits JS and sourcemaps with matching basenames. Pass " +
      "--allow-empty to suppress.",
    "directory"
  );
}
