/**
 * Property-Based Tests for Sentry URL Utilities
 *
 * Uses fast-check to verify invariants of URL validation and building
 * functions that are difficult to exhaustively test with example-based tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  constantFrom,
  assert as fcAssert,
  nat,
  oneof,
  property,
  stringMatching,
  tuple,
} from "fast-check";
import {
  buildBillingUrl,
  buildEventSearchUrl,
  buildLogsUrl,
  buildOrgSettingsUrl,
  buildOrgUrl,
  buildProfileUrl,
  buildProfilingSummaryUrl,
  buildProjectUrl,
  buildSeerSettingsUrl,
  buildTraceUrl,
  getSentryBaseUrl,
  isSentrySaasUrl,
} from "../../src/lib/sentry-urls.js";
import { DEFAULT_NUM_RUNS } from "../model-based/helpers.js";

// Save original env
let originalSentryUrl: string | undefined;

beforeEach(() => {
  originalSentryUrl = process.env.SENTRY_URL;
  // Clear SENTRY_URL for consistent base URL in tests
  delete process.env.SENTRY_URL;
});

afterEach(() => {
  if (originalSentryUrl !== undefined) {
    process.env.SENTRY_URL = originalSentryUrl;
  } else {
    delete process.env.SENTRY_URL;
  }
});

// Arbitraries

/** Valid subdomain parts (lowercase alphanumeric with hyphens, not starting/ending with hyphen) */
const subdomainPartArb = stringMatching(
  /^[a-z][a-z0-9-]{0,10}[a-z0-9]$/
).filter((s) => !s.includes("--") && s.length >= 2);

/** Valid org/project slugs */
const slugArb = stringMatching(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/);

/** Valid event IDs (32-char hex) */
const eventIdArb = stringMatching(/^[a-f0-9]{32}$/);

/** Valid log IDs (32-char hex, same format as event IDs) */
const logIdArb = stringMatching(/^[a-f0-9]{32}$/);

/** Valid trace IDs (32-char hex) */
const traceIdArb = stringMatching(/^[a-f0-9]{32}$/);

/** Common Sentry regions */
const sentryRegionArb = constantFrom("us", "de", "eu", "staging");

/** Arbitrary domain that is NOT sentry.io */
const nonSentryDomainArb = oneof(
  constantFrom(
    "example.com",
    "localhost",
    "evil.com",
    "sentry-fake.com",
    "notsentry.io",
    "sentry.io.evil.com",
    "example.sentry.io.evil.com"
  ),
  // Generate random domains
  tuple(subdomainPartArb, constantFrom(".com", ".org", ".net", ".io")).map(
    ([sub, tld]) => `${sub}${tld}`
  )
).filter((domain) => {
  // Ensure it's not actually sentry.io or a subdomain
  return domain !== "sentry.io" && !domain.endsWith(".sentry.io");
});

/** Hash fragments for URLs */
const hashArb = stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,20}$/);

/** Product names for billing URLs */
const productArb = constantFrom("seer", "errors", "performance", "replays");

/** Numeric project IDs (Sentry uses numeric IDs for ?project= params) */
const projectIdArb = nat({ max: 9_999_999 }).filter((n) => n > 0);

/** Transaction names (URL-style paths) */
const transactionNameArb = constantFrom(
  "/api/users",
  "/api/0/organizations/{org}/issues/",
  "POST /api/v2/users/:id",
  "tasks.process_event",
  "/health"
);

describe("isSentrySaasUrl properties", () => {
  test("sentry.io always returns true", () => {
    expect(isSentrySaasUrl("https://sentry.io")).toBe(true);
    expect(isSentrySaasUrl("http://sentry.io")).toBe(true);
    expect(isSentrySaasUrl("https://sentry.io/")).toBe(true);
    expect(isSentrySaasUrl("https://sentry.io/path")).toBe(true);
  });

  test("*.sentry.io subdomains always return true", async () => {
    await fcAssert(
      property(sentryRegionArb, (region) => {
        const url = `https://${region}.sentry.io`;
        expect(isSentrySaasUrl(url)).toBe(true);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("arbitrary subdomains of sentry.io return true", async () => {
    await fcAssert(
      property(subdomainPartArb, (subdomain) => {
        const url = `https://${subdomain}.sentry.io`;
        expect(isSentrySaasUrl(url)).toBe(true);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("non-sentry.io domains always return false", async () => {
    await fcAssert(
      property(nonSentryDomainArb, (domain) => {
        const url = `https://${domain}`;
        expect(isSentrySaasUrl(url)).toBe(false);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("invalid URLs return false", () => {
    const invalidUrls = [
      "not-a-url",
      "",
      "://sentry.io",
      "sentry.io", // no protocol
      "http://", // no host
    ];

    for (const url of invalidUrls) {
      expect(isSentrySaasUrl(url)).toBe(false);
    }
  });

  test("non-HTTP protocols still work for sentry.io domain", () => {
    // The function checks hostname, not protocol
    // ftp://sentry.io is still a sentry.io domain
    expect(isSentrySaasUrl("ftp://sentry.io")).toBe(true);
  });

  test("security: lookalike domains return false", () => {
    // These should all return false - they're attempts to spoof sentry.io
    const lookalikes = [
      "https://sentry.io.evil.com",
      "https://sentry.io-fake.com",
      "https://evil.com/sentry.io",
      "https://notsentry.io",
      "https://sentry.io.example.com",
    ];

    for (const url of lookalikes) {
      expect(isSentrySaasUrl(url)).toBe(false);
    }
  });

  test("deterministic: same input always produces same output", async () => {
    await fcAssert(
      property(
        oneof(
          constantFrom("https://sentry.io", "https://us.sentry.io"),
          nonSentryDomainArb.map((d) => `https://${d}`)
        ),
        (url) => {
          const result1 = isSentrySaasUrl(url);
          const result2 = isSentrySaasUrl(url);
          expect(result1).toBe(result2);
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("buildOrgUrl properties", () => {
  test("output always starts with base URL", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildOrgUrl(orgSlug);
        expect(result.startsWith(getSentryBaseUrl())).toBe(true);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output always contains the org slug", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildOrgUrl(orgSlug);
        expect(result).toContain(orgSlug);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output follows expected pattern", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildOrgUrl(orgSlug);
        expect(result).toBe(`${getSentryBaseUrl()}/organizations/${orgSlug}/`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output is a valid URL", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildOrgUrl(orgSlug);
        expect(() => new URL(result)).not.toThrow();
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("buildProjectUrl properties", () => {
  test("output contains both org and project slugs", async () => {
    await fcAssert(
      property(tuple(slugArb, slugArb), ([orgSlug, projectSlug]) => {
        const result = buildProjectUrl(orgSlug, projectSlug);
        expect(result).toContain(orgSlug);
        expect(result).toContain(projectSlug);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output follows expected pattern", async () => {
    await fcAssert(
      property(tuple(slugArb, slugArb), ([orgSlug, projectSlug]) => {
        const result = buildProjectUrl(orgSlug, projectSlug);
        expect(result).toBe(
          `${getSentryBaseUrl()}/settings/${orgSlug}/projects/${projectSlug}/`
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output is a valid URL", async () => {
    await fcAssert(
      property(tuple(slugArb, slugArb), ([orgSlug, projectSlug]) => {
        const result = buildProjectUrl(orgSlug, projectSlug);
        expect(() => new URL(result)).not.toThrow();
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("buildEventSearchUrl properties", () => {
  test("output contains event ID in query string", async () => {
    await fcAssert(
      property(tuple(slugArb, eventIdArb), ([orgSlug, eventId]) => {
        const result = buildEventSearchUrl(orgSlug, eventId);
        expect(result).toContain(`event.id:${eventId}`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output is a valid URL with query parameter", async () => {
    await fcAssert(
      property(tuple(slugArb, eventIdArb), ([orgSlug, eventId]) => {
        const result = buildEventSearchUrl(orgSlug, eventId);
        const url = new URL(result);
        expect(url.searchParams.get("query")).toContain(eventId);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("buildOrgSettingsUrl properties", () => {
  test("without hash, output ends with trailing slash", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildOrgSettingsUrl(orgSlug);
        expect(result.endsWith("/")).toBe(true);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("with hash, output contains hash fragment", async () => {
    await fcAssert(
      property(tuple(slugArb, hashArb), ([orgSlug, hash]) => {
        const result = buildOrgSettingsUrl(orgSlug, hash);
        expect(result).toContain(`#${hash}`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("hash is appended at the end", async () => {
    await fcAssert(
      property(tuple(slugArb, hashArb), ([orgSlug, hash]) => {
        const result = buildOrgSettingsUrl(orgSlug, hash);
        expect(result.endsWith(`#${hash}`)).toBe(true);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("buildSeerSettingsUrl properties", () => {
  test("output contains /seer/ path", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildSeerSettingsUrl(orgSlug);
        expect(result).toContain("/seer/");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output is under settings path", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildSeerSettingsUrl(orgSlug);
        expect(result).toContain(`/settings/${orgSlug}/`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("buildBillingUrl properties", () => {
  test("without product, output has no query string", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildBillingUrl(orgSlug);
        expect(result.includes("?")).toBe(false);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("with product, output has product query parameter", async () => {
    await fcAssert(
      property(tuple(slugArb, productArb), ([orgSlug, product]) => {
        const result = buildBillingUrl(orgSlug, product);
        expect(result).toContain(`?product=${product}`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output contains /billing/overview/ path", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildBillingUrl(orgSlug);
        expect(result).toContain("/billing/overview/");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("buildLogsUrl properties", () => {
  test("without logId, output has no query string", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildLogsUrl(orgSlug);
        expect(result.includes("?")).toBe(false);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("with logId, output contains query parameter with log ID", async () => {
    await fcAssert(
      property(tuple(slugArb, logIdArb), ([orgSlug, logId]) => {
        const result = buildLogsUrl(orgSlug, logId);
        expect(result).toContain(`?query=sentry.item_id:${logId}`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output contains /explore/logs/ path", async () => {
    await fcAssert(
      property(slugArb, (orgSlug) => {
        const result = buildLogsUrl(orgSlug);
        expect(result).toContain("/explore/logs/");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output is a valid URL", async () => {
    await fcAssert(
      property(tuple(slugArb, logIdArb), ([orgSlug, logId]) => {
        expect(() => new URL(buildLogsUrl(orgSlug))).not.toThrow();
        expect(() => new URL(buildLogsUrl(orgSlug, logId))).not.toThrow();
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("buildTraceUrl properties", () => {
  test("output contains /traces/ path with trace ID", async () => {
    await fcAssert(
      property(tuple(slugArb, traceIdArb), ([orgSlug, traceId]) => {
        const result = buildTraceUrl(orgSlug, traceId);
        expect(result).toContain(`/traces/${traceId}/`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output contains the org slug", async () => {
    await fcAssert(
      property(tuple(slugArb, traceIdArb), ([orgSlug, traceId]) => {
        const result = buildTraceUrl(orgSlug, traceId);
        expect(result).toContain(orgSlug);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output is a valid URL", async () => {
    await fcAssert(
      property(tuple(slugArb, traceIdArb), ([orgSlug, traceId]) => {
        const result = buildTraceUrl(orgSlug, traceId);
        expect(() => new URL(result)).not.toThrow();
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output follows expected pattern", async () => {
    await fcAssert(
      property(tuple(slugArb, traceIdArb), ([orgSlug, traceId]) => {
        const result = buildTraceUrl(orgSlug, traceId);
        expect(result).toBe(
          `${getSentryBaseUrl()}/organizations/${orgSlug}/traces/${traceId}/`
        );
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("buildProfileUrl properties", () => {
  test("output contains org slug, project slug, and encoded transaction", async () => {
    await fcAssert(
      property(
        tuple(slugArb, slugArb, transactionNameArb),
        ([orgSlug, projectSlug, transaction]) => {
          const result = buildProfileUrl(orgSlug, projectSlug, transaction);
          expect(result).toContain(orgSlug);
          expect(result).toContain(projectSlug);
          expect(result).toContain(encodeURIComponent(transaction));
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output contains /profiling/profile/ path", async () => {
    await fcAssert(
      property(
        tuple(slugArb, slugArb, transactionNameArb),
        ([orgSlug, projectSlug, transaction]) => {
          const result = buildProfileUrl(orgSlug, projectSlug, transaction);
          expect(result).toContain("/profiling/profile/");
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output is a valid URL", async () => {
    await fcAssert(
      property(
        tuple(slugArb, slugArb, transactionNameArb),
        ([orgSlug, projectSlug, transaction]) => {
          const result = buildProfileUrl(orgSlug, projectSlug, transaction);
          expect(() => new URL(result)).not.toThrow();
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output contains flamegraph and quoted transaction query", async () => {
    await fcAssert(
      property(
        tuple(slugArb, slugArb, transactionNameArb),
        ([orgSlug, projectSlug, transaction]) => {
          const result = buildProfileUrl(orgSlug, projectSlug, transaction);
          expect(result).toContain("/flamegraph/");
          // Transaction should be wrapped in encoded quotes (%22) for Sentry search syntax
          expect(result).toContain(
            `query=transaction%3A%22${encodeURIComponent(transaction)}%22`
          );
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("buildProfilingSummaryUrl properties", () => {
  test("output contains org slug and project ID", async () => {
    await fcAssert(
      property(tuple(slugArb, projectIdArb), ([orgSlug, projectId]) => {
        const result = buildProfilingSummaryUrl(orgSlug, projectId);
        expect(result).toContain(orgSlug);
        expect(result).toContain(`${projectId}`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output contains /profiling/ path", async () => {
    await fcAssert(
      property(tuple(slugArb, projectIdArb), ([orgSlug, projectId]) => {
        const result = buildProfilingSummaryUrl(orgSlug, projectId);
        expect(result).toContain("/profiling/");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output is a valid URL", async () => {
    await fcAssert(
      property(tuple(slugArb, projectIdArb), ([orgSlug, projectId]) => {
        const result = buildProfilingSummaryUrl(orgSlug, projectId);
        expect(() => new URL(result)).not.toThrow();
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("output has project query parameter with numeric ID", async () => {
    await fcAssert(
      property(tuple(slugArb, projectIdArb), ([orgSlug, projectId]) => {
        const result = buildProfilingSummaryUrl(orgSlug, projectId);
        expect(result).toContain(`?project=${projectId}`);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("URL building cross-function properties", () => {
  test("all URL builders produce valid URLs", async () => {
    await fcAssert(
      property(
        tuple(slugArb, slugArb, eventIdArb, hashArb, productArb),
        ([orgSlug, projectSlug, eventId, hash, product]) => {
          const urls = [
            buildOrgUrl(orgSlug),
            buildProjectUrl(orgSlug, projectSlug),
            buildEventSearchUrl(orgSlug, eventId),
            buildOrgSettingsUrl(orgSlug),
            buildOrgSettingsUrl(orgSlug, hash),
            buildSeerSettingsUrl(orgSlug),
            buildBillingUrl(orgSlug),
            buildBillingUrl(orgSlug, product),
            buildProfileUrl(orgSlug, projectSlug, "/api/users"),
            buildProfilingSummaryUrl(orgSlug, 12_345),
          ];

          for (const url of urls) {
            expect(() => new URL(url)).not.toThrow();
          }
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("all URL builders are deterministic", async () => {
    await fcAssert(
      property(
        tuple(slugArb, slugArb, eventIdArb, hashArb, productArb),
        ([orgSlug, projectSlug, eventId, hash, product]) => {
          expect(buildOrgUrl(orgSlug)).toBe(buildOrgUrl(orgSlug));
          expect(buildProjectUrl(orgSlug, projectSlug)).toBe(
            buildProjectUrl(orgSlug, projectSlug)
          );
          expect(buildEventSearchUrl(orgSlug, eventId)).toBe(
            buildEventSearchUrl(orgSlug, eventId)
          );
          expect(buildOrgSettingsUrl(orgSlug, hash)).toBe(
            buildOrgSettingsUrl(orgSlug, hash)
          );
          expect(buildSeerSettingsUrl(orgSlug)).toBe(
            buildSeerSettingsUrl(orgSlug)
          );
          expect(buildBillingUrl(orgSlug, product)).toBe(
            buildBillingUrl(orgSlug, product)
          );
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});
