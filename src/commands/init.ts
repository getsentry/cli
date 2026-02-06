/**
 * sentry init
 *
 * Initialize Sentry in your project using the Sentry Wizard.
 * Supports React Native, Flutter, iOS, Android, Cordova, Angular,
 * Electron, Next.js, Nuxt, Remix, SvelteKit, and sourcemaps setup.
 */

import { buildCommand } from "@stricli/core";
import type { SentryContext } from "../context.js";
import {
  getOrganization,
  getProject,
  getProjectKeys,
} from "../lib/api-client.js";
import { getAuthToken } from "../lib/db/auth.js";
import {
  getDefaultOrganization,
  getDefaultProject,
} from "../lib/db/defaults.js";
import { getSentryBaseUrl, isSentrySaasUrl } from "../lib/sentry-urls.js";
import {
  type PreSelectedProject,
  runWizard,
  type WizardOptions,
} from "../lib/wizard.js";

/**
 * Try to build preSelectedProject data from existing CLI auth.
 * Returns undefined if not authenticated or data fetch fails.
 */
async function tryBuildPreSelectedProject(
  orgSlug: string,
  projectSlug: string,
  urlOverride?: string
): Promise<PreSelectedProject | undefined> {
  const token = getAuthToken();
  if (!token) {
    return;
  }

  try {
    const [org, project, keys] = await Promise.all([
      getOrganization(orgSlug),
      getProject(orgSlug, projectSlug),
      getProjectKeys(orgSlug, projectSlug),
    ]);

    const dsn = keys[0]?.dsn?.public;
    if (!dsn) {
      return;
    }

    const baseUrl = urlOverride ?? getSentryBaseUrl();
    const selfHosted = !isSentrySaasUrl(baseUrl);

    return {
      authToken: token,
      selfHosted,
      dsn,
      id: project.id,
      projectSlug: project.slug,
      projectName: project.name,
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
    };
  } catch {
    return;
  }
}

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
  readonly "no-auth": boolean;
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
      "no-auth": {
        kind: "boolean",
        brief: "Don't pass existing CLI auth to wizard (force browser login)",
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

    // Auto-populate org from CLI config if not provided
    if (!options.org) {
      options.org = (await getDefaultOrganization()) ?? undefined;
    }

    // Auto-populate project from CLI config if not provided
    const projectSlug = options.project ?? (await getDefaultProject());

    // Try to share auth with wizard (unless --no-auth is set)
    if (!flags["no-auth"] && options.org && projectSlug) {
      const preSelected = await tryBuildPreSelectedProject(
        options.org,
        projectSlug,
        flags.url
      );
      if (preSelected) {
        options.preSelectedProject = preSelected;
        stdout.write(
          `Using existing Sentry auth for ${preSelected.orgSlug}/${preSelected.projectSlug}\n`
        );
      } else if (flags.debug) {
        stdout.write(
          "Could not fetch project data, wizard will prompt for login\n"
        );
      }
    }

    stdout.write("Starting Sentry Wizard...\n\n");

    await runWizard(options);
  },
});
