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
import {
  assertDirectoryReadable,
  buildEmptyDiscoveryError,
  diagnoseEmptyDiscovery,
  discoverFilePairs,
  injectDirectory,
} from "../../lib/sourcemap/inject.js";

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
      "Automatically injects debug IDs into any files that don't already have them.\n" +
      "Org/project are auto-detected from DSN, env vars, or config defaults.\n\n" +
      "Exits with an error if zero JS + sourcemap pairs are discovered " +
      "(typical cause: bundler not emitting .map files). Pass " +
      "--allow-empty to suppress this check for directories that may " +
      "legitimately be empty.\n\n" +
      "Usage:\n" +
      "  sentry sourcemap upload ./dist\n" +
      "  sentry sourcemap upload ./dist --release 1.0.0\n" +
      "  sentry sourcemap upload ./dist --url-prefix '~/static/js/'\n" +
      "  sentry sourcemap upload ./maybe-empty --allow-empty",
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
      "allow-empty": {
        kind: "boolean",
        brief:
          "Exit successfully when no JS + sourcemap pairs are found " +
          "(default: error out to catch silent build misconfigurations)",
        optional: true,
        default: false,
      },
    },
  },
  async *func(
    this: SentryContext,
    flags: {
      release?: string;
      "url-prefix"?: string;
      "allow-empty"?: boolean;
    },
    dir: string
  ) {
    // Validate the directory and discover pairs read-only first so we
    // don't write debug IDs when the upload won't proceed (empty dir,
    // typoed path, missing credentials).
    await assertDirectoryReadable(dir);
    const pairs = await discoverFilePairs(dir);

    if (pairs.length === 0 && !flags["allow-empty"]) {
      const diag = await diagnoseEmptyDiscovery(dir);
      throw buildEmptyDiscoveryError(dir, diag);
    }

    const resolved = await resolveOrgAndProject({
      cwd: this.cwd,
      usageHint: USAGE_HINT,
    });
    if (!resolved) {
      throw new ContextError("Organization and project", USAGE_HINT);
    }
    const { org, project } = resolved;

    if (pairs.length === 0) {
      yield new CommandOutput<UploadCommandResult>({
        org,
        project,
        release: flags.release,
        filesUploaded: 0,
      });
      return {
        hint:
          "No JS + sourcemap pairs found in the target directory. " +
          "If this is unexpected, check your bundler emits .map files.",
      };
    }

    const results = await injectDirectory(dir);

    const urlPrefix = flags["url-prefix"] ?? "~/";

    // Build artifact file list with paths relative to the upload directory
    const resolvedDir = resolve(dir);
    const artifactFiles: ArtifactFile[] = results.flatMap(
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
      filesUploaded: results.length,
    });
  },
});
