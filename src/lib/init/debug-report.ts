/**
 * Debug Report
 *
 * After a wizard failure, offers to send a reproduction bundle to the Sentry
 * team: a tar.gz of the project, structured error metadata, and optionally
 * the local config DB (which contains the auth token and user info needed to
 * reproduce Sentry API calls with the user's exact setup).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
// biome-ignore lint/performance/noNamespaceImport: Sentry SDK recommends namespace import
import * as Sentry from "@sentry/node-core/light";
import { isCancel, log, select, spinner as clackSpinner } from "@clack/prompts";
import { CLI_VERSION, getConfiguredSentryUrl } from "../constants.js";
import { getAuthToken } from "../db/auth.js";
import { getDbPath } from "../db/index.js";
import { getUserInfo } from "../db/user.js";
import type { DirEntry, WizardOptions } from "./types.js";

export type DebugReportContext = {
  error: string;
  traceId: string;
  directory: string;
  dirListing?: DirEntry[];
  platform?: string;
  exitCode?: number;
};

/**
 * Create a gzipped tar archive of the project directory.
 * Excludes common large/irrelevant directories. Returns null if tar is unavailable.
 */
function createProjectArchive(directory: string): Buffer | null {
  try {
    return execFileSync(
      "tar",
      [
        "czf",
        "-",
        "--exclude=node_modules",
        "--exclude=.git",
        "--exclude=dist",
        "--exclude=build",
        "--exclude=.next",
        "--exclude=out",
        "--exclude=.turbo",
        "--exclude=coverage",
        "--exclude=*.log",
        "-C",
        directory,
        ".",
      ],
      { maxBuffer: 20 * 1024 * 1024 }
    ) as unknown as Buffer;
  } catch {
    return null;
  }
}

/**
 * After a wizard error, prompt the user to send a debug bundle.
 * Skipped silently in non-interactive mode (--yes) or when telemetry is off.
 */
export async function offerDebugReport(
  ctx: DebugReportContext,
  options: Pick<WizardOptions, "yes">
): Promise<void> {
  if (options.yes || !process.stdin.isTTY || !Sentry.isEnabled()) return;

  const choice = await select({
    message: "Help us fix this? We'll send a debug report to the Sentry team.",
    options: [
      {
        value: "yes",
        label: "Yes — send project files and error details",
        hint: "tar.gz of your project (no node_modules/.git) + error trace",
      },
      {
        value: "yes-token",
        label: "Yes — also include my auth token and config DB",
        hint: "Lets us reproduce with your exact Sentry setup. Includes cli.db (auth, user info). Only accessible to the Sentry team.",
      },
      { value: "no", label: "No thanks" },
    ],
    initialValue: "no",
  });

  if (isCancel(choice) || choice === "no") return;

  const spin = clackSpinner();
  spin.start("Preparing debug bundle...");

  const archiveBuffer = createProjectArchive(ctx.directory);

  const meta: Record<string, unknown> = {
    error: ctx.error,
    exitCode: ctx.exitCode,
    traceId: ctx.traceId,
    platform: ctx.platform,
    projectDir: path.basename(ctx.directory),
    cliVersion: CLI_VERSION,
    os: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    sentryHost: getConfiguredSentryUrl() ?? "sentry.io",
    hasProjectArchive: !!archiveBuffer,
  };

  if (choice === "yes-token") {
    const token = getAuthToken();
    if (token) meta.authToken = token;
    const user = getUserInfo();
    if (user?.email) meta.sentryEmail = user.email;
  }

  Sentry.withScope((scope) => {
    scope.setExtra("debugReport", meta);

    if (archiveBuffer) {
      scope.addAttachment({
        filename: "project.tar.gz",
        data: archiveBuffer,
        contentType: "application/gzip",
      });
    } else if (ctx.dirListing) {
      // tar unavailable (Windows?) — attach directory structure as fallback
      scope.addAttachment({
        filename: "project-structure.json",
        data: Buffer.from(JSON.stringify(ctx.dirListing, null, 2)),
        contentType: "application/json",
      });
    }

    scope.addAttachment({
      filename: "debug-report.json",
      data: Buffer.from(JSON.stringify(meta, null, 2)),
      contentType: "application/json",
    });

    // Include the local SQLite config DB (auth token, user info, caches).
    // Only when the user explicitly consented to sharing credentials.
    if (choice === "yes-token") {
      try {
        scope.addAttachment({
          filename: "cli.db",
          data: readFileSync(getDbPath()),
          contentType: "application/octet-stream",
        });
      } catch {
        // DB may not exist or be locked — skip silently
      }
    }

    Sentry.captureMessage("Init wizard debug report", "info");
  });

  spin.message("Sending...");
  await Sentry.flush(5000);
  spin.stop("Debug bundle sent. Thank you!");
}
