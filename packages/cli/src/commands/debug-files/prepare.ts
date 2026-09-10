/**
 * sentry debug-files prepare <path>...
 *
 * Scan for WebAssembly modules, split the ones carrying inline DWARF into a
 * deployable module plus a `*.debug.wasm` companion, and upload the companions
 * to Sentry.
 *
 * This replaces the two-step `wasm-split` + `debug-files upload` workflow. The
 * split matches what Symbolicator's `wasm-split` produces, so companions from
 * either tool are interchangeable in Sentry.
 *
 * Modules that cannot be split are stamped with a `build_id` and reported with
 * a warning rather than failing the run, so scanning a build directory does not
 * stop at the first module without DWARF. Use `--require-dwarf` in CI to turn
 * that into an error.
 */

import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import type { SentryContext } from "../../context.js";
import {
  type ChunkServerOptions,
  getChunkUploadOptions,
} from "../../lib/api/chunk-upload.js";
import {
  DEBUG_FILES_MAX_WAIT_MS,
  type DebugFileUpload,
  uploadDebugFiles,
} from "../../lib/api/debug-files.js";
import { buildCommand } from "../../lib/command.js";
import { createSourceBundle } from "../../lib/dif/index.js";
import { scanPaths } from "../../lib/dif/scan.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import {
  colorTag,
  escapeMarkdownInline,
  renderInlineMarkdown,
} from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import {
  type CompiledMatcher,
  compileMatchers,
  matchesAny,
} from "../../lib/scan/path-utils.js";
import {
  type DebugQuality,
  debugIdFromBuildId,
  hasDwarfQuality,
  isDebugCompanionPath,
  isWasmPath,
  type PrepareAction,
  type PrepareResult,
  prepareWasmFile,
  uploadPath,
  uuidToBytes,
} from "../../lib/wasm/prepare.js";

const log = logger.withTag("debug-files.prepare");

const USAGE_HINT = "sentry debug-files prepare <path>...";

/** Structured result for the prepare command. */
export type PrepareCommandResult = {
  /** Organization slug. Omitted when nothing was uploaded. */
  org?: string;
  /** Project slug. Omitted when nothing was uploaded. */
  project?: string;
  /** Whether companions were actually uploaded. */
  uploaded: boolean;
  /** Per-module outcome. */
  modules: PrepareResult[];
  /** Number of companions uploaded. */
  filesUploaded: number;
};

/** Flags accepted by the prepare command. */
type PrepareFlags = {
  "dry-run"?: boolean;
  "no-upload"?: boolean;
  "require-dwarf"?: boolean;
  "out-dir"?: string;
  "strip-names"?: boolean;
  "build-id"?: string;
  "include-sources"?: boolean;
  ignore?: string[];
  "ignore-file"?: string;
  wait?: boolean;
  "wait-for"?: number;
};

/** Header verb for each action, matching the legacy CLI's `print_result`. */
const ACTION_HEADERS: Record<PrepareAction, string> = {
  split: "Split",
  "would-split": "Would split",
  "already-prepared": "Already prepared",
  skipped: "Skipping",
};

/**
 * Quality labels as the legacy CLI prints them.
 *
 * Human output keeps the legacy snake_case spelling so existing docs and CI log
 * greps still match; the JSON payload keeps the kebab-case {@link DebugQuality}
 * values untouched.
 */
const QUALITY_LABELS: Record<DebugQuality, string> = {
  dwarf: "dwarf",
  "external-debug-info": "external_debug_info",
  symtab: "symtab",
  none: "none",
};

/** Indent applied to a module's detail lines, matching the legacy CLI. */
const DETAIL_INDENT = "    ";

/**
 * Render a single output line, then indent it.
 *
 * Each line goes through inline rendering only — color tags become ANSI in a
 * terminal and are stripped in plain mode — and the indent is applied after
 * rendering. Handing markdown a block that starts with four spaces would parse
 * it as an indented code block, which escapes the text and drops the colors.
 */
function renderLine(markdown: string, indent = ""): string {
  return indent + renderInlineMarkdown(markdown);
}

/** The dim `>` that opens every top-level line. */
function bullet(): string {
  return colorTag("muted", ">");
}

/**
 * Format one module as an indented block, mirroring the legacy CLI's layout.
 *
 * Paths are printed in full rather than as basenames: a build tree routinely
 * holds several same-named modules, so the basename alone is ambiguous.
 * Warnings are yellow so they stand out from the surrounding detail lines.
 */
export function formatPrepareModuleBlock(module: PrepareResult): string {
  const lines = [
    renderLine(
      `${bullet()} ${ACTION_HEADERS[module.action]} ${escapeMarkdownInline(module.path)}`
    ),
    renderLine(
      `Debug quality: ${QUALITY_LABELS[module.quality]}`,
      DETAIL_INDENT
    ),
  ];
  if (module.buildId) {
    lines.push(renderLine(`Build ID: ${module.buildId}`, DETAIL_INDENT));
  }
  if (module.companion) {
    lines.push(
      renderLine(
        `Companion: ${escapeMarkdownInline(module.companion)}`,
        DETAIL_INDENT
      )
    );
  }
  if (module.warning) {
    lines.push(
      renderLine(
        `${colorTag("yellow", "Warning")}: ${escapeMarkdownInline(module.warning)}`,
        DETAIL_INDENT
      )
    );
  }
  return lines.join("\n");
}

/**
 * Format the counts that open the report.
 *
 * Deliberately short: per-module facts belong in the blocks below, so this only
 * states how much was scanned and, when relevant, how much was uploaded.
 */
function formatPrepareSummary(data: PrepareCommandResult): string {
  const scanned = data.modules.length;
  const lines = [
    renderLine(
      `${bullet()} Found ${scanned} ${scanned === 1 ? "wasm file" : "wasm files"}`
    ),
  ];
  if (data.uploaded) {
    const uploaded = data.filesUploaded;
    const target =
      data.org && data.project ? ` to ${data.org}/${data.project}` : "";
    lines.push(
      renderLine(
        `${bullet()} Uploaded ${uploaded} ${uploaded === 1 ? "companion" : "companions"}${target}`
      )
    );
  }
  return lines.join("\n");
}

/** Format human-readable output for the prepare result. */
export function formatPrepareResult(data: PrepareCommandResult): string {
  return [
    formatPrepareSummary(data),
    ...data.modules.map(formatPrepareModuleBlock),
  ].join("\n\n");
}

/**
 * Resolve the wait mode and deadline from `--wait` / `--wait-for`.
 *
 * @throws {ValidationError} If both flags are set, or `--wait-for` is invalid.
 */
function resolveWaitMode(flags: PrepareFlags): {
  wait: boolean;
  maxWaitMs: number;
} {
  const waitFor = flags["wait-for"];
  if (flags.wait && waitFor !== undefined) {
    throw new ValidationError(
      "--wait and --wait-for cannot be combined",
      "wait"
    );
  }
  if (waitFor !== undefined) {
    if (!Number.isFinite(waitFor) || waitFor <= 0) {
      throw new ValidationError(
        "--wait-for must be a positive number of seconds",
        "wait-for"
      );
    }
    return { wait: true, maxWaitMs: Math.round(waitFor * 1000) };
  }
  return { wait: Boolean(flags.wait), maxWaitMs: DEBUG_FILES_MAX_WAIT_MS };
}

/**
 * Parse the explicit `--build-id` value into raw bytes.
 *
 * @throws {ValidationError} If the value is not a UUID.
 */
function resolveBuildId(value: string | undefined): Uint8Array | undefined {
  if (value === undefined) {
    return;
  }
  const bytes = uuidToBytes(value);
  if (!bytes) {
    throw new ValidationError(
      `--build-id must be a UUID, got '${value}'`,
      "build-id"
    );
  }
  return bytes;
}

/**
 * Whether a module fails the `--require-dwarf` gate.
 *
 * Only skipped modules can fail: a split or already-prepared module reached the
 * end state the flag is checking for. A skipped module still counts as having
 * DWARF when it points at an external companion, so a dangling
 * `external_debug_info` pointer does not fail a build over missing debug info
 * it was, in fact, built with.
 */
function lacksDwarf(result: PrepareResult): boolean {
  return result.action === "skipped" && !hasDwarfQuality(result.quality);
}

/** Yield a result that uploaded nothing, then close with the given hint. */
function* reportWithoutUpload(params: {
  results: PrepareResult[];
  hint: string;
}) {
  yield new CommandOutput<PrepareCommandResult>({
    uploaded: false,
    modules: params.results,
    filesUploaded: 0,
  });
  return { hint: params.hint };
}

/** Upload the companions, yield the combined result, and pick a hint. */
async function* reportUpload(
  setExitCode: (code: number) => void,
  params: {
    org: string;
    project: string;
    difs: DebugFileUpload[];
    results: PrepareResult[];
    wait: boolean;
    maxWaitMs: number;
    serverOptions: ChunkServerOptions;
  }
) {
  const uploads = await uploadDebugFiles(params);
  const failures = uploads.filter(
    (r) => r.state === "error" || r.state === "not_found"
  );

  yield new CommandOutput<PrepareCommandResult>({
    org: params.org,
    project: params.project,
    uploaded: true,
    modules: params.results,
    filesUploaded: uploads.length - failures.length,
  });

  if (failures.length > 0) {
    setExitCode(1);
    const details = failures
      .map((r) => `${r.debugId ?? r.name}: ${r.state}`)
      .join("; ");
    return { hint: `${failures.length} companion(s) failed: ${details}` };
  }

  return {
    hint: `Uploaded ${uploads.length} debug companion(s) to ${params.org}/${params.project}`,
  };
}

/**
 * Whether a module has a companion, or would get one on a real run.
 *
 * Unlike {@link uploadPath} this counts `would-split`, so a dry run reports the
 * work it would do rather than the (always empty) set it would upload.
 */
function producesCompanion(result: PrepareResult): boolean {
  return (
    result.action === "split" ||
    result.action === "would-split" ||
    result.action === "already-prepared"
  );
}

/**
 * Read a source file for source-bundle resolution, returning `null` when it is
 * not available locally.
 */
function readSourceFile(sourcePath: string): Uint8Array | null {
  try {
    return readFileSync(sourcePath);
  } catch (err) {
    log.debug(`Source file not available, skipping: ${sourcePath}`, err);
    return null;
  }
}

/**
 * Append a source bundle for a companion, when it references sources available
 * on this machine.
 *
 * The companion is where the DWARF lives, so it is the only artifact that can
 * name the source files to collect. Failures are logged and swallowed so a
 * missing source tree never aborts the upload.
 */
function appendSourceBundle(
  difs: DebugFileUpload[],
  companion: Uint8Array,
  name: string,
  debugId: string | undefined
): void {
  let result: ReturnType<typeof createSourceBundle>;
  try {
    result = createSourceBundle(companion, name, readSourceFile);
  } catch (err) {
    log.debug(`Could not build source bundle for ${name}`, err);
    return;
  }
  if (!(result.bundle && result.fileCount > 0)) {
    return;
  }
  const bundleDebugId = debugId ?? result.debugId ?? undefined;
  difs.push({
    name: `${bundleDebugId ?? name}.src.zip`,
    debugId: bundleDebugId,
    content: Buffer.from(result.bundle),
  });
}

/** Read each companion from disk and turn it into an upload entry. */
async function collectCompanionDifs(
  results: PrepareResult[],
  includeSources: boolean
): Promise<DebugFileUpload[]> {
  const difs: DebugFileUpload[] = [];
  for (const result of results) {
    const path = uploadPath(result);
    if (!path) {
      continue;
    }
    const content = await readFile(path);
    // The server re-parses the bytes and indexes every slice itself, so the id
    // is advisory; send it in the canonical dashed form or not at all.
    const debugId = result.buildId
      ? debugIdFromBuildId(result.buildId)
      : undefined;
    difs.push({ name: basename(path), debugId, content });

    if (includeSources) {
      appendSourceBundle(
        difs,
        new Uint8Array(content),
        basename(path),
        debugId
      );
    }
  }
  return difs;
}

/**
 * Compile `--ignore` globs and `--ignore-file` entries into path matchers.
 *
 * The ignore file is read as gitignore-style lines: blanks and `#` comments are
 * dropped and every other line is treated as a glob. Patterns are not split on
 * commas, because a glob's brace group (`{a,b}`) legitimately contains them.
 */
async function buildIgnoreMatchers(
  ignores: string[] | undefined,
  ignoreFile: string | undefined
): Promise<CompiledMatcher[]> {
  const patterns = [...(ignores ?? [])];
  if (ignoreFile) {
    const contents = await readFile(ignoreFile, "utf-8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && !trimmed.startsWith("#")) {
        patterns.push(trimmed);
      }
    }
  }
  return compileMatchers(patterns);
}

/**
 * Path of a scanned file relative to the scan root it came from.
 *
 * Ignore globs are written against the tree the user pointed at — `--ignore
 * 'vendor/**'` for `prepare ./dist` means `./dist/vendor` — so they must be
 * tested against a root-relative path rather than one relative to the process
 * working directory. Separators are normalized to `/` because glob patterns
 * always use them.
 */
function pathRelativeToRoot(path: string, roots: string[]): string {
  const resolved = resolve(path);
  let deepestRoot = "";
  for (const root of roots) {
    const rootPath = resolve(root);
    const contains =
      resolved === rootPath || resolved.startsWith(`${rootPath}${sep}`);
    if (contains && rootPath.length > deepestRoot.length) {
      deepestRoot = rootPath;
    }
  }
  // A root naming the file itself leaves nothing relative to match on, so fall
  // back to the basename.
  const rel = deepestRoot ? relative(deepestRoot, resolved) : "";
  return (rel === "" ? basename(resolved) : rel).split(sep).join("/");
}

/** Whether a scanned path is excluded by the ignore matchers. */
function isIgnored(
  path: string,
  matchers: CompiledMatcher[],
  roots: string[]
): boolean {
  if (matchers.length === 0) {
    return false;
  }
  return matchesAny(matchers, pathRelativeToRoot(path, roots), basename(path));
}

/**
 * Reject an explicitly named file that is not a WebAssembly module.
 *
 * A directory is scanned recursively and simply yields nothing, but naming a
 * non-`.wasm` file directly is a mistake worth reporting rather than silently
 * treating as an empty scan.
 *
 * @throws {ValidationError} If an explicit path is a file without a `.wasm`
 *   extension.
 */
async function assertWasmPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && !isWasmPath(path)) {
      throw new ValidationError(
        `Expected a .wasm file or a directory, but got ${path}`,
        "path"
      );
    }
  }
}

export const prepareCommand = buildCommand({
  // Auth is only needed on the upload path; --dry-run and --no-upload skip it.
  auth: false,
  docs: {
    brief: "Split WebAssembly debug info and upload it to Sentry",
    fullDescription:
      "Scan files and directories for WebAssembly modules, split the ones " +
      "carrying inline DWARF, and upload the debug companions to Sentry.\n\n" +
      "For each module with DWARF this injects a build_id (if absent), writes " +
      "a *.debug.wasm companion retaining the Code section and DWARF, strips " +
      "the .debug_* sections from the deployable module in place, and points " +
      "it at the companion via external_debug_info. The deployable module " +
      "keeps its original path, so your build artifact does not move.\n\n" +
      "Modules without DWARF are stamped with a build_id and reported with a " +
      "warning instead of failing the run. Running the command twice is safe: " +
      "an already-prepared module is detected and left alone.\n\n" +
      "Org/project are auto-detected from DSN, env vars, or config defaults.\n\n" +
      "--require-dwarf is checked before anything is uploaded, so a build " +
      "missing debug info fails without pushing files first. A module that " +
      "points at an external companion still counts as having DWARF.\n\n" +
      "Usage:\n" +
      "  sentry debug-files prepare ./dist\n" +
      "  sentry debug-files prepare ./app.wasm --no-upload\n" +
      "  sentry debug-files prepare ./dist --dry-run\n" +
      "  sentry debug-files prepare ./dist --require-dwarf\n" +
      "  sentry debug-files prepare ./dist --out-dir ./symbols\n" +
      "  sentry debug-files prepare ./dist --include-sources\n" +
      "  sentry debug-files prepare ./dist --ignore 'vendor/**'",
  },
  output: {
    human: formatPrepareResult,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        brief: "WebAssembly files or directories to scan",
        parse: String,
        placeholder: "path",
      },
    },
    flags: {
      "dry-run": {
        kind: "boolean",
        brief: "Classify modules without writing or uploading anything",
        optional: true,
        default: false,
      },
      "no-upload": {
        kind: "boolean",
        brief: "Split modules but do not upload the companions",
        optional: true,
        default: false,
      },
      "require-dwarf": {
        kind: "boolean",
        brief: "Fail if any scanned module lacks DWARF debug info",
        optional: true,
        default: false,
      },
      "out-dir": {
        kind: "parsed",
        parse: String,
        brief:
          "Directory for *.debug.wasm companions (modules are stripped in place)",
        optional: true,
      },
      "strip-names": {
        kind: "boolean",
        brief:
          "Also drop the name section from split modules (companion keeps it)",
        optional: true,
        default: false,
      },
      "build-id": {
        kind: "parsed",
        parse: String,
        brief: "Use this UUID as the build id instead of a random one",
        optional: true,
      },
      "include-sources": {
        kind: "boolean",
        brief: "Also upload a source bundle for each companion",
        optional: true,
        default: false,
      },
      ignore: {
        kind: "parsed",
        parse: String,
        brief: "Skip files and folders matching this glob (repeatable)",
        optional: true,
        variadic: true,
      },
      "ignore-file": {
        kind: "parsed",
        parse: String,
        brief: "Skip files and folders listed in this ignore file",
        optional: true,
      },
      wait: {
        kind: "boolean",
        brief: "Wait for server-side processing and report any errors",
        optional: true,
        default: false,
      },
      "wait-for": {
        kind: "parsed",
        parse: Number,
        brief: "Wait up to this many seconds for server-side processing",
        optional: true,
      },
    },
  },
  async *func(this: SentryContext, flags: PrepareFlags, ...paths: string[]) {
    if (paths.length === 0) {
      throw new ContextError("WebAssembly path(s)", USAGE_HINT, []);
    }
    const { wait, maxWaitMs } = resolveWaitMode(flags);
    const buildId = resolveBuildId(flags["build-id"]);
    const dryRun = Boolean(flags["dry-run"]);
    const setExitCode = (code: number) => {
      this.process.exitCode = code;
    };

    await assertWasmPaths(paths);
    const ignoreMatchers = await buildIgnoreMatchers(
      flags.ignore,
      flags["ignore-file"]
    );

    // Companions are inputs to a previous run, never candidates themselves.
    const candidates = (await scanPaths(paths)).filter(
      (path) =>
        isWasmPath(path) &&
        !isDebugCompanionPath(path) &&
        !isIgnored(path, ignoreMatchers, paths)
    );

    if (candidates.length === 0) {
      log.warn("No WebAssembly modules found.");
      return yield* reportWithoutUpload({
        results: [],
        hint: `No .wasm modules found. Try: ${USAGE_HINT}`,
      });
    }

    const results: PrepareResult[] = [];
    for (const path of candidates) {
      results.push(
        await prepareWasmFile(path, {
          dryRun,
          outDir: flags["out-dir"],
          buildId,
          stripNames: flags["strip-names"],
        })
      );
    }

    // The DWARF gate runs before anything is uploaded: a build missing debug
    // info should fail cleanly rather than push files and then go red.
    const missingDwarf = results.filter(lacksDwarf);
    if (flags["require-dwarf"] && missingDwarf.length > 0) {
      setExitCode(1);
      return yield* reportWithoutUpload({
        results,
        hint: `${missingDwarf.length} module(s) lack DWARF debug info (--require-dwarf).`,
      });
    }

    const prepared = results.filter(producesCompanion).length;

    // A dry run reports what it found and stops before any upload.
    if (dryRun || flags["no-upload"]) {
      return yield* reportWithoutUpload({
        results,
        hint: dryRun
          ? `Would prepare ${prepared} module(s). Remove --dry-run to write them.`
          : `Prepared ${prepared} module(s). Remove --no-upload to upload the companions.`,
      });
    }

    const difs = await collectCompanionDifs(
      results,
      Boolean(flags["include-sources"])
    );
    if (difs.length === 0) {
      return yield* reportWithoutUpload({
        results,
        hint: "No debug companions to upload.",
      });
    }

    const resolved = await resolveOrgAndProject({
      cwd: this.cwd,
      usageHint: USAGE_HINT,
    });
    if (!resolved) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    return yield* reportUpload(setExitCode, {
      org: resolved.org,
      project: resolved.project,
      difs,
      results,
      wait,
      maxWaitMs,
      serverOptions: await getChunkUploadOptions(resolved.org),
    });
  },
});
