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
      "Usage:\n" +
      "  sentry sourcemap inject ./dist\n" +
      "  sentry sourcemap inject ./build --ext .js,.mjs\n" +
      "  sentry sourcemap inject ./out --dry-run",
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
    },
  },
  async *func(
    this: SentryContext,
    flags: { ext?: string; "dry-run"?: boolean },
    dir: string
  ) {
    const extensions = flags.ext?.split(",").map((e) => e.trim());
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
