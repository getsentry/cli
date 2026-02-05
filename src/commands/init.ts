/**
 * sentry init
 *
 * Initialize Sentry in your project using the Sentry Wizard.
 * Supports React Native, Flutter, iOS, Android, Cordova, Angular,
 * Electron, Next.js, Nuxt, Remix, SvelteKit, and sourcemaps setup.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../context.js";
import { getDefaultOrganization } from "../lib/db/defaults.js";
import { runWizard, type WizardOptions } from "../lib/wizard.js";

type InitFlags = {
  readonly integration?: string;
  readonly org?: string;
  readonly project?: string;
  readonly url?: string;
  readonly debug: boolean;
  readonly uninstall: boolean;
  readonly quiet: boolean;
  readonly "skip-connect": boolean;
  readonly saas: boolean;
  readonly signup: boolean;
  readonly "disable-telemetry": boolean;
};

export const initCommand = buildCommand({
  docs: {
    brief: "Initialize Sentry in your project",
    fullDescription:
      "Set up Sentry in your project using the Sentry Wizard.\n\n" +
      "Supported platforms: React Native, Flutter, iOS, Android, Cordova, Angular,\n" +
      "Electron, Next.js, Nuxt, Remix, SvelteKit, and sourcemaps.\n\n" +
      "Examples:\n" +
      "  sentry init                    # Interactive setup\n" +
      "  sentry init -i nextjs          # Setup for Next.js\n" +
      "  sentry init -i reactNative     # Setup for React Native\n" +
      "  sentry init --uninstall        # Remove Sentry from project",
  },
  parameters: {
    flags: {
      integration: {
        kind: "parsed",
        parse: String,
        brief: "Integration to setup (nextjs, reactNative, flutter, etc.)",
        optional: true,
        variadic: false,
      },
      org: {
        kind: "parsed",
        parse: String,
        brief: "Sentry organization slug",
        optional: true,
        variadic: false,
      },
      project: {
        kind: "parsed",
        parse: String,
        brief: "Sentry project slug",
        optional: true,
        variadic: false,
      },
      url: {
        kind: "parsed",
        parse: String,
        brief: "Sentry URL (for self-hosted)",
        optional: true,
        variadic: false,
      },
      debug: {
        kind: "boolean",
        brief: "Enable verbose logging",
        default: false,
      },
      uninstall: {
        kind: "boolean",
        brief: "Revert project setup",
        default: false,
      },
      quiet: {
        kind: "boolean",
        brief: "Don't prompt for input",
        default: false,
      },
      "skip-connect": {
        kind: "boolean",
        brief: "Skip connecting to Sentry server",
        default: false,
      },
      saas: {
        kind: "boolean",
        brief: "Skip self-hosted/SaaS selection",
        default: false,
      },
      signup: {
        kind: "boolean",
        brief: "Redirect to signup if not logged in",
        default: false,
      },
      "disable-telemetry": {
        kind: "boolean",
        brief: "Don't send telemetry to Sentry",
        default: false,
      },
    },
    aliases: { i: "integration", u: "url", s: "signup" },
  },
  async func(this: SentryContext, flags: InitFlags): Promise<void> {
    const { stdout } = this;

    // Build wizard options from our flags
    const options: WizardOptions = {
      integration: flags.integration,
      org: flags.org,
      project: flags.project,
      url: flags.url,
      debug: flags.debug,
      uninstall: flags.uninstall,
      quiet: flags.quiet,
      skipConnect: flags["skip-connect"],
      saas: flags.saas,
      signup: flags.signup,
      disableTelemetry: flags["disable-telemetry"],
    };

    // Auto-populate org from CLI config if not provided and user is authenticated
    if (!options.org) {
      const defaultOrg = await getDefaultOrganization();
      if (defaultOrg) {
        options.org = defaultOrg;
        stdout.write(`Using organization: ${defaultOrg}\n`);
      }
    }

    stdout.write("Starting Sentry Wizard...\n\n");

    await runWizard(options);
  },
});
