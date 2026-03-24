/**
 * sentry sourcemap upload [org/project/]<dir>
 *
 * Upload sourcemaps to Sentry using debug-ID-based matching.
 */

import type { SentryContext } from "../../context.js";
import {
  type ArtifactFile,
  uploadSourcemaps,
} from "../../lib/api/sourcemaps.js";
import {
  parseOrgProjectArg,
  parseSlashSeparatedArg,
} from "../../lib/arg-parsing.js";
import { buildCommand } from "../../lib/command.js";
import { ContextError } from "../../lib/errors.js";
import { mdKvTable, renderMarkdown } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { resolveOrgAndProject } from "../../lib/resolve-target.js";
import { injectDirectory } from "../../lib/sourcemap/inject.js";

/** Result type for the upload command. */
type UploadCommandResult = {
  org: string;
  project: string;
  release?: string;
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

const USAGE_HINT = "sentry sourcemap upload [<org>/<project>/]<directory>";

export const uploadCommand = buildCommand({
  docs: {
    brief: "Upload sourcemaps to Sentry",
    fullDescription:
      "Upload JavaScript sourcemaps and source files to Sentry using " +
      "debug-ID-based matching.\n\n" +
      "Files must have debug IDs injected first (via `sentry sourcemap inject`).\n\n" +
      "Usage:\n" +
      "  sentry sourcemap upload ./dist\n" +
      "  sentry sourcemap upload my-org/my-project/./dist\n" +
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
          brief:
            "Directory containing sourcemaps (optionally prefixed with org/project/)",
          parse: String,
          placeholder: "org/project/directory",
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
    target: string
  ) {
    // Parse org/project from the target argument
    const { id: dir, targetArg } = parseSlashSeparatedArg(
      target,
      "Directory",
      USAGE_HINT
    );
    const parsed = parseOrgProjectArg(targetArg);

    let org: string;
    let project: string;

    if (parsed.type === "explicit") {
      org = parsed.org;
      project = parsed.project;
    } else {
      const resolved = await resolveOrgAndProject({
        cwd: this.cwd,
        usageHint: USAGE_HINT,
      });
      if (!resolved) {
        throw new ContextError("Organization and project", USAGE_HINT);
      }
      org = resolved.org;
      project = resolved.project;
    }

    // Discover files with debug IDs
    const results = await injectDirectory(dir);
    const injectedFiles = results.filter(
      (r) => r.injected || r.debugId !== "(dry run)"
    );

    if (injectedFiles.length === 0) {
      yield new CommandOutput<UploadCommandResult>({
        org,
        project,
        release: flags.release,
        filesUploaded: 0,
      });
      return {
        hint: "No files with debug IDs found. Run `sentry sourcemap inject` first.",
      };
    }

    const urlPrefix = flags["url-prefix"] ?? "~/";

    // Build artifact file list
    const artifactFiles: ArtifactFile[] = injectedFiles.flatMap(
      ({ jsPath, mapPath, debugId }) => {
        const jsName = jsPath.split("/").pop() ?? "bundle.js";
        const mapName = mapPath.split("/").pop() ?? "bundle.js.map";
        return [
          {
            path: jsPath,
            debugId,
            type: "minified_source" as const,
            url: `${urlPrefix}${jsName}`,
            sourcemapFilename: mapName,
          },
          {
            path: mapPath,
            debugId,
            type: "source_map" as const,
            url: `${urlPrefix}${mapName}`,
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
      filesUploaded: injectedFiles.length,
    });
  },
});
