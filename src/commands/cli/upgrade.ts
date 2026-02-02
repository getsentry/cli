/**
 * sentry cli upgrade
 *
 * Self-update the Sentry CLI to the latest or a specific version.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../../context.js";
import { CLI_VERSION } from "../../lib/constants.js";
import { UpgradeError } from "../../lib/errors.js";
import {
  detectInstallationMethod,
  executeUpgrade,
  fetchLatestVersion,
  type InstallationMethod,
  parseInstallationMethod,
  VERSION_PREFIX_REGEX,
  versionExists,
} from "../../lib/upgrade.js";

type UpgradeFlags = {
  readonly check: boolean;
  readonly method?: InstallationMethod;
};

export const upgradeCommand = buildCommand({
  docs: {
    brief: "Update the Sentry CLI to the latest version",
    fullDescription:
      "Check for updates and upgrade the Sentry CLI to the latest or a specific version.\n\n" +
      "By default, detects how the CLI was installed (npm, curl, etc.) and uses the same method to upgrade.\n\n" +
      "Examples:\n" +
      "  sentry cli upgrade              # Update to latest version\n" +
      "  sentry cli upgrade 0.5.0        # Update to specific version\n" +
      "  sentry cli upgrade --check      # Check for updates without installing\n" +
      "  sentry cli upgrade --method npm # Force using npm to upgrade",
  },
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Target version to install (defaults to latest)",
          parse: String,
          placeholder: "version",
          optional: true,
        },
      ],
    },
    flags: {
      check: {
        kind: "boolean",
        brief: "Check for updates without installing",
        default: false,
      },
      method: {
        kind: "parsed",
        parse: parseInstallationMethod,
        brief: "Installation method to use (curl, npm, pnpm, bun, yarn)",
        optional: true,
        placeholder: "method",
      },
    },
  },
  async func(
    this: SentryContext,
    flags: UpgradeFlags,
    version?: string
  ): Promise<void> {
    const { stdout } = this;

    // Detect or use specified installation method
    const method = flags.method ?? (await detectInstallationMethod());

    if (method === "unknown") {
      throw new UpgradeError("unknown_method");
    }

    stdout.write(`Installation method: ${method}\n`);
    stdout.write(`Current version: ${CLI_VERSION}\n`);

    // Fetch latest version
    const latest = await fetchLatestVersion(method);
    const target = version?.replace(VERSION_PREFIX_REGEX, "") ?? latest;

    stdout.write(`Latest version: ${latest}\n`);

    if (version) {
      stdout.write(`Target version: ${target}\n`);
    }

    // Check-only mode
    if (flags.check) {
      if (CLI_VERSION === target) {
        stdout.write("\nYou are already on the target version.\n");
      } else {
        const cmd = version
          ? `sentry cli upgrade ${target}`
          : "sentry cli upgrade";
        stdout.write(`\nRun '${cmd}' to update.\n`);
      }
      return;
    }

    // Already up to date
    if (CLI_VERSION === target) {
      stdout.write("\nAlready up to date.\n");
      return;
    }

    // Validate version exists (only for user-specified versions)
    if (version) {
      const exists = await versionExists(method, target);
      if (!exists) {
        throw new UpgradeError(
          "version_not_found",
          `Version ${target} not found`
        );
      }
    }

    // Execute upgrade
    stdout.write(`\nUpgrading to ${target}...\n`);
    await executeUpgrade(method, target);

    stdout.write(`\nSuccessfully upgraded to ${target}.\n`);
  },
});
