/**
 * Sentry data retention constants
 *
 * Central place for the "maximum age past which this entity is gone" values
 * we reference in error messages, retention hints, and scan-window defaults.
 *
 * These are product facts about Sentry, not CLI behavior — changing one
 * should match a documented Sentry retention policy. Keep the comments
 * up-to-date with the source documentation.
 *
 * Usage:
 *
 * - Recovery / fuzzy scans pick `SCAN_PERIODS[entity]` as a default window.
 * - "Not found" error messages reference `RETENTION_DAYS[entity]` when we
 *   can speak with certainty (UUIDv7 timestamps on logs).
 */

import type { HexEntityType } from "./hex-id-recovery.js";

/**
 * Hard retention cap, in days, per entity type.
 *
 * - `log`: 90 days — a global Sentry product limit (all plans).
 * - `event` / `trace`: `null` because retention is plan-dependent. The CLI
 *   can't assume a value without querying the org's settings, so callers
 *   that need a precise statement should check `null` and fall back to a
 *   generic retention hint.
 * - `span`: tied to trace retention (spans live within traces).
 */
export const RETENTION_DAYS: Record<HexEntityType, number | null> = {
  log: 90,
  event: null,
  trace: null,
  span: null,
};

/**
 * Default scan window for fuzzy recovery (`<entity> view <prefix>`).
 *
 * Wider than UI-facing list defaults because recovery should maximize the
 * chance of finding the full ID a user copy-pasted. Callers can override
 * via `LookupContext.period` when the user passed an explicit `--period`.
 *
 * Values reflect the maximum useful retention window per entity:
 *
 * - `event`: 90 days — matches the `issue list` default, which is the
 *   same data source for finding events.
 * - `trace` / `log` / `span`: 30 days — spans/logs commonly become sparse
 *   past 30 days, and the API's default range is tighter here.
 */
export const SCAN_PERIODS: Record<HexEntityType, string> = {
  event: "90d",
  trace: "30d",
  log: "30d",
  span: "30d",
};

/**
 * Log retention as a Sentry-API `statsPeriod` string (e.g. "90d").
 *
 * Derived from {@link RETENTION_DAYS} so `api/logs.ts#getLogs` and the
 * recovery module never drift — a single edit to `RETENTION_DAYS.log`
 * updates both the numeric retention cap and the period string the API
 * sees.
 */
export const LOG_RETENTION_PERIOD = `${RETENTION_DAYS.log ?? 90}d`;
