/**
 * Configuration Management
 *
 * This module provides the public API for CLI configuration storage.
 * Data is stored in ~/.sentry/cli.db (SQLite) for concurrent-safe access.
 *
 * This file serves as a compatibility layer, re-exporting functions
 * from the db modules to maintain backward compatibility.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports from db modules
// ─────────────────────────────────────────────────────────────────────────────

// Auth
export {
  type AuthConfig,
  clearAuth,
  DEFAULT_TOKEN_LIFETIME_MS,
  getAuthConfig,
  getAuthToken,
  isAuthenticated,
  REFRESH_THRESHOLD,
  type RefreshTokenOptions,
  type RefreshTokenResult,
  refreshToken,
  setAuthToken,
} from "./db/auth.js";
// Defaults
export {
  getDefaultOrganization,
  getDefaultProject,
  setDefaults,
} from "./db/defaults.js";
// Connection management
export {
  CACHE_TTL_MS,
  CONFIG_DIR_ENV_VAR,
  closeDatabase,
  DB_FILENAME,
  DEFAULT_CONFIG_DIR_NAME,
  getConfigDir,
  getDatabase,
  getDbPath,
} from "./db/index.js";
// Project aliases
export {
  clearProjectAliases,
  getProjectAliases,
  getProjectByAlias,
  setProjectAliases,
} from "./db/project-aliases.js";
// Project cache
export {
  clearProjectCache,
  getCachedProject,
  getCachedProjectByDsnKey,
  setCachedProject,
  setCachedProjectByDsnKey,
} from "./db/project-cache.js";

// ─────────────────────────────────────────────────────────────────────────────
// Legacy compatibility
// ─────────────────────────────────────────────────────────────────────────────

import { getDbPath } from "./db/index.js";

/**
 * Get the config file path (for display purposes).
 *
 * @deprecated Use getDbPath() instead. This returns the database path.
 */
export function getConfigPath(): string {
  return getDbPath();
}
