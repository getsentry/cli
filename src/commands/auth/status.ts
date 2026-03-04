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
  type AuthSource,
  ENV_SOURCE_PREFIX,
  getAuthConfig,
  isAuthenticated,
} from "../../lib/db/auth.js";
import {
  getDefaultOrganization,
  getDefaultProject,
} from "../../lib/db/defaults.js";
import { getDbPath } from "../../lib/db/index.js";
import { getUserInfo } from "../../lib/db/user.js";
import { AuthError, stringifyUnknown } from "../../lib/errors.js";
import { error, muted, success } from "../../lib/formatters/colors.js";
import {
  formatExpiration,
  formatUserIdentity,
  maskToken,
} from "../../lib/formatters/human.js";
import { applyFreshFlag, FRESH_FLAG } from "../../lib/list-command.js";
import type { Writer } from "../../types/index.js";

type StatusFlags = {
  readonly "show-token": boolean;
  readonly fresh: boolean;
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

/** Check if the auth source is an environment variable */
function isEnvSource(source: AuthSource): boolean {
  return source.startsWith(ENV_SOURCE_PREFIX);
}

/** Extract the env var name from an env-based AuthSource (e.g. "env:SENTRY_AUTH_TOKEN" → "SENTRY_AUTH_TOKEN") */
function envVarName(source: AuthSource): string {
  return source.slice(ENV_SOURCE_PREFIX.length);
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

  // Env var tokens have no expiry or refresh — skip those sections
  if (isEnvSource(auth.source)) {
    return;
  }

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
    const message = stringifyUnknown(err);
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
      "show-token": {
        kind: "boolean",
        brief: "Show the stored token (masked by default)",
        default: false,
      },
      fresh: FRESH_FLAG,
    },
    aliases: { f: "fresh" },
  },
  async func(this: SentryContext, flags: StatusFlags): Promise<void> {
    applyFreshFlag(flags);
    const { stdout, stderr } = this;

    const auth = await getAuthConfig();
    const authenticated = await isAuthenticated();
    const fromEnv = auth && isEnvSource(auth.source);

    // Show config path only for stored (OAuth) tokens — irrelevant for env vars
    if (!fromEnv) {
      stdout.write(`Config: ${getDbPath()}\n`);
    }

    if (!authenticated) {
      // Skip auto-login - user explicitly ran status to check auth state
      throw new AuthError("not_authenticated", undefined, {
        skipAutoAuth: true,
      });
    }

    if (fromEnv) {
      stdout.write(
        `Status: Authenticated via ${envVarName(auth.source)} environment variable ${success("✓")}\n`
      );
    } else {
      stdout.write(`Status: Authenticated ${success("✓")}\n`);
    }
    writeUserInfo(stdout);
    stdout.write("\n");

    writeTokenInfo(stdout, auth, flags["show-token"]);
    await writeDefaults(stdout);
    await verifyCredentials(stdout, stderr);
  },
});
