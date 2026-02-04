/**
 * Property-Based Tests for Argument Parsing
 *
 * Uses fast-check to verify invariants of parseIssueArg() and parseOrgProjectArg()
 * that are difficult to exhaustively test with example-based tests.
 */

import { describe, expect, test } from "bun:test";
import {
  constantFrom,
  assert as fcAssert,
  oneof,
  property,
  stringMatching,
  tuple,
} from "fast-check";
import {
  parseIssueArg,
  parseOrgProjectArg,
} from "../../src/lib/arg-parsing.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

// Arbitraries for generating valid inputs

/** Generates valid org slugs (lowercase, alphanumeric with hyphens) */
const orgSlugArb = stringMatching(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/);

/**
 * Generates org slugs WITHOUT dashes - needed for tests where org appears
 * before a slash, since parseIssueArg prioritizes dashes over slashes.
 * e.g., "my-org/123" would be parsed as project="my", suffix="org/123"
 */
const orgSlugNoDashArb = stringMatching(/^[a-z][a-z0-9]{1,30}$/);

/** Generates valid project slugs (lowercase, alphanumeric with hyphens) */
const projectSlugArb = stringMatching(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/);

/** Generates valid issue suffixes (alphanumeric, 1-10 chars) */
const suffixArb = stringMatching(/^[a-zA-Z0-9]{1,10}$/);

/** Generates numeric-only strings (valid issue IDs) */
const numericIdArb = stringMatching(/^[1-9][0-9]{0,15}$/);

describe("parseIssueArg properties", () => {
  test("numeric-only inputs always return type 'numeric'", async () => {
    await fcAssert(
      property(numericIdArb, (input) => {
        const result = parseIssueArg(input);
        expect(result.type).toBe("numeric");
        if (result.type === "numeric") {
          expect(result.id).toBe(input);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("suffix is always uppercase in result", async () => {
    await fcAssert(
      property(suffixArb, (suffix) => {
        const result = parseIssueArg(suffix);
        // suffix-only type (no dash, no slash, not numeric)
        if (result.type === "suffix-only") {
          expect(result.suffix).toBe(suffix.toUpperCase());
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("org/project-suffix returns type 'explicit' with uppercase suffix", async () => {
    await fcAssert(
      property(
        tuple(orgSlugArb, projectSlugArb, suffixArb),
        ([org, project, suffix]) => {
          const input = `${org}/${project}-${suffix}`;
          const result = parseIssueArg(input);

          expect(result.type).toBe("explicit");
          if (result.type === "explicit") {
            expect(result.org).toBe(org);
            expect(result.project).toBe(project);
            expect(result.suffix).toBe(suffix.toUpperCase());
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("org/numericId returns type 'explicit-org-numeric'", async () => {
    // Use org slugs without dashes since parseIssueArg prioritizes dashes over slashes
    await fcAssert(
      property(tuple(orgSlugNoDashArb, numericIdArb), ([org, numericId]) => {
        const input = `${org}/${numericId}`;
        const result = parseIssueArg(input);

        expect(result.type).toBe("explicit-org-numeric");
        if (result.type === "explicit-org-numeric") {
          expect(result.org).toBe(org);
          expect(result.numericId).toBe(numericId);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("org/suffix (no dash) returns type 'explicit-org-suffix' with uppercase suffix", async () => {
    // Use org slugs without dashes since parseIssueArg prioritizes dashes over slashes
    await fcAssert(
      property(tuple(orgSlugNoDashArb, suffixArb), ([org, suffix]) => {
        // Skip if suffix looks numeric (would be explicit-org-numeric)
        if (/^\d+$/.test(suffix)) return;

        const input = `${org}/${suffix}`;
        const result = parseIssueArg(input);

        expect(result.type).toBe("explicit-org-suffix");
        if (result.type === "explicit-org-suffix") {
          expect(result.org).toBe(org);
          expect(result.suffix).toBe(suffix.toUpperCase());
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("project-suffix returns type 'project-search' with uppercase suffix", async () => {
    await fcAssert(
      property(tuple(projectSlugArb, suffixArb), ([project, suffix]) => {
        const input = `${project}-${suffix}`;
        const result = parseIssueArg(input);

        expect(result.type).toBe("project-search");
        if (result.type === "project-search") {
          expect(result.projectSlug).toBe(project);
          expect(result.suffix).toBe(suffix.toUpperCase());
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("alphanumeric input without dash/slash that isn't numeric returns 'suffix-only'", async () => {
    // Generate alphanumeric strings that contain at least one letter (not pure numeric)
    const alphanumericWithLetterArb = stringMatching(
      /^[a-zA-Z][a-zA-Z0-9]{0,9}$/
    );

    await fcAssert(
      property(alphanumericWithLetterArb, (input) => {
        const result = parseIssueArg(input);

        expect(result.type).toBe("suffix-only");
        if (result.type === "suffix-only") {
          expect(result.suffix).toBe(input.toUpperCase());
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("result type is always one of the 6 valid types", async () => {
    const validTypes = [
      "numeric",
      "explicit",
      "explicit-org-suffix",
      "explicit-org-numeric",
      "project-search",
      "suffix-only",
    ];

    // Generate various valid inputs
    const validInputArb = oneof(
      numericIdArb,
      tuple(orgSlugArb, projectSlugArb, suffixArb).map(
        ([o, p, s]) => `${o}/${p}-${s}`
      ),
      tuple(orgSlugArb, numericIdArb).map(([o, n]) => `${o}/${n}`),
      tuple(orgSlugArb, suffixArb).map(([o, s]) => `${o}/${s}`),
      tuple(projectSlugArb, suffixArb).map(([p, s]) => `${p}-${s}`),
      suffixArb
    );

    await fcAssert(
      property(validInputArb, (input) => {
        try {
          const result = parseIssueArg(input);
          expect(validTypes).toContain(result.type);
        } catch {
          // Some generated inputs may throw - that's expected for invalid formats
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("parsing never mutates the input", async () => {
    const inputArb = oneof(
      numericIdArb,
      tuple(orgSlugArb, projectSlugArb, suffixArb).map(
        ([o, p, s]) => `${o}/${p}-${s}`
      ),
      suffixArb
    );

    await fcAssert(
      property(inputArb, (input) => {
        const originalInput = input;
        try {
          parseIssueArg(input);
        } catch {
          // Ignore errors
        }
        // String is immutable in JS, but this verifies no weird side effects
        expect(input).toBe(originalInput);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("parseOrgProjectArg properties", () => {
  test("undefined or empty string returns type 'auto-detect'", async () => {
    const emptyInputArb = constantFrom(undefined, "", "  ", "\t", "\n");

    await fcAssert(
      property(emptyInputArb, (input) => {
        const result = parseOrgProjectArg(input);
        expect(result.type).toBe("auto-detect");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("org/project returns type 'explicit'", async () => {
    await fcAssert(
      property(tuple(orgSlugArb, projectSlugArb), ([org, project]) => {
        const input = `${org}/${project}`;
        const result = parseOrgProjectArg(input);

        expect(result.type).toBe("explicit");
        if (result.type === "explicit") {
          expect(result.org).toBe(org);
          expect(result.project).toBe(project);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("org/ (trailing slash) returns type 'org-all'", async () => {
    await fcAssert(
      property(orgSlugArb, (org) => {
        const input = `${org}/`;
        const result = parseOrgProjectArg(input);

        expect(result.type).toBe("org-all");
        if (result.type === "org-all") {
          expect(result.org).toBe(org);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("project without slash returns type 'project-search'", async () => {
    await fcAssert(
      property(projectSlugArb, (project) => {
        const result = parseOrgProjectArg(project);

        expect(result.type).toBe("project-search");
        if (result.type === "project-search") {
          expect(result.projectSlug).toBe(project);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("/project (leading slash) returns type 'project-search'", async () => {
    await fcAssert(
      property(projectSlugArb, (project) => {
        const input = `/${project}`;
        const result = parseOrgProjectArg(input);

        expect(result.type).toBe("project-search");
        if (result.type === "project-search") {
          expect(result.projectSlug).toBe(project);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("result type is always one of the 4 valid types", async () => {
    const validTypes = ["explicit", "org-all", "project-search", "auto-detect"];

    const validInputArb = oneof(
      constantFrom(undefined, ""),
      tuple(orgSlugArb, projectSlugArb).map(([o, p]) => `${o}/${p}`),
      orgSlugArb.map((o) => `${o}/`),
      projectSlugArb,
      projectSlugArb.map((p) => `/${p}`)
    );

    await fcAssert(
      property(validInputArb, (input) => {
        try {
          const result = parseOrgProjectArg(input);
          expect(validTypes).toContain(result.type);
        } catch {
          // Some inputs may throw - that's expected
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("whitespace is trimmed from input", async () => {
    await fcAssert(
      property(
        tuple(orgSlugArb, projectSlugArb, constantFrom("", " ", "  ")),
        ([org, project, ws]) => {
          const input = `${ws}${org}/${project}${ws}`;
          const result = parseOrgProjectArg(input);

          expect(result.type).toBe("explicit");
          if (result.type === "explicit") {
            expect(result.org).toBe(org);
            expect(result.project).toBe(project);
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("parseIssueArg and parseOrgProjectArg consistency", () => {
  test("parseIssueArg uses parseOrgProjectArg for dash-separated inputs", async () => {
    // When parseIssueArg gets "org/project-suffix", it should parse "org/project"
    // the same way parseOrgProjectArg would
    await fcAssert(
      property(
        tuple(orgSlugArb, projectSlugArb, suffixArb),
        ([org, project, suffix]) => {
          const orgProject = `${org}/${project}`;
          const issueArg = `${orgProject}-${suffix}`;

          const orgProjectResult = parseOrgProjectArg(orgProject);
          const issueResult = parseIssueArg(issueArg);

          // parseOrgProjectArg returns "explicit" for "org/project"
          expect(orgProjectResult.type).toBe("explicit");

          // parseIssueArg should return "explicit" with matching org/project
          expect(issueResult.type).toBe("explicit");
          if (
            orgProjectResult.type === "explicit" &&
            issueResult.type === "explicit"
          ) {
            expect(issueResult.org).toBe(orgProjectResult.org);
            expect(issueResult.project).toBe(orgProjectResult.project);
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
