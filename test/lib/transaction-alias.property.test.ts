/**
 * Property-Based Tests for Transaction Alias Generation
 *
 * Uses fast-check to verify properties that should always hold true
 * for transaction alias functions, regardless of input.
 */

import { describe, expect, test } from "bun:test";
import {
  array,
  constantFrom,
  assert as fcAssert,
  property,
  tuple,
  uniqueArray,
} from "fast-check";
import {
  buildTransactionAliases,
  extractTransactionSegment,
} from "../../src/lib/transaction-alias.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.ts";

// Arbitraries for generating test data

/** Valid slug characters */
const slugChars = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Generate simple slug segments */
const simpleSegmentArb = array(constantFrom(...slugChars.split("")), {
  minLength: 1,
  maxLength: 15,
}).map((chars) => chars.join(""));

/** Generate URL path segments */
const urlSegmentArb = array(constantFrom(...slugChars.split("")), {
  minLength: 2,
  maxLength: 20,
}).map((chars) => chars.join(""));

/** Generate URL placeholder like {org}, {project_id} */
const placeholderArb = simpleSegmentArb.map((s) => `{${s}}`);

/** Generate URL-style transaction names */
const urlTransactionArb = tuple(
  array(constantFrom("api", "extensions", "webhooks", "v1", "v2", "internal"), {
    minLength: 1,
    maxLength: 2,
  }),
  array(placeholderArb, { minLength: 0, maxLength: 2 }),
  urlSegmentArb // The meaningful last segment
).map(([prefixes, placeholders, lastSegment]) => {
  const parts = [...prefixes, ...placeholders, lastSegment];
  return `/${parts.join("/")}/`;
});

/** Generate dotted task-style transaction names */
const taskTransactionArb = tuple(
  array(simpleSegmentArb, { minLength: 1, maxLength: 3 }),
  simpleSegmentArb
).map(([namespaces, lastSegment]) => [...namespaces, lastSegment].join("."));

/** Generate any valid transaction name */
const transactionArb = constantFrom("url", "task").chain((type) =>
  type === "url" ? urlTransactionArb : taskTransactionArb
);

/** Generate org slugs */
const orgSlugArb = simpleSegmentArb;

/** Generate project slugs */
const projectSlugArb = simpleSegmentArb;

/** Generate transaction input for alias building */
const transactionInputArb = tuple(
  transactionArb,
  orgSlugArb,
  projectSlugArb
).map(([transaction, orgSlug, projectSlug]) => ({
  transaction,
  orgSlug,
  projectSlug,
}));

// Properties for extractTransactionSegment

describe("property: extractTransactionSegment", () => {
  test("returns non-empty string for any valid transaction", () => {
    fcAssert(
      property(transactionArb, (transaction) => {
        const segment = extractTransactionSegment(transaction);
        expect(segment.length).toBeGreaterThan(0);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("returns lowercase string", () => {
    fcAssert(
      property(transactionArb, (transaction) => {
        const segment = extractTransactionSegment(transaction);
        expect(segment).toBe(segment.toLowerCase());
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("removes hyphens and underscores", () => {
    fcAssert(
      property(transactionArb, (transaction) => {
        const segment = extractTransactionSegment(transaction);
        expect(segment.includes("-")).toBe(false);
        expect(segment.includes("_")).toBe(false);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("does not return placeholder patterns", () => {
    fcAssert(
      property(transactionArb, (transaction) => {
        const segment = extractTransactionSegment(transaction);
        // Should not be a placeholder like {org}
        expect(segment.startsWith("{")).toBe(false);
        expect(segment.endsWith("}")).toBe(false);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("does not return purely numeric segments", () => {
    fcAssert(
      property(transactionArb, (transaction) => {
        const segment = extractTransactionSegment(transaction);
        // Should not be purely numeric like "0" from /api/0/
        expect(/^\d+$/.test(segment)).toBe(false);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("extracts last meaningful segment from URL paths", () => {
    // Specific test cases for URL paths
    const testCases = [
      ["/api/0/organizations/{org}/issues/", "issues"],
      ["/api/0/projects/{org}/{proj}/events/", "events"],
      ["/extensions/jira/issue-updated/", "issueupdated"],
      ["/webhooks/github/push/", "push"],
    ] as const;

    for (const [input, expected] of testCases) {
      expect(extractTransactionSegment(input)).toBe(expected);
    }
  });

  test("extracts last segment from dotted task names", () => {
    const testCases = [
      ["tasks.sentry.process_event", "processevent"],
      ["sentry.tasks.store.save_event", "saveevent"],
      ["celery.task.run", "run"],
    ] as const;

    for (const [input, expected] of testCases) {
      expect(extractTransactionSegment(input)).toBe(expected);
    }
  });
});

// Properties for buildTransactionAliases

describe("property: buildTransactionAliases", () => {
  test("returns same number of aliases as unique transactions", () => {
    fcAssert(
      property(
        array(transactionInputArb, { minLength: 1, maxLength: 10 }),
        (inputs) => {
          const aliases = buildTransactionAliases(inputs);
          expect(aliases.length).toBe(inputs.length);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("indices are 1-based and sequential", () => {
    fcAssert(
      property(
        array(transactionInputArb, { minLength: 1, maxLength: 10 }),
        (inputs) => {
          const aliases = buildTransactionAliases(inputs);

          for (let i = 0; i < aliases.length; i++) {
            expect(aliases[i]?.idx).toBe(i + 1);
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("aliases are non-empty and lowercase", () => {
    fcAssert(
      property(
        array(transactionInputArb, { minLength: 1, maxLength: 10 }),
        (inputs) => {
          const aliases = buildTransactionAliases(inputs);

          for (const entry of aliases) {
            expect(entry.alias.length).toBeGreaterThan(0);
            expect(entry.alias).toBe(entry.alias.toLowerCase());
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("preserves original transaction names", () => {
    fcAssert(
      property(
        array(transactionInputArb, { minLength: 1, maxLength: 10 }),
        (inputs) => {
          const aliases = buildTransactionAliases(inputs);

          for (let i = 0; i < inputs.length; i++) {
            expect(aliases[i]?.transaction).toBe(inputs[i]?.transaction);
            expect(aliases[i]?.orgSlug).toBe(inputs[i]?.orgSlug);
            expect(aliases[i]?.projectSlug).toBe(inputs[i]?.projectSlug);
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("aliases are unique when segments are unique", () => {
    // Generate inputs with guaranteed unique last segments
    fcAssert(
      property(
        tuple(
          orgSlugArb,
          projectSlugArb,
          uniqueArray(urlSegmentArb, {
            minLength: 2,
            maxLength: 5,
            comparator: (a, b) => a.toLowerCase() === b.toLowerCase(),
          })
        ),
        ([org, project, segments]) => {
          const inputs = segments.map((seg) => ({
            transaction: `/api/0/${seg}/`,
            orgSlug: org,
            projectSlug: project,
          }));

          const aliases = buildTransactionAliases(inputs);
          const aliasValues = aliases.map((a) => a.alias);
          const uniqueAliases = new Set(aliasValues);

          expect(uniqueAliases.size).toBe(aliasValues.length);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("empty input returns empty array", () => {
    const aliases = buildTransactionAliases([]);
    expect(aliases).toEqual([]);
  });

  test("deterministic results for same input", () => {
    fcAssert(
      property(
        array(transactionInputArb, { minLength: 1, maxLength: 10 }),
        (inputs) => {
          const result1 = buildTransactionAliases(inputs);
          const result2 = buildTransactionAliases(inputs);

          expect(result1.length).toBe(result2.length);

          for (let i = 0; i < result1.length; i++) {
            expect(result1[i]?.idx).toBe(result2[i]?.idx);
            expect(result1[i]?.alias).toBe(result2[i]?.alias);
            expect(result1[i]?.transaction).toBe(result2[i]?.transaction);
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

// Edge cases for extractTransactionSegment

describe("extractTransactionSegment edge cases", () => {
  test("returns 'txn' fallback for empty string", () => {
    expect(extractTransactionSegment("")).toBe("txn");
  });

  test("returns 'txn' fallback for placeholder-only transaction", () => {
    expect(extractTransactionSegment("/{org}/{project}/")).toBe("txn");
  });

  test("returns 'txn' fallback for purely numeric transaction", () => {
    expect(extractTransactionSegment("/0/1/2/")).toBe("txn");
  });

  test("returns 'txn' fallback for mixed placeholders and numerics", () => {
    expect(extractTransactionSegment("/{org}/0/{project}/1/")).toBe("txn");
  });

  test("handles single slash", () => {
    expect(extractTransactionSegment("/")).toBe("txn");
  });

  test("handles single dot", () => {
    expect(extractTransactionSegment(".")).toBe("txn");
  });
});

// Integration properties

describe("property: alias lookup invariants", () => {
  test("alias is a prefix of the extracted segment (unique transactions)", () => {
    // Use uniqueArray to avoid duplicate transactions, since disambiguateSegments
    // appends numeric suffixes to duplicates which breaks the prefix relationship
    // with the raw extracted segment.
    fcAssert(
      property(
        uniqueArray(transactionInputArb, {
          minLength: 1,
          maxLength: 10,
          comparator: (a, b) => a.transaction === b.transaction,
        }),
        (inputs) => {
          const aliases = buildTransactionAliases(inputs);

          for (const entry of aliases) {
            const segment = extractTransactionSegment(entry.transaction);
            expect(segment.startsWith(entry.alias)).toBe(true);
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("can reconstruct transaction from alias entry", () => {
    fcAssert(
      property(
        array(transactionInputArb, { minLength: 1, maxLength: 10 }),
        (inputs) => {
          const aliases = buildTransactionAliases(inputs);

          // Create lookup by alias
          const aliasMap = new Map(aliases.map((a) => [a.alias, a]));

          // Each alias should map back to a valid entry
          for (const entry of aliases) {
            const found = aliasMap.get(entry.alias);
            expect(found).toBeDefined();
            expect(found?.transaction).toBe(entry.transaction);
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
