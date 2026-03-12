/**
 * Product Trial Utilities
 *
 * Shared mapping between CLI-friendly trial names and Sentry API category names.
 * Used by `sentry trial list`, `sentry trial start`, and the Seer auto-prompt.
 *
 * The backend represents trial categories as API names like "seerUsers" or
 * "transactions". This module maps them to short CLI-friendly names ("seer",
 * "performance") and human-readable display names ("Seer", "Performance").
 */

import type { ProductTrial } from "../types/index.js";

/**
 * Trial name entry mapping a CLI-friendly name to API categories and display name.
 *
 * `categories` is ordered by preference — the first matching unstarted trial wins.
 * For Seer, `seerUsers` (seat-based) is preferred over `seerAutofix` (legacy).
 */
type TrialNameEntry = {
  /** API category names, ordered by preference */
  categories: string[];
  /** Human-readable product name */
  displayName: string;
};

/** Map from CLI-friendly names to API category info */
const TRIAL_NAMES: Record<string, TrialNameEntry> = {
  seer: { categories: ["seerUsers", "seerAutofix"], displayName: "Seer" },
  replays: { categories: ["replays"], displayName: "Session Replay" },
  performance: {
    categories: ["transactions"],
    displayName: "Performance",
  },
  spans: { categories: ["spans"], displayName: "Spans" },
  profiling: {
    categories: ["profileDuration"],
    displayName: "Profiling",
  },
  logs: { categories: ["logBytes"], displayName: "Logs" },
};

/** Reverse map: API category → CLI-friendly name */
const CATEGORY_TO_FRIENDLY: Record<string, string> = {};
for (const [name, entry] of Object.entries(TRIAL_NAMES)) {
  for (const cat of entry.categories) {
    // First mapping wins — seerUsers → "seer", seerAutofix → "seer"
    if (!(cat in CATEGORY_TO_FRIENDLY)) {
      CATEGORY_TO_FRIENDLY[cat] = name;
    }
  }
}

/** Reverse map: API category → display name */
const CATEGORY_TO_DISPLAY: Record<string, string> = {};
for (const entry of Object.values(TRIAL_NAMES)) {
  for (const cat of entry.categories) {
    if (!(cat in CATEGORY_TO_DISPLAY)) {
      CATEGORY_TO_DISPLAY[cat] = entry.displayName;
    }
  }
}

/**
 * Find an available (unstarted) trial matching a CLI-friendly name.
 *
 * Checks the trials array against the categories for the given name,
 * in preference order. Returns the first unstarted match, or null.
 *
 * @param trials - Array of product trials from the API
 * @param name - CLI-friendly name (e.g., "seer", "replays")
 * @returns The matching unstarted trial, or null
 */
export function findAvailableTrial(
  trials: ProductTrial[],
  name: string
): ProductTrial | null {
  const entry = TRIAL_NAMES[name];
  if (!entry) {
    return null;
  }

  for (const category of entry.categories) {
    const trial = trials.find((t) => t.category === category && !t.isStarted);
    if (trial) {
      return trial;
    }
  }
  return null;
}

/**
 * Get the human-readable display name for an API category.
 *
 * @param category - API category name (e.g., "seerUsers", "transactions")
 * @returns Display name (e.g., "Seer", "Performance"), or the raw category if unknown
 */
export function getTrialDisplayName(category: string): string {
  return CATEGORY_TO_DISPLAY[category] ?? category;
}

/**
 * Get the human-readable display name for a CLI-friendly trial name.
 *
 * Unlike {@link getTrialDisplayName} which looks up by API category,
 * this looks up by CLI name (e.g., "seer" → "Seer", "replays" → "Session Replay").
 *
 * @param name - CLI-friendly name (e.g., "seer", "performance")
 * @returns Display name (e.g., "Seer", "Performance"), or the raw name if unknown
 */
export function getDisplayNameForTrialName(name: string): string {
  return TRIAL_NAMES[name]?.displayName ?? name;
}

/**
 * Get the CLI-friendly name for an API category.
 *
 * @param category - API category name (e.g., "seerUsers", "transactions")
 * @returns Friendly name (e.g., "seer", "performance"), or the raw category if unknown
 */
export function getTrialFriendlyName(category: string): string {
  return CATEGORY_TO_FRIENDLY[category] ?? category;
}

/** Trial status derived from API fields */
export type TrialStatus = "available" | "active" | "expired";

/**
 * Derive the trial status from a ProductTrial's fields.
 *
 * - `isStarted=false` → "available"
 * - `isStarted=true` and `endDate` is in the future or today → "active"
 * - `isStarted=true` and `endDate` is in the past → "expired"
 *
 * @param trial - Product trial from the API
 * @returns Derived status
 */
export function getTrialStatus(trial: ProductTrial): TrialStatus {
  if (!trial.isStarted) {
    return "available";
  }

  if (trial.endDate) {
    const end = new Date(trial.endDate);
    const now = new Date();
    // Compare date-only (ignore time) — trial ends at end of endDate UTC
    end.setUTCHours(23, 59, 59, 999);
    if (now > end) {
      return "expired";
    }
  }

  return "active";
}

/**
 * Calculate days remaining for an active trial.
 *
 * @param trial - Product trial from the API
 * @returns Number of days remaining (0+), or null if not active or no end date
 */
export function getDaysRemaining(trial: ProductTrial): number | null {
  if (!(trial.isStarted && trial.endDate)) {
    return null;
  }

  const end = new Date(trial.endDate);
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * List all valid CLI-friendly trial names.
 *
 * @returns Array of names like ["seer", "replays", "performance", ...]
 */
export function getValidTrialNames(): string[] {
  return Object.keys(TRIAL_NAMES);
}

/**
 * Check if a string is a known CLI-friendly trial name.
 *
 * @param value - String to check
 * @returns true if it's a valid trial name
 */
export function isTrialName(value: string): boolean {
  return value in TRIAL_NAMES;
}
