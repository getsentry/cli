/**
 * General utility functions
 */

import { userInfo } from "node:os";

const ALL_DIGITS_PATTERN = /^\d+$/;

/**
 * Check if a string contains only digits (0-9).
 * Useful for distinguishing numeric IDs from slugs/short IDs.
 *
 * @example
 * isAllDigits("123456") // true
 * isAllDigits("PROJECT-ABC") // false
 * isAllDigits("abc123") // false
 * isAllDigits("") // false
 */
export function isAllDigits(str: string): boolean {
  return ALL_DIGITS_PATTERN.test(str);
}

/**
 * Determine the real (non-root) username of the invoking user.
 *
 * When running under `sudo`, `SUDO_USER` holds the original user's login name.
 * Falls back to `USER` / `USERNAME` env vars, then `os.userInfo()`.
 * Used for building `chown` instructions and messages.
 */
export function getRealUsername(): string {
  // userInfo() can throw on systems with missing or corrupted passwd entries.
  let osUsername = "";
  try {
    osUsername = userInfo().username;
  } catch {
    // Fall through to the "$(whoami)" literal below.
  }
  return (
    process.env.SUDO_USER ||
    process.env.USER ||
    process.env.USERNAME ||
    osUsername ||
    "$(whoami)"
  );
}
