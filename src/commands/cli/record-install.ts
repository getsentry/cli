/**
 * sentry cli record-install
 *
 * Record installation metadata for use by upgrade command.
 * This is typically called automatically by installation scripts
 * and should not need to be run manually.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { CLI_VERSION } from "../../lib/constants.js";
import { setInstallInfo } from "../../lib/db/install-info.js";
import {
  type InstallationMethod,
  parseInstallationMethod,
} from "../../lib/upgrade.js";

type RecordInstallFlags = {
  readonly method: InstallationMethod;
  readonly path?: string;
};

export const recordInstallCommand = buildCommand({
  docs: {
    brief: "Record installation metadata (used by installers)",
    fullDescription:
      "Records how this CLI was installed. This is typically called automatically\n" +
      "by installation scripts (curl, package managers) and should not need to be\n" +
      "run manually.\n\n" +
      "The recorded information is used by 'sentry cli upgrade' to determine\n" +
      "the appropriate upgrade method without re-detecting every time.\n\n" +
      "Examples:\n" +
      "  sentry cli record-install --method curl\n" +
      "  sentry cli record-install --method npm --path /usr/local/bin/sentry",
  },
  parameters: {
    flags: {
      method: {
        kind: "parsed",
        parse: parseInstallationMethod,
        brief: "Installation method (curl, npm, pnpm, bun, yarn)",
        placeholder: "method",
      },
      path: {
        kind: "parsed",
        parse: String,
        brief: "Binary path (defaults to current executable)",
        optional: true,
        placeholder: "path",
      },
    },
  },
  func(this: SentryContext, flags: RecordInstallFlags): void {
    const installPath = flags.path ?? this.process.execPath;

    setInstallInfo({
      method: flags.method,
      path: installPath,
      version: CLI_VERSION,
    });

    // Silent success for scripted usage - installers don't need output
  },
});
