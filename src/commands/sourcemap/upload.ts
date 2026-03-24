/**
 * sentry sourcemap upload <dir>
 *
 * Upload sourcemaps to Sentry using debug-ID-based matching.
 * Org/project are resolved via the standard cascade (DSN auto-detection,
 * env vars, config defaults) — no slash-separated arg parsing needed.
 */

import { basename, relative, resolve } from "node:path";
import type { SentryContext } from "../../context.js";
import {
  type ArtifactFile,
  uploadSourcemaps,
} from "../../lib/api/sourcemaps.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import { mdKvTable, renderMarkdown } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import { injectDirectory } from "../../lib/sourcemap/inject.js";

/** Result type for the upload command. */
type UploadCommandResult = {
  /** Organization slug. */
  org: string;
  /** Project slug. */
  project: string;
  /** Release version, if provided. */
  release?: string;
  /** Number of file pairs uploaded. */
  filesUploaded: number;
};

/** Format human-readable output for upload results. */
function formatUploadResult(data: UploadCommandResult): string {
  const rows: [string, string][] = [
    ["Organization", data.org],
    ["Project", data.project],
    ["Files uploaded", String(data.filesUploaded)],
  ];
  if (data.release) {
    rows.push(["Release", data.release]);
  }
  return renderMarkdown(mdKvTable(rows));
}

const USAGE_HINT = "sentry sourcemap upload <directory>";

export const uploadCommand = buildCommand({
  docs: {
    brief: "Upload sourcemaps to Sentry",
    fullDescription:
      "Upload JavaScript sourcemaps and source files to Sentry using " +
      "debug-ID-based matching.\n\n" +
      "Files must have debug IDs injected first (via `sentry sourcemap inject`).\n" +
      "Org/project are auto-detected from DSN, env vars, or config defaults.\n\n" +
      "Usage:\n" +
      "  sentry sourcemap upload ./dist\n" +
      "  sentry sourcemap upload ./dist --release 1.0.0\n" +
      "  sentry sourcemap upload ./dist --url-prefix '~/static/js/'",
  },
  output: {
    human: formatUploadResult,
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Directory containing sourcemaps",
          parse: String,
          placeholder: "directory",
        },
      ],
    },
    flags: {
      release: {
        kind: "parsed",
        parse: String,
        brief: "Release version to associate with the upload",
        optional: true,
      },
      "url-prefix": {
        kind: "parsed",
        parse: String,
        brief: "URL prefix for uploaded files (default: ~/)",
        optional: true,
        default: "~/",
      },
    },
  },
  async *func(
    this: SentryContext,
    flags: { release?: string; "url-prefix"?: string },
    dir: string
  ) {
    // Resolve org/project via the standard cascade
    const resolved = await resolveOrgAndProject({
      cwd: this.cwd,
      usageHint: USAGE_HINT,
    });
    if (!resolved) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }
    const { org, project } = resolved;

    // Discover files with debug IDs (also injects any missing ones)
    const results = await injectDirectory(dir);
    const filesWithDebugIds = results.filter((r) => r.debugId !== "(dry run)");

    if (filesWithDebugIds.length === 0) {
      yield new CommandOutput<UploadCommandResult>({
        org,
        project,
        release: flags.release,
        filesUploaded: 0,
      });
      return {
        hint: "No JS + sourcemap pairs found. Run `sentry sourcemap inject` first.",
      };
    }

    const urlPrefix = flags["url-prefix"] ?? "~/";

    // Build artifact file list with paths relative to the upload directory
    const resolvedDir = resolve(dir);
    const artifactFiles: ArtifactFile[] = filesWithDebugIds.flatMap(
      ({ jsPath, mapPath, debugId }) => {
        // Normalize to forward slashes for URLs (handles Windows backslashes)
        const jsRelative = relative(resolvedDir, jsPath).replaceAll("\\", "/");
        const mapRelative = relative(resolvedDir, mapPath).replaceAll(
          "\\",
          "/"
        );
        const mapBasename = basename(mapPath);
        return [
          {
            path: jsPath,
            debugId,
            type: "minified_source" as const,
            url: `${urlPrefix}${jsRelative}`,
            sourcemapFilename: mapBasename,
          },
          {
            path: mapPath,
            debugId,
            type: "source_map" as const,
            url: `${urlPrefix}${mapRelative}`,
          },
        ];
      }
    );

    await uploadSourcemaps({
      org,
      project,
      release: flags.release,
      files: artifactFiles,
    });

    yield new CommandOutput<UploadCommandResult>({
      org,
      project,
      release: flags.release,
      filesUploaded: filesWithDebugIds.length,
    });
  },
});
