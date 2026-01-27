/**
 * DSN Cache
 *
 * Read/write DSN detection cache to global config.
 * Enables instant DSN verification on subsequent runs.
 *
 * Cache is stored in ~/.sentry/cli.db under the dsn_cache table.
 *
 * This file re-exports from the db module for backward compatibility.
 */

export {
  clearDsnCache,
  getCachedDsn,
  isCacheValid,
  setCachedDsn,
  updateCachedResolution,
} from "../db/dsn-cache.js";
