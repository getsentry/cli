/**
 * sentry debug-files upload <path>...
 *
 * Scan files and directories for native debug information files (Mach-O/dSYM,
 * ELF, PE/PDB, Portable PDB, WASM, Breakpad, source bundles), filter them, and
 * upload them to Sentry via the DIF chunk-upload protocol.
 *
 * Org/project are resolved via the standard cascade (DSN auto-detection, env
 * vars, config defaults), so `--no-upload` (dry-run) needs no credentials.
 *
 * This is the first stage of `debug-files upload` parity. ZIP scanning,
 * `--symbol-maps`, `--il2cpp-mapping` line mappings, and `--derived-data` are
 * deferred to follow-up PRs (see the command's full description).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { SentryContext } from "../../context.js";
import {
  DEBUG_FILES_MAX_WAIT_MS,
  type DebugFileUpload,
  type DebugFileUploadResult,
  uploadDebugFiles,
} from "../../lib/api/debug-files.js";
import { buildCommand } from "../../lib/command.js";
import { createSourceBundle } from "../../lib/dif/index.js";
import {
  buildDifFilters,
  debugIdMatches,
  type PreparedDif,
  prepareDifs,
  scanPaths,
} from "../../lib/dif/scan.js";
import { ContextError, ValidationError } from "../../lib/errors.js";
import {
  colorTag,
  mdKvTable,
  renderMarkdown,
} from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";

const log = logger.withTag("debug-files.upload");

const USAGE_HINT = "sentry debug-files upload <path>...";

// ── Types ───────────────────────────────────────────────────────────

/** Per-file entry in the command result. */
type UploadedFileSummary = {
  /** Name stamped on the DIF. */
  name: string;
  /** Advisory debug id, if known. */
  debugId?: string;
  /** Assembly state after upload (omitted for `--no-upload`). */
  state?: DebugFileUploadResult["state"];
  /** Server detail/error, if any. */
  detail?: string | null;
};

/** Structured result for the debug-files upload command. */
type DebugFilesUploadResult = {
  /** Organization slug. Omitted when `--no-upload` short-circuits. */
  org?: string;
  /** Project slug. Omitted when `--no-upload` short-circuits. */
  project?: string;
  /** Whether files were actually uploaded (false for `--no-upload`). */
  uploaded: boolean;
  /** Per-file results. */
  files: UploadedFileSummary[];
  /** Number of files uploaded (0 for `--no-upload`). */
  filesUploaded: number;
};

/** Flags accepted by the upload command. */
type UploadFlags = {
  type?: string[];
  id?: string[];
  "require-all"?: boolean;
  "no-debug"?: boolean;
  "no-unwind"?: boolean;
  "no-sources"?: boolean;
  "include-sources"?: boolean;
  "no-upload"?: boolean;
  wait?: boolean;
  "wait-for"?: number;
};

// ── Formatter ───────────────────────────────────────────────────────

/** Human-readable label for an empty-state cell. */
function noneCell(): string {
  return colorTag("muted", "none");
}

/** Format human-readable output for the upload result. */
function formatUploadResult(data: DebugFilesUploadResult): string {
  const rows: [string, string][] = [];
  if (data.org) {
    rows.push(["Organization", data.org]);
  }
  if (data.project) {
    rows.push(["Project", data.project]);
  }
  rows.push([
    data.uploaded ? "Files uploaded" : "Files found",
    String(data.files.length),
  ]);
  for (const file of data.files) {
    const id = file.debugId ?? noneCell();
    const suffix = file.state ? `  [${file.state}]` : "";
    rows.push(["DIF", `${id}  ${file.name}${suffix}`]);
  }
  return renderMarkdown(mdKvTable(rows));
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Build a stable dedupe key from a file's debug id and content hash. */
function difKey(dif: DebugFileUpload): string {
  const hash = createHash("sha1").update(dif.content).digest("hex");
  return `${dif.debugId ?? ""}:${hash}`;
}

/**
 * Convert prepared files into the DIF upload list, optionally appending a
 * source bundle per file when `--include-sources` is set.
 *
 * Source files are read synchronously from the paths recorded in each object's
 * debug info; files not present locally are skipped. A bundle is only added
 * when it contains at least one source file.
 */
function buildDifList(
  prepared: PreparedDif[],
  includeSources: boolean
): DebugFileUpload[] {
  const difs: DebugFileUpload[] = [];
  for (const file of prepared) {
    difs.push({
      name: basename(file.path),
      debugId: file.debugId,
      content: file.content,
    });

    if (!includeSources) {
      continue;
    }

    let result: ReturnType<typeof createSourceBundle>;
    try {
      result = createSourceBundle(
        new Uint8Array(file.content),
        basename(file.path),
        (sourcePath) => {
          try {
            return readFileSync(sourcePath);
          } catch (err) {
            log.debug(
              `Source file not available, skipping: ${sourcePath}`,
              err
            );
            return null;
          }
        }
      );
    } catch (err) {
      log.debug(`Could not build source bundle for ${file.path}`, err);
      continue;
    }

    if (result.bundle && result.fileCount > 0) {
      // Stamp the bundle with the filter-passing primary object's debug id so
      // it matches the main DIF's advisory id, even when filters dropped the
      // slice `createSourceBundle` would otherwise have picked.
      const bundleDebugId = file.debugId ?? result.debugId ?? undefined;
      difs.push({
        name: `${bundleDebugId ?? basename(file.path)}.src.zip`,
        debugId: bundleDebugId,
        content: Buffer.from(result.bundle),
      });
    }
  }
  return difs;
}

/** Deduplicate DIFs by debug id + content hash, keeping the first occurrence. */
function dedupeDifs(difs: DebugFileUpload[]): DebugFileUpload[] {
  const seen = new Set<string>();
  const unique: DebugFileUpload[] = [];
  for (const dif of difs) {
    const key = difKey(dif);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(dif);
  }
  return unique;
}

/**
 * Determine which explicitly requested `--id` values were not found among the
 * uploaded files. Returns an empty array when `--id` was not used.
 */
function missingRequestedIds(
  requestedIds: string[] | undefined,
  prepared: PreparedDif[]
): string[] {
  if (!requestedIds || requestedIds.length === 0) {
    return [];
  }
  const foundIds = prepared.flatMap((p) => p.objects.map((o) => o.debugId));
  return requestedIds.filter(
    (requested) => !foundIds.some((found) => debugIdMatches(requested, found))
  );
}

/**
 * Resolve the wait mode and deadline from `--wait` / `--wait-for`.
 *
 * @throws {ValidationError} If both flags are set, or `--wait-for` is invalid.
 */
function resolveWaitMode(flags: UploadFlags): {
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

// ── Command ─────────────────────────────────────────────────────────

/**
 * Yield a no-upload (dry-run) result and return the appropriate hint.
 * Handles --require-all exit-code logic.
 */
function* doDryRun(
  setExitCode: (code: number) => void,
  difs: DebugFileUpload[],
  missingIds: string[],
  requireAll: boolean
) {
  yield new CommandOutput<DebugFilesUploadResult>({
    uploaded: false,
    files: difs.map((d) => ({ name: d.name, debugId: d.debugId })),
    filesUploaded: 0,
  });
  if (missingIds.length > 0 && requireAll) {
    setExitCode(1);
    return { hint: `Missing requested debug id(s): ${missingIds.join(", ")}` };
  }
  return {
    hint:
      difs.length === 0
        ? `No debug information files found. Try: ${USAGE_HINT}`
        : `Would upload ${difs.length} debug file(s). Remove --no-upload to upload.`,
  };
}

/**
 * Report that nothing was found to upload (no auth needed).
 * Honors `--require-all`: exit 1 only when requested ids are missing.
 */
function* doNothingToUpload(
  setExitCode: (code: number) => void,
  missingIds: string[],
  requireAll: boolean
) {
  log.warn("No debug information files found.");
  yield new CommandOutput<DebugFilesUploadResult>({
    uploaded: false,
    files: [],
    filesUploaded: 0,
  });
  if (missingIds.length > 0 && requireAll) {
    setExitCode(1);
    return { hint: `Missing requested debug id(s): ${missingIds.join(", ")}` };
  }
  return { hint: `No debug information files found. Try: ${USAGE_HINT}` };
}

/**
 * Perform the upload, yield the result, and return a hint. Non-terminal states
 * (error, not_found) set the exit code and return a descriptive hint.
 * Also honors `--require-all` against the requested `--id` values.
 */
async function* doUpload(
  setExitCode: (code: number) => void,
  params: {
    org: string;
    project: string;
    difs: DebugFileUpload[];
    wait: boolean;
    maxWaitMs: number;
    missingRequestedIds: string[];
    requireAll: boolean;
  }
) {
  const results = await uploadDebugFiles(params);

  yield new CommandOutput<DebugFilesUploadResult>({
    org: params.org,
    project: params.project,
    uploaded: true,
    files: results.map((r) => ({
      name: r.name,
      debugId: r.debugId,
      state: r.state,
      detail: r.detail,
    })),
    filesUploaded: results.length,
  });

  const failures = results.filter(
    (r) => r.state === "error" || r.state === "not_found"
  );
  if (failures.length > 0) {
    setExitCode(1);
    const details = failures
      .map(
        (r) =>
          `${r.debugId ?? r.name}: ${r.state}${r.detail ? ` (${r.detail})` : ""}`
      )
      .join("; ");
    return {
      hint: `${failures.length === 1 ? "1 file" : `${failures.length} files`} had failures: ${details}`,
    };
  }

  if (params.missingRequestedIds.length > 0 && params.requireAll) {
    setExitCode(1);
    return {
      hint: `Missing requested debug id(s): ${params.missingRequestedIds.join(", ")}`,
    };
  }

  return {
    hint: `Uploaded ${results.length} debug file(s) to ${params.org}/${params.project}`,
  };
}

export const uploadCommand = buildCommand({
  // Auth is not required for --no-upload (dry-run). The upload path calls
  // resolveOrgAndProject which triggers auth resolution.
  auth: false,
  docs: {
    brief: "Upload debug information files to Sentry",
    fullDescription:
      "Scan files and directories for native debug information files and " +
      "upload them to Sentry using the chunk-upload protocol. Supports " +
      "Mach-O/dSYM, ELF, PE/PDB, Portable PDB, WebAssembly, Breakpad, and " +
      "source bundles. Directories are scanned recursively.\n\n" +
      "Org/project are auto-detected from DSN, env vars, or config defaults.\n\n" +
      "Filters:\n" +
      "  --type     Only upload files of the given type (repeatable):\n" +
      "             dsym, elf, pe, pdb, portablepdb, wasm, breakpad,\n" +
      "             sourcebundle, jvm\n" +
      "  --id       Only upload the object with the given debug id (repeatable)\n" +
      "  --no-debug / --no-unwind / --no-sources   Drop files whose only\n" +
      "             useful feature is the named one\n\n" +
      "Usage:\n" +
      "  sentry debug-files upload ./build\n" +
      "  sentry debug-files upload ./libexample.so --include-sources\n" +
      "  sentry debug-files upload ./dsyms --type dsym --wait\n" +
      "  sentry debug-files upload ./build --no-upload\n\n" +
      "Not yet supported (planned): scanning inside ZIP archives, " +
      "--symbol-maps (BCSymbolMap resolution), --il2cpp-mapping line " +
      "mappings, and --derived-data.",
  },
  output: {
    human: formatUploadResult,
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        brief: "Files or directories to scan for debug information files",
        parse: String,
        placeholder: "path",
      },
    },
    flags: {
      type: {
        kind: "parsed",
        parse: String,
        brief:
          "Only upload files of this type (repeatable): dsym, elf, pe, pdb, " +
          "portablepdb, wasm, breakpad, sourcebundle, jvm",
        optional: true,
        variadic: true,
      },
      id: {
        kind: "parsed",
        parse: String,
        brief: "Only upload the object with this debug id (repeatable)",
        optional: true,
        variadic: true,
      },
      "require-all": {
        kind: "boolean",
        brief: "Fail if any --id value was not found among scanned files",
        optional: true,
        default: false,
      },
      "no-debug": {
        kind: "boolean",
        brief: "Do not upload files whose only feature is debug/symbol info",
        optional: true,
        default: false,
      },
      "no-unwind": {
        kind: "boolean",
        brief: "Do not upload files whose only feature is unwind info",
        optional: true,
        default: false,
      },
      "no-sources": {
        kind: "boolean",
        brief: "Do not upload files whose only feature is source info",
        optional: true,
        default: false,
      },
      "include-sources": {
        kind: "boolean",
        brief: "Build and upload a source bundle for each file with debug info",
        optional: true,
        default: false,
      },
      "no-upload": {
        kind: "boolean",
        brief: "Scan and print what would be uploaded without uploading",
        optional: true,
        default: false,
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
    aliases: {
      t: "type",
    },
  },
  async *func(this: SentryContext, flags: UploadFlags, ...paths: string[]) {
    if (paths.length === 0) {
      throw new ContextError("Debug file path(s)", USAGE_HINT, []);
    }
    const { wait, maxWaitMs } = resolveWaitMode(flags);

    const filters = buildDifFilters({
      types: flags.type,
      ids: flags.id,
      noDebug: flags["no-debug"],
      noUnwind: flags["no-unwind"],
      noSources: flags["no-sources"],
    });
    const files = await scanPaths(paths);
    const prepared = await prepareDifs(files, filters);
    const difs = dedupeDifs(
      buildDifList(prepared, Boolean(flags["include-sources"]))
    );
    const missingIds = missingRequestedIds(flags.id, prepared);
    const requireAll = Boolean(flags["require-all"]);

    if (flags["no-upload"]) {
      return yield* doDryRun(
        (c) => {
          this.process.exitCode = c;
        },
        difs,
        missingIds,
        requireAll
      );
    }

    if (difs.length === 0) {
      return yield* doNothingToUpload(
        (c) => {
          this.process.exitCode = c;
        },
        missingIds,
        requireAll
      );
    }

    const resolved = await resolveOrgAndProject({
      cwd: this.cwd,
      usageHint: USAGE_HINT,
    });
    if (!resolved) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }

    return yield* doUpload(
      (c) => {
        this.process.exitCode = c;
      },
      {
        org: resolved.org,
        project: resolved.project,
        difs,
        wait,
        maxWaitMs,
        missingRequestedIds: missingIds,
        requireAll,
      }
    );
  },
});
