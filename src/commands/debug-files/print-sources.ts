/**
 * sentry debug-files print-sources <path>
 *
 * List the source files referenced by a debug information file (Mach-O/dSYM,
 * ELF, PE/PDB, Portable PDB, Breakpad, source bundles). For each referenced
 * file it reports whether the source is embedded, available via a source link,
 * or present on the local disk.
 *
 * This mirrors the legacy `sentry-cli difutil print-sources` and complements
 * `bundle-sources`. Local-only — no API calls. Parsing happens in-process via
 * the bundled `symbolic` WASM module (see `src/lib/dif/`).
 */

import { existsSync } from "node:fs";
import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import { type DifSourcesInfo, listSources } from "../../lib/dif/index.js";
import { ValidationError } from "../../lib/errors.js";
import {
  colorTag,
  renderMarkdown,
  safeCodeSpan,
} from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { readDebugFile } from "./read-file.js";

const USAGE_HINT = "sentry debug-files print-sources <path>";

/** A referenced source file augmented with local-disk availability. */
type PrintSourcesFile = DifSourcesInfo["objects"][number]["files"][number] & {
  /** Whether the file exists on the local disk; `null` when embedded or linked. */
  availableLocally: boolean | null;
};

/** Per-object referenced sources for the command output. */
type PrintSourcesObject = {
  debugId: string;
  fileFormat: string;
  files: PrintSourcesFile[];
};

/** Structured result yielded by the command (and serialized to JSON). */
type PrintSourcesResult = {
  path: string;
  objects: PrintSourcesObject[];
};

/** Short, human-readable description of where a referenced source lives. */
function describeSource(file: PrintSourcesFile): string {
  if (file.url !== null) {
    return colorTag("muted", `source link: ${file.url}`);
  }
  if (file.resolved) {
    return colorTag("muted", "embedded");
  }
  if (file.availableLocally) {
    return colorTag("muted", "not embedded, available locally");
  }
  return colorTag("muted", "not embedded, not available locally");
}

/** Human formatter: one section per object, listing each referenced source. */
function formatPrintSources(data: PrintSourcesResult): string {
  if (data.objects.length === 0) {
    return renderMarkdown(colorTag("muted", "No objects found in the file."));
  }

  const sections = data.objects.map((object) => {
    const header = `${object.fileFormat} ${safeCodeSpan(object.debugId)}`;
    if (object.files.length === 0) {
      return `${header} — ${colorTag("muted", "no referenced sources")}`;
    }
    const lines = object.files.map(
      (file) => `- ${safeCodeSpan(file.path)} — ${describeSource(file)}`
    );
    const count = object.files.length;
    return `${header} — ${count} source file${count === 1 ? "" : "s"}:\n\n${lines.join("\n")}`;
  });

  return renderMarkdown(sections.join("\n\n"));
}

export const printSourcesCommand = buildCommand({
  // Local-only: parses + enumerates in-process, no API calls.
  auth: false,
  docs: {
    brief: "List the source files a debug file references",
    fullDescription:
      "List the source files referenced by a debug information file. For each " +
      "referenced file it reports whether the source is embedded in the file, " +
      "available via a source link, or present on the local disk — useful for " +
      "checking what `bundle-sources` would include. Supports Mach-O/dSYM, " +
      "ELF, PE/PDB, Portable PDB, and Breakpad.\n\n" +
      "The format is auto-detected. This command is local-only and makes no " +
      "network requests.\n\n" +
      "Usage:\n" +
      "  sentry debug-files print-sources ./libexample.so\n" +
      "  sentry debug-files print-sources ./app.pdb --json",
  },
  output: {
    human: formatPrintSources,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Path to the debug information file",
          parse: String,
          placeholder: "path",
        },
      ],
    },
    flags: {},
  },
  async *func(
    this: SentryContext,
    _flags: Record<string, never>,
    path: string
  ) {
    const content = await readDebugFile(path);

    let info: DifSourcesInfo;
    try {
      info = listSources(new Uint8Array(content));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ValidationError(
        `'${path}' is not a recognized debug information file: ${msg}`,
        "path"
      );
    }

    const objects: PrintSourcesObject[] = info.objects.map((object) => ({
      debugId: object.debugId,
      fileFormat: object.fileFormat,
      files: object.files.map((file) => ({
        ...file,
        // Local availability only matters for files that aren't embedded/linked.
        availableLocally: file.resolved ? null : existsSync(file.path),
      })),
    }));

    yield new CommandOutput<PrintSourcesResult>({ path, objects });

    const total = objects.reduce((sum, object) => sum + object.files.length, 0);
    if (total === 0) {
      return {
        hint: `No referenced sources found in '${path}'. Try: ${USAGE_HINT}`,
      };
    }
    return {
      hint: `Bundle these into a source bundle with: sentry debug-files bundle-sources ${path}`,
    };
  },
});
