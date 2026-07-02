/**
 * sentry snapshots download
 *
 * Download baseline snapshot images from Sentry's preprod system to a local
 * directory. Resolve a snapshot by `--snapshot-id`, or the latest baseline for
 * an app via `--app-id` (optionally filtered by `--branch`). Ensures the
 * downloadable archive is built (triggering + polling if needed), then extracts
 * the images.
 *
 * Org-scoped. Sentry SaaS only.
 */

import { resolve } from "node:path";
import type { SentryContext } from "../../context.js";
import {
  downloadSnapshotArchive,
  getLatestBaseSnapshot,
  waitForSnapshotArchive,
} from "../../lib/api/preprod-artifacts.js";
import { buildCommand } from "../../lib/command.js";
import {
  ContextError,
  ResolutionError,
  ValidationError,
} from "../../lib/errors.js";
import { mdKvTable, renderMarkdown } from "../../lib/formatters/markdown.js";
import { CommandOutput } from "../../lib/formatters/output.js";
import { logger } from "../../lib/logger.js";
import { resolveOrg } from "../../lib/resolve-target.js";
import { extractZipToDir } from "../../lib/snapshots/archive.js";

const log = logger.withTag("snapshots.download");

const USAGE_HINT =
  "sentry snapshots download --app-id <app> | --snapshot-id <id>";
const DEFAULT_OUTPUT = "./snapshots-base/";

/** Flags accepted by `snapshots download`. */
type DownloadFlags = {
  "app-id"?: string;
  "snapshot-id"?: string;
  branch?: string;
  output?: string;
};

/** Structured result for `snapshots download`. */
type SnapshotDownloadResult = {
  /** Organization slug. */
  org: string;
  /** The resolved snapshot artifact ID. */
  snapshotId: string;
  /** Local directory the images were extracted to. */
  output: string;
  /** Number of images extracted. */
  imageCount: number;
};

/** Human-readable formatter for the download result. */
function formatDownloadResult(data: SnapshotDownloadResult): string {
  return renderMarkdown(
    mdKvTable([
      ["Snapshot ID", data.snapshotId],
      ["Images", String(data.imageCount)],
      ["Saved to", data.output],
    ])
  );
}

/**
 * Resolve the snapshot ID to download from the mutually exclusive
 * `--snapshot-id` / `--app-id` flags.
 */
async function resolveSnapshotId(
  org: string,
  flags: DownloadFlags,
  project: string | undefined
): Promise<string> {
  const appId = flags["app-id"];
  const snapshotId = flags["snapshot-id"];

  if (appId && snapshotId) {
    throw new ValidationError(
      "Provide only one of --app-id or --snapshot-id",
      "app-id"
    );
  }
  if (flags.branch && !appId) {
    throw new ValidationError(
      "--branch can only be used with --app-id",
      "branch"
    );
  }

  if (snapshotId) {
    return snapshotId;
  }
  if (!appId) {
    throw new ContextError("Snapshot", USAGE_HINT, []);
  }

  log.info(`Resolving latest baseline snapshot for app '${appId}'...`);
  const latest = await getLatestBaseSnapshot(org, appId, {
    branch: flags.branch,
    project,
  });
  if (!latest) {
    const branchMsg = flags.branch ? ` on branch '${flags.branch}'` : "";
    throw new ResolutionError(
      `Baseline snapshot for app '${appId}'${branchMsg}`,
      "not found",
      USAGE_HINT,
      ["No baseline snapshot exists for this app yet."]
    );
  }
  log.info(
    `Found snapshot ${latest.headArtifactId} (${latest.imageCount} images)`
  );
  return latest.headArtifactId;
}

export const downloadCommand = buildCommand({
  docs: {
    brief: "Download baseline snapshot images",
    fullDescription:
      "Download baseline snapshot images from Sentry's preprod system to a " +
      "local directory.\n\n" +
      "Use --snapshot-id to download a specific snapshot, or --app-id to " +
      "resolve the latest baseline (org auth tokens require --project with a " +
      "numeric project ID for --app-id).\n\n" +
      "This feature only works with Sentry SaaS.\n\n" +
      "Usage:\n" +
      "  sentry snapshots download --snapshot-id 1234567890\n" +
      "  sentry snapshots download --app-id my-app --branch main\n" +
      "  sentry snapshots download --app-id my-app --output ./baseline/",
  },
  output: {
    human: formatDownloadResult,
  },
  parameters: {
    flags: {
      "app-id": {
        kind: "parsed",
        parse: String,
        brief:
          "App identifier (e.g. my-app) to resolve the latest baseline; mutually exclusive with --snapshot-id",
        optional: true,
      },
      "snapshot-id": {
        kind: "parsed",
        parse: String,
        brief: "Direct snapshot artifact ID; mutually exclusive with --app-id",
        optional: true,
      },
      branch: {
        kind: "parsed",
        parse: String,
        brief: "Git branch filter (only with --app-id)",
        optional: true,
      },
      output: {
        kind: "parsed",
        parse: String,
        brief: `Directory for extracted images (default: ${DEFAULT_OUTPUT})`,
        optional: true,
      },
    },
    aliases: {
      o: "output",
    },
  },
  async *func(this: SentryContext, flags: DownloadFlags) {
    const resolved = await resolveOrg({ cwd: this.cwd });
    if (!resolved) {
      throw new ContextError("Organization", USAGE_HINT);
    }
    const { org } = resolved;
    const project = this.env.SENTRY_PROJECT?.trim() || undefined;

    const snapshotId = await resolveSnapshotId(org, flags, project);

    await waitForSnapshotArchive(org, snapshotId, () =>
      log.info("Building snapshot archive...")
    );

    log.info(`Downloading snapshot ${snapshotId}...`);
    const zip = await downloadSnapshotArchive(org, snapshotId);

    const output = resolve(this.cwd, flags.output ?? DEFAULT_OUTPUT);
    const imageCount = extractZipToDir(zip, output);

    yield new CommandOutput<SnapshotDownloadResult>({
      org,
      snapshotId,
      output,
      imageCount,
    });
    return {
      hint: `Downloaded ${imageCount} image(s) from snapshot ${snapshotId} to ${output}`,
    };
  },
});
