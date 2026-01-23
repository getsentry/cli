/**
 * Alias generation utilities
 *
 * Functions for generating short, unique project aliases from project slugs.
 * Used by issue list to create short identifiers like "e" for "spotlight-electron".
 */

/**
 * Find the common word prefix shared by strings that have word boundaries.
 * Word boundaries are hyphens or underscores.
 *
 * For strings like ["spotlight-electron", "spotlight-website", "spotlight"],
 * finds "spotlight-" as the common prefix among strings with boundaries.
 * Strings without that boundary prefix (like "spotlight") will keep their full name.
 *
 * @param strings - Array of strings to find common prefix for
 * @returns Common prefix including the boundary character, or empty string if none
 *
 * @example
 * findCommonWordPrefix(["spotlight-electron", "spotlight-website", "spotlight"]) // "spotlight-"
 * findCommonWordPrefix(["frontend", "functions", "backend"]) // "" (no common word prefix)
 */
export function findCommonWordPrefix(strings: string[]): string {
  if (strings.length < 2) {
    return "";
  }

  // Extract first "word" (up to and including first boundary) from each string
  const getFirstWord = (s: string): string | null => {
    const lower = s.toLowerCase();
    const boundaryIdx = Math.max(lower.indexOf("-"), lower.indexOf("_"));
    if (boundaryIdx > 0) {
      return lower.slice(0, boundaryIdx + 1);
    }
    return null; // No boundary found
  };

  // Get first words from strings that have boundaries
  const firstWords: string[] = [];
  for (const s of strings) {
    const word = getFirstWord(s);
    if (word) {
      firstWords.push(word);
    }
  }

  // Need at least 2 strings with boundaries to find a common prefix
  if (firstWords.length < 2) {
    return "";
  }

  // Check if all strings with boundaries share the same first word
  const candidate = firstWords[0];
  if (!candidate) {
    return "";
  }

  const allMatch = firstWords.every((w) => w === candidate);
  if (!allMatch) {
    return "";
  }

  return candidate;
}

/**
 * Find the shortest unique prefix for each string in the array.
 * Similar to git's abbreviated commit hashes or terminal auto-completion.
 *
 * @param strings - Array of strings to find unique prefixes for
 * @returns Map from original string to its shortest unique prefix (lowercase)
 *
 * @example
 * findShortestUniquePrefixes(["frontend", "functions", "backend"])
 * // Map { "frontend" => "fr", "functions" => "fu", "backend" => "b" }
 */
export function findShortestUniquePrefixes(
  strings: string[]
): Map<string, string> {
  const result = new Map<string, string>();

  for (const str of strings) {
    const lowerStr = str.toLowerCase();
    let prefixLen = 1;

    // Find the shortest prefix that's unique among all strings
    while (prefixLen <= lowerStr.length) {
      const prefix = lowerStr.slice(0, prefixLen);
      const isUnique = strings.every((other) => {
        if (other === str) {
          return true;
        }
        return !other.toLowerCase().startsWith(prefix);
      });

      if (isUnique) {
        result.set(str, prefix);
        break;
      }
      prefixLen += 1;
    }

    // If no unique prefix found (shouldn't happen with different strings),
    // use the full string
    if (!result.has(str)) {
      result.set(str, lowerStr);
    }
  }

  return result;
}
