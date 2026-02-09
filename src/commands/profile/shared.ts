/**
 * Shared utilities for profile commands.
 */

/** Valid period values for profiling queries */
export const VALID_PERIODS = ["1h", "24h", "7d", "14d", "30d"];

/**
 * Parse and validate a stats period string.
 *
 * @param value - Period string to validate
 * @returns The validated period string
 * @throws Error if the period is not in VALID_PERIODS
 */
export function parsePeriod(value: string): string {
  if (!VALID_PERIODS.includes(value)) {
    throw new Error(
      `Invalid period. Must be one of: ${VALID_PERIODS.join(", ")}`
    );
  }
  return value;
}
