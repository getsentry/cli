/**
 * General utility functions
 */

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
