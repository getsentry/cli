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
import {
  formatExpiration,
  formatUserIdentity,
  maskToken,
} from "../../lib/formatters/human.js";
import {
  applyFreshFlag,
  FRESH_ALIASES,
  FRESH_FLAG,
} from "../../lib/list-command.js";
import { logger } from "../../lib/logger.js";

const log = logger.withTag("auth.status");

type StatusFlags = {
  readonly "show-token": boolean;
  readonly fresh: boolean;
};

/**
 * Log user identity information if available.
 */
function logUserInfo(): void {
  const user = getUserInfo();
  if (!user) {
    return;
  }
  log.info(`User: ${formatUserIdentity(user)}`);
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
 * Log token information.
 */
function logTokenInfo(auth: AuthConfig | undefined, showToken: boolean): void {
  if (!auth?.token) {
    return;
  }

  const tokenDisplay = showToken ? auth.token : maskToken(auth.token);
  log.info(`Token: ${tokenDisplay}`);

  // Env var tokens have no expiry or refresh — skip those sections
  if (isEnvSource(auth.source)) {
    return;
  }

  if (auth.expiresAt) {
    log.info(`Expires: ${formatExpiration(auth.expiresAt)}`);
  }

  // Show refresh token status
  if (auth.refreshToken) {
    log.info("Auto-refresh: enabled");
  } else {
    log.info("Auto-refresh: disabled (no refresh token)");
  }
}

/**
 * Log default org/project settings if configured.
 */
async function logDefaults(): Promise<void> {
  const defaultOrg = await getDefaultOrganization();
  const defaultProject = await getDefaultProject();

  if (!(defaultOrg || defaultProject)) {
    return;
  }

  log.info("Defaults:");
  if (defaultOrg) {
    log.info(`  Organization: ${defaultOrg}`);
  }
  if (defaultProject) {
    log.info(`  Project: ${defaultProject}`);
  }
}

/**
 * Verify credentials by fetching organizations.
 */
async function verifyCredentials(): Promise<void> {
  log.info("Verifying credentials...");

  try {
    const orgs = await listOrganizations();
    log.success(
      `Access verified. You have access to ${orgs.length} organization(s):`
    );

    const maxDisplay = 5;
    for (const org of orgs.slice(0, maxDisplay)) {
      log.info(`  - ${org.name} (${org.slug})`);
    }
    if (orgs.length > maxDisplay) {
      log.info(`  ... and ${orgs.length - maxDisplay} more`);
    }
  } catch (err) {
    const message = stringifyUnknown(err);
    log.error(`Could not verify credentials: ${message}`);
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
    aliases: FRESH_ALIASES,
  },
  async func(this: SentryContext, flags: StatusFlags): Promise<void> {
    applyFreshFlag(flags);

    const auth = await getAuthConfig();
    const authenticated = await isAuthenticated();
    const fromEnv = auth && isEnvSource(auth.source);

    // Show config path only for stored (OAuth) tokens — irrelevant for env vars
    if (!fromEnv) {
      log.info(`Config: ${getDbPath()}`);
    }

    if (!authenticated) {
      // Skip auto-login - user explicitly ran status to check auth state
      throw new AuthError("not_authenticated", undefined, {
        skipAutoAuth: true,
      });
    }

    if (fromEnv) {
      log.success(
        `Authenticated via ${envVarName(auth.source)} environment variable`
      );
    } else {
      log.success("Authenticated");
    }
    logUserInfo();

    logTokenInfo(auth, flags["show-token"]);
    await logDefaults();
    await verifyCredentials();
  },
});
