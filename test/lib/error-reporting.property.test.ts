/**
 * Property-Based Tests for Error Reporting Helpers
 *
 * Verifies grouping invariants that must hold across any user input:
 * - Two same-class + same-kind errors produce identical fingerprints
 *   regardless of the user-supplied slug/id/path embedded in them.
 * - Normalization helpers (`normalizeEndpoint`, `extractResourceKind`,
 *   `normalizeErrorMessage`) are stable across user-data variation and
 *   idempotent on already-normalized output.
 */

import { describe, expect, test } from "bun:test";
import {
  array,
  constantFrom,
  assert as fcAssert,
  integer,
  property,
  stringMatching,
} from "fast-check";
import {
  computeFingerprint,
  extractResourceKind,
  normalizeEndpoint,
  normalizeErrorMessage,
} from "../../src/lib/error-reporting.js";
import {
  ApiError,
  ContextError,
  ResolutionError,
  ValidationError,
} from "../../src/lib/errors.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

/** Lowercase alphanumeric slug with optional hyphens. */
const slugArb = array(
  constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
  { minLength: 1, maxLength: 25 }
)
  .map((chars) => chars.join(""))
  .filter((s) => !(s.startsWith("-") || s.endsWith("-")) && s.length > 0);

/** 32-character lowercase hex id (trace/event/log id). */
const hexIdArb = stringMatching(/^[0-9a-f]{32}$/).filter(
  (s) => s.length === 32
);

/** Arbitrary numeric id in the issue-id range (>= 6 digits). */
const numericIdArb = integer({ min: 100_000, max: 9_999_999_999 }).map(String);

/** Typical macOS user name. */
const usernameArb = array(
  constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
  { minLength: 1, maxLength: 12 }
).map((chars) => chars.join(""));

describe("normalizeEndpoint — property tests", () => {
  test("output is invariant under org slug variation", () => {
    fcAssert(
      property(slugArb, slugArb, (slugA, slugB) => {
        const a = normalizeEndpoint(`/api/0/organizations/${slugA}/issues/`);
        const b = normalizeEndpoint(`/api/0/organizations/${slugB}/issues/`);
        expect(a).toBe(b);
        expect(a).toBe("/api/0/organizations/{slug}/issues/");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output is invariant under project slug pair variation", () => {
    fcAssert(
      property(slugArb, slugArb, slugArb, slugArb, (oa, pa, ob, pb) => {
        const a = normalizeEndpoint(`/api/0/projects/${oa}/${pa}/events/`);
        const b = normalizeEndpoint(`/api/0/projects/${ob}/${pb}/events/`);
        expect(a).toBe(b);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output is invariant under numeric-id variation", () => {
    fcAssert(
      property(slugArb, numericIdArb, numericIdArb, (slug, id1, id2) => {
        const a = normalizeEndpoint(
          `/api/0/organizations/${slug}/issues/${id1}/`
        );
        const b = normalizeEndpoint(
          `/api/0/organizations/${slug}/issues/${id2}/`
        );
        expect(a).toBe(b);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("idempotent on already-normalized endpoints", () => {
    fcAssert(
      property(slugArb, (slug) => {
        const once = normalizeEndpoint(`/api/0/organizations/${slug}/issues/`);
        const twice = normalizeEndpoint(once);
        expect(twice).toBe(once);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("strips query strings regardless of content", () => {
    fcAssert(
      property(slugArb, slugArb, (slug, cursor) => {
        const out = normalizeEndpoint(
          `/api/0/organizations/${slug}/issues/?cursor=${cursor}&limit=10`
        );
        expect(out).not.toContain("?");
        expect(out).not.toContain("cursor");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("extractResourceKind — property tests", () => {
  test("single-quoted slug produces same kind for any slug", () => {
    fcAssert(
      property(slugArb, slugArb, (a, b) => {
        const ka = extractResourceKind(`Project '${a}'`);
        const kb = extractResourceKind(`Project '${b}'`);
        expect(ka).toBe(kb);
        expect(ka).toBe("Project");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("double-quoted slug produces same kind as single-quoted", () => {
    fcAssert(
      property(slugArb, (slug) => {
        expect(extractResourceKind(`Project '${slug}'`)).toBe(
          extractResourceKind(`Project "${slug}"`)
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("numeric-id stripping is slug-invariant", () => {
    fcAssert(
      property(numericIdArb, numericIdArb, (id1, id2) => {
        expect(extractResourceKind(`Issue ${id1} not found.`)).toBe(
          extractResourceKind(`Issue ${id2} not found.`)
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("hex-id stripping is slug-invariant", () => {
    fcAssert(
      property(hexIdArb, hexIdArb, (h1, h2) => {
        expect(extractResourceKind(`Trace ${h1} not found`)).toBe(
          extractResourceKind(`Trace ${h2} not found`)
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("trailing org/project slug pair collapses to placeholder", () => {
    fcAssert(
      property(slugArb, slugArb, slugArb, slugArb, (o1, p1, o2, p2) => {
        expect(extractResourceKind(`Event not found in ${o1}/${p1}.`)).toBe(
          extractResourceKind(`Event not found in ${o2}/${p2}.`)
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("idempotent on output", () => {
    fcAssert(
      property(slugArb, (slug) => {
        const once = extractResourceKind(`Project '${slug}' not found.`);
        expect(extractResourceKind(once)).toBe(once);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("normalizeErrorMessage — property tests", () => {
  test("macOS user path is user-invariant", () => {
    fcAssert(
      property(usernameArb, usernameArb, (u1, u2) => {
        const a = normalizeErrorMessage(`EPERM: open '/Users/${u1}/.config'`);
        const b = normalizeErrorMessage(`EPERM: open '/Users/${u2}/.config'`);
        expect(a).toBe(b);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("Linux user path is user-invariant", () => {
    fcAssert(
      property(usernameArb, usernameArb, (u1, u2) => {
        const a = normalizeErrorMessage(`Cannot read /home/${u1}/config`);
        const b = normalizeErrorMessage(`Cannot read /home/${u2}/config`);
        expect(a).toBe(b);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("leaves messages without user paths alone", () => {
    fcAssert(
      property(slugArb, (slug) => {
        // Generic API request messages without path context should pass through.
        const msg = `Failed to fetch ${slug}: 500 Internal Server Error`;
        expect(normalizeErrorMessage(msg)).toBe(msg);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("computeFingerprint — grouping invariants", () => {
  test("ContextError with same resource collapses across commands", () => {
    fcAssert(
      property(slugArb, slugArb, (slugA, slugB) => {
        const a = new ContextError(
          "Organization and project",
          `sentry issue view ${slugA}/<project>/<id>`
        );
        const b = new ContextError(
          "Organization and project",
          `sentry trace list ${slugB}/<project>`
        );
        expect(computeFingerprint(a)).toEqual(computeFingerprint(b));
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("ResolutionError collapses across different project slugs", () => {
    fcAssert(
      property(slugArb, slugArb, (slugA, slugB) => {
        const a = new ResolutionError(
          `Project '${slugA}'`,
          "not found",
          `sentry issue list <org>/${slugA}`
        );
        const b = new ResolutionError(
          `Project '${slugB}'`,
          "not found",
          `sentry issue list <org>/${slugB}`
        );
        expect(computeFingerprint(a)).toEqual(computeFingerprint(b));
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("ResolutionError collapses across different numeric issue IDs", () => {
    fcAssert(
      property(numericIdArb, numericIdArb, (id1, id2) => {
        const a = new ResolutionError(
          `Issue ${id1}`,
          "not found",
          "sentry issue view <id>"
        );
        const b = new ResolutionError(
          `Issue ${id2}`,
          "not found",
          "sentry issue view <id>"
        );
        expect(computeFingerprint(a)).toEqual(computeFingerprint(b));
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("ApiError collapses across different org slugs on same endpoint", () => {
    fcAssert(
      property(slugArb, slugArb, (orgA, orgB) => {
        const a = new ApiError(
          "API request failed: 400 Bad Request",
          400,
          undefined,
          `/api/0/organizations/${orgA}/`
        );
        const b = new ApiError(
          "API request failed: 400 Bad Request",
          400,
          undefined,
          `/api/0/organizations/${orgB}/`
        );
        expect(computeFingerprint(a)).toEqual(computeFingerprint(b));
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("ApiError fingerprints differ when status codes differ", () => {
    fcAssert(
      property(
        slugArb,
        constantFrom(400, 500, 502, 503),
        constantFrom(400, 500, 502, 503),
        (slug, s1, s2) => {
          if (s1 === s2) {
            return;
          }
          const a = new ApiError(
            "x",
            s1,
            undefined,
            `/api/0/organizations/${slug}/`
          );
          const b = new ApiError(
            "x",
            s2,
            undefined,
            `/api/0/organizations/${slug}/`
          );
          expect(computeFingerprint(a)).not.toEqual(computeFingerprint(b));
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("ValidationError with same field collapses across input values", () => {
    fcAssert(
      property(hexIdArb, hexIdArb, (v1, v2) => {
        const a = new ValidationError(
          `Invalid trace ID "${v1}". Expected 32 hex.`,
          "trace_id"
        );
        const b = new ValidationError(
          `Invalid trace ID "${v2}". Expected 32 hex.`,
          "trace_id"
        );
        expect(computeFingerprint(a)).toEqual(computeFingerprint(b));
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("ValidationError without field still collapses on same template", () => {
    fcAssert(
      property(slugArb, slugArb, (v1, v2) => {
        const a = new ValidationError(`Invalid trace ID "${v1}".`);
        const b = new ValidationError(`Invalid trace ID "${v2}".`);
        expect(computeFingerprint(a)).toEqual(computeFingerprint(b));
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
