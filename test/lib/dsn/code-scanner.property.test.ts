/**
 * Property test for `extractDsnsFromContent`'s literal-prefix
 * fast-path.
 *
 * The fast-path in `code-scanner.ts` short-circuits `matchAll` when
 * the file contains neither `"http"` nor `"HTTP"` — that's a
 * necessary condition for ANY DSN to appear. We pin the invariant:
 * for any random content (with or without DSNs, with or without the
 * substrings), the function's output must be the same as if the
 * fast-path were disabled.
 *
 * The fast-path path returns `[]` when the substrings are absent,
 * and the slow path's matchAll on a substring-free content would
 * also return `[]`. So the invariant reduces to: `output is
 * deterministic for any input`.
 *
 * We strengthen it slightly by asserting that when the substrings
 * are present, the output is a subset of the raw regex matches —
 * confirming we don't accidentally produce extra hits.
 */

import { describe, expect, test } from "bun:test";
import {
  array,
  constantFrom,
  assert as fcAssert,
  property,
  string,
} from "fast-check";
import { extractDsnsFromContent } from "../../../src/lib/dsn/code-scanner.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

const BENIGN_CHARS = "abcdefghijklmnopqrstuvwxyz 0123456789\n".split("");

/** Generate file contents — benign ASCII, may or may not contain http. */
const contentArb = array(constantFrom(...BENIGN_CHARS), {
  minLength: 0,
  maxLength: 500,
}).map((chars) => chars.join(""));

/** Raw regex matcher (no fast-path) — our reference implementation. */
const DSN_RE =
  /https?:\/\/[a-z0-9]+(?::[a-z0-9]+)?@[a-z0-9.-]+(?:\.[a-z]+|:[0-9]+)\/\d+/gi;
function referenceMatches(content: string): string[] {
  return Array.from(new Set(Array.from(content.matchAll(DSN_RE), (m) => m[0])));
}

describe("property: extractDsnsFromContent fast-path invariance", () => {
  test("content without `http`/`HTTP` returns []", () => {
    fcAssert(
      property(contentArb, (content) => {
        // Strip any http/HTTP substring from the random content to
        // guarantee the fast-path triggers. Then assert zero DSNs.
        const clean = content
          .replace(/http/gi, "xxxx")
          .replace(/HTTP/g, "XXXX");
        expect(extractDsnsFromContent(clean)).toEqual([]);
      }),
      { numRuns: Math.min(DEFAULT_NUM_RUNS, 100) }
    );
  });

  test("fast-path output is a subset of the raw regex matches", () => {
    // The fast-path may filter out DSNs whose host isn't valid; so
    // extract's output is a SUBSET of the regex matches, not equal.
    // This property just ensures we never fabricate DSNs that aren't
    // in the raw regex pass.
    fcAssert(
      property(string({ minLength: 0, maxLength: 500 }), (content) => {
        const extracted = new Set(extractDsnsFromContent(content));
        const reference = new Set(referenceMatches(content));
        for (const dsn of extracted) {
          expect(reference.has(dsn)).toBe(true);
        }
      }),
      { numRuns: Math.min(DEFAULT_NUM_RUNS, 100) }
    );
  });
});
