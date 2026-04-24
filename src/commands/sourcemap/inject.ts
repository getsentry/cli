/**
 * sentry sourcemap inject <dir>
 *
 * Scan a directory for JavaScript files and their companion sourcemaps,
 * then inject Sentry debug IDs for reliable sourcemap resolution.
 */

import type { SentryContext } from "../../context.js";
import { buildCommand } from "../../lib/command.js";
import {
  colorTag,
  mdKvTable,
  renderMarkdown,
} from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import {
  assertDirectoryReadable,
  buildEmptyDiscoveryError,
  diagnoseEmptyDiscovery,
  discoverFilePairs,
  type InjectResult,
  injectDirectory,
} from "../../lib/sourcemap/inject.js";

/** Result type for the inject command output. */
type InjectCommandResult = {
  modified: number;
  skipped: number;
  files: InjectResult[];
};

/** Format human-readable output for inject results. */
function formatInjectResult(data: InjectCommandResult): string {
  const lines: string[] = [];
  lines.push(
    mdKvTable([
      ["Files modified", String(data.modified)],
      ["Files skipped", String(data.skipped)],
    ])
  );

  if (data.files.length > 0) {
    lines.push("");
    for (const file of data.files) {
      const status = file.injected ? "✓" : "–";
      lines.push(
        `${status} ${file.jsPath} → ${colorTag("muted", file.debugId)}`
      );
    }
  }

  return renderMarkdown(lines.join("\n"));
}

export const injectCommand = buildCommand({
  docs: {
    brief: "Inject debug IDs into JavaScript files and sourcemaps",
    fullDescription:
      "Scans a directory for .js/.mjs/.cjs files and their companion .map files, " +
      "then injects Sentry debug IDs for reliable sourcemap resolution.\n\n" +
      "The injection is idempotent — files that already have debug IDs are skipped.\n\n" +
      "Exits with an error if zero JS + sourcemap pairs are discovered " +
      "(typical cause: bundler not emitting .map files). Pass " +
      "--allow-empty to suppress this check for directories that may " +
      "legitimately be empty.\n\n" +
      "Usage:\n" +
      "  sentry sourcemap inject ./dist\n" +
      "  sentry sourcemap inject ./build --ext .js,.mjs\n" +
      "  sentry sourcemap inject ./out --dry-run\n" +
      "  sentry sourcemap inject ./maybe-empty --allow-empty",
  },
  output: {
    human: formatInjectResult,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Directory to scan for JS + sourcemap pairs",
          parse: String,
          placeholder: "directory",
        },
      ],
    },
    flags: {
      ext: {
        kind: "parsed",
        parse: String,
        brief:
          "Comma-separated file extensions to process (default: .js,.cjs,.mjs)",
        optional: true,
      },
      "dry-run": {
        kind: "boolean",
        brief: "Show what would be modified without writing",
        optional: true,
        default: false,
      },
      "allow-empty": {
        kind: "boolean",
        brief:
          "Exit successfully when no JS + sourcemap pairs are discovered " +
          "(default: error out to catch silent build misconfigurations)",
        optional: true,
        default: false,
      },
    },
  },
  async *func(
    this: SentryContext,
    flags: { ext?: string; "dry-run"?: boolean; "allow-empty"?: boolean },
    dir: string
  ) {
    // Phase 1 — read-only validation. Distinct errors for "directory
    // missing" vs "directory empty/misconfigured". Discovery runs
    // without side effects so we never write debug IDs into files when
    // the upstream state is doomed (empty dir, typo'd path).
    await assertDirectoryReadable(dir);

    const extensions = flags.ext?.split(",").map((e) => e.trim());
    const extSet = extensions
      ? new Set(extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)))
      : undefined;

    // Guard against silent misconfigurations: zero *discovered* pairs
    // almost always means the bundler didn't emit .map files. This is
    // distinct from zero *injected* (which is legitimate when every
    // pair already has a debug ID — the idempotent re-run case).
    // Callers that legitimately invoke inject on potentially-empty
    // directories can pass --allow-empty.
    const pairs = await discoverFilePairs(dir, extSet);
    if (pairs.length === 0 && !flags["allow-empty"]) {
      const diag = await diagnoseEmptyDiscovery(dir, { extensions });
      throw buildEmptyDiscoveryError(dir, diag);
    }

    // Phase 2 — mutating work (skipped in dry-run). The second pass
    // through `injectDirectory` re-walks the directory; this is cheap
    // relative to the sourcemap parsing/rewriting it does per pair.
    const results = await injectDirectory(dir, {
      extensions,
      dryRun: flags["dry-run"],
    });

    const modified = results.filter((r) => r.injected).length;
    const skipped = results.length - modified;

    yield new CommandOutput<InjectCommandResult>({
      modified,
      skipped,
      files: results,
    });

    if (modified > 0) {
      return {
        hint: "Run `sentry sourcemap upload` to upload the injected files to Sentry",
      };
    }
    return {};
  },
});
