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

// Connection management
export {
  CONFIG_DIR_ENV_VAR,
  DEFAULT_CONFIG_DIR_NAME,
  DB_FILENAME,
  CACHE_TTL_MS,
  getConfigDir,
  getDbPath,
  getDatabase,
  closeDatabase,
} from "./db/index.js";

// Auth
export {
  REFRESH_THRESHOLD,
  DEFAULT_TOKEN_LIFETIME_MS,
  getAuthToken,
  getAuthConfig,
  setAuthToken,
  clearAuth,
  isAuthenticated,
  refreshToken,
  type AuthConfig,
  type RefreshTokenOptions,
  type RefreshTokenResult,
} from "./db/auth.js";

// Defaults
export {
  getDefaultOrganization,
  getDefaultProject,
  setDefaults,
} from "./db/defaults.js";

// Project cache
export {
  getCachedProject,
  setCachedProject,
  getCachedProjectByDsnKey,
  setCachedProjectByDsnKey,
  clearProjectCache,
} from "./db/project-cache.js";

// Project aliases
export {
  setProjectAliases,
  getProjectAliases,
  getProjectByAlias,
  clearProjectAliases,
} from "./db/project-aliases.js";

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
