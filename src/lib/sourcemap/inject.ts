/**
 * Directory-level debug ID injection.
 *
 * Scans a directory for JavaScript files and their companion sourcemaps,
 * then injects Sentry debug IDs into each pair.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { NODE_MODULES_DIRNAME } from "../constants.js";
import { ValidationError } from "../errors.js";
import { walkFiles } from "../scan/index.js";
import { EXISTING_DEBUGID_RE, injectDebugId } from "./debug-id.js";

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

  const filePairs = await discoverFilePairs(dir, extensions);

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
 * Check if a path has a companion .map file.
 *
 * @returns The map path if the companion exists, undefined otherwise.
 */
async function findCompanionMap(jsPath: string): Promise<string | undefined> {
  const mapPath = `${jsPath}.map`;
  try {
    const mapStat = await stat(mapPath);
    if (mapStat.isFile()) {
      return mapPath;
    }
  } catch {
    // No companion .map file — skip
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
 * Read-only discovery pass — returns the list of JS + sourcemap pairs
 * without injecting debug IDs. Used as a pre-check by the upload
 * command so the directory isn't mutated when the upload won't
 * proceed (empty dir, missing credentials, etc.).
 */
export async function discoverFilePairs(
  dir: string,
  extensions: Set<string> = DEFAULT_EXTENSIONS
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
    const mapPath = await findCompanionMap(entry.absolutePath);
    if (mapPath) {
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
