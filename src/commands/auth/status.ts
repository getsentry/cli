/**
 * sentry auth status
 *
 * Display authentication status and verify credentials.
 */

import type { SentryContext } from "../../context.js";
import { listOrganizations } from "../../lib/api-client.js";
import { buildCommand } from "../../lib/command.js";
import {
  type AuthConfig,
  getAuthConfig,
  isAuthenticated,
} from "../../lib/db/auth.js";
import {
  getDefaultOrganization,
  getDefaultProject,
} from "../../lib/db/defaults.js";
import { getDbPath } from "../../lib/db/index.js";
import { getUserInfo } from "../../lib/db/user.js";
import { AuthError } from "../../lib/errors.js";
import { error, muted, success } from "../../lib/formatters/colors.js";
import {
  formatExpiration,
  formatUserIdentity,
  maskToken,
} from "../../lib/formatters/human.js";
import type { Writer } from "../../types/index.js";

type StatusFlags = {
  readonly showToken: boolean;
};

/**
 * Write user identity information
 */
function writeUserInfo(stdout: Writer): void {
  const user = getUserInfo();
  if (!user) {
    return;
  }
  stdout.write(`User: ${muted(formatUserIdentity(user))}\n`);
}

/**
 * Write token information
 */
function writeTokenInfo(
  stdout: Writer,
  auth: AuthConfig | undefined,
  showToken: boolean
): void {
  if (!auth?.token) {
    return;
  }

  const tokenDisplay = showToken ? auth.token : maskToken(auth.token);
  stdout.write(`Token: ${tokenDisplay}\n`);

  if (auth.expiresAt) {
    stdout.write(`Expires: ${formatExpiration(auth.expiresAt)}\n`);
  }

  // Show refresh token status
  if (auth.refreshToken) {
    stdout.write(`Auto-refresh: ${success("enabled")}\n`);
  } else {
    stdout.write("Auto-refresh: disabled (no refresh token)\n");
  }
}

/**
 * Write default settings
 */
async function writeDefaults(stdout: Writer): Promise<void> {
  const defaultOrg = await getDefaultOrganization();
  const defaultProject = await getDefaultProject();

  if (!(defaultOrg || defaultProject)) {
    return;
  }

  stdout.write("\nDefaults:\n");
  if (defaultOrg) {
    stdout.write(`  Organization: ${defaultOrg}\n`);
  }
  if (defaultProject) {
    stdout.write(`  Project: ${defaultProject}\n`);
  }
}

/**
 * Verify credentials by fetching organizations
 */
async function verifyCredentials(
  stdout: Writer,
  stderr: Writer
): Promise<void> {
  stdout.write("\nVerifying credentials...\n");

  try {
    const orgs = await listOrganizations();
    stdout.write(
      `\n${success("✓")} Access verified. You have access to ${orgs.length} organization(s):\n`
    );

    const maxDisplay = 5;
    for (const org of orgs.slice(0, maxDisplay)) {
      stdout.write(`  - ${org.name} (${org.slug})\n`);
    }
    if (orgs.length > maxDisplay) {
      stdout.write(`  ... and ${orgs.length - maxDisplay} more\n`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`\n${error("✗")} Could not verify credentials: ${message}\n`);
  }
}

export const statusCommand = buildCommand({
  docs: {
    brief: "View authentication status",
    fullDescription:
      "Display information about your current authentication status, " +
      "including whether you're logged in and your default organization/project settings.",
  },
  parameters: {
    flags: {
      showToken: {
        kind: "boolean",
        brief: "Show the stored token (masked by default)",
        default: false,
      },
    },
  },
  async func(this: SentryContext, flags: StatusFlags): Promise<void> {
    const { stdout, stderr } = this;

    const auth = await getAuthConfig();
    const authenticated = await isAuthenticated();

    stdout.write(`Config: ${getDbPath()}\n`);

    if (!authenticated) {
      // Skip auto-login - user explicitly ran status to check auth state
      throw new AuthError("not_authenticated", undefined, {
        skipAutoAuth: true,
      });
    }

    stdout.write(`Status: Authenticated ${success("✓")}\n`);
    writeUserInfo(stdout);
    stdout.write("\n");

    writeTokenInfo(stdout, auth, flags.showToken);
    await writeDefaults(stdout);
    await verifyCredentials(stdout, stderr);
  },
});
