/**
 * Multi-Region API Client Tests
 *
 * Tests for the multi-region support in the Sentry API client.
 * Covers region discovery, fan-out, and region-aware routing.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  findProjectByDsnKey,
  getUserRegions,
  listOrganizations,
  listOrganizationsInRegion,
} from "../../src/lib/api-client.js";
import { setAuthToken } from "../../src/lib/db/auth.js";
import { CONFIG_DIR_ENV_VAR, closeDatabase } from "../../src/lib/db/index.js";
import {
  clearOrgRegions,
  getAllOrgRegions,
  setOrgRegion,
} from "../../src/lib/db/regions.js";
import { cleanupTestDir, createTestConfigDir } from "../helpers.js";

let testConfigDir: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  testConfigDir = await createTestConfigDir("test-multiregion-");
  process.env[CONFIG_DIR_ENV_VAR] = testConfigDir;

  // Save original fetch
  originalFetch = globalThis.fetch;

  // Set up auth token (manual token, no refresh)
  await setAuthToken("test-token");

  // Clear any existing region cache
  await clearOrgRegions();
});

afterEach(async () => {
  // Restore original fetch
  globalThis.fetch = originalFetch;
  closeDatabase();
  await cleanupTestDir(testConfigDir);
});

/**
 * Creates a mock fetch that routes requests based on URL patterns.
 */
function createMultiRegionMockFetch(handlers: {
  controlSilo?: (req: Request) => Response | Promise<Response>;
  usRegion?: (req: Request) => Response | Promise<Response>;
  euRegion?: (req: Request) => Response | Promise<Response>;
  default?: (req: Request) => Response | Promise<Response>;
}): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);

    // Route to appropriate handler based on hostname
    if (
      url.hostname === "sentry.io" ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1"
    ) {
      if (handlers.controlSilo) {
        return handlers.controlSilo(req);
      }
    } else if (url.hostname === "us.sentry.io") {
      if (handlers.usRegion) {
        return handlers.usRegion(req);
      }
    } else if (url.hostname === "de.sentry.io" && handlers.euRegion) {
      return handlers.euRegion(req);
    }

    if (handlers.default) {
      return handlers.default(req);
    }

    return new Response(JSON.stringify({ detail: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("getUserRegions", () => {
  test("returns regions from control silo", async () => {
    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [
                { name: "us", url: "https://us.sentry.io" },
                { name: "de", url: "https://de.sentry.io" },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ detail: "Not found" }), {
          status: 404,
        });
      },
    });

    const regions = await getUserRegions();

    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual({ name: "us", url: "https://us.sentry.io" });
    expect(regions[1]).toEqual({ name: "de", url: "https://de.sentry.io" });
  });

  test("returns empty array when no regions", async () => {
    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ detail: "Not found" }), {
          status: 404,
        });
      },
    });

    const regions = await getUserRegions();

    expect(regions).toHaveLength(0);
  });

  test("returns single region for self-hosted", async () => {
    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [{ name: "monolith", url: "https://sentry.io" }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ detail: "Not found" }), {
          status: 404,
        });
      },
    });

    const regions = await getUserRegions();

    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual({ name: "monolith", url: "https://sentry.io" });
  });
});

describe("listOrganizationsInRegion", () => {
  test("fetches organizations from specified region", async () => {
    let capturedUrl: string | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      capturedUrl = req.url;

      return new Response(
        JSON.stringify([
          { id: "1", slug: "us-org-1", name: "US Org 1" },
          { id: "2", slug: "us-org-2", name: "US Org 2" },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    const orgs = await listOrganizationsInRegion("https://us.sentry.io");

    expect(capturedUrl).toContain("us.sentry.io");
    expect(capturedUrl).toContain("/api/0/organizations/");
    expect(orgs).toHaveLength(2);
    expect(orgs[0].slug).toBe("us-org-1");
  });

  test("handles region with trailing slash", async () => {
    let capturedUrl: string | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      capturedUrl = req.url;

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await listOrganizationsInRegion("https://de.sentry.io/");

    // Should not have double slashes
    expect(capturedUrl).not.toContain("//api");
    expect(capturedUrl).toContain("de.sentry.io/api/0/organizations/");
  });
});

describe("listOrganizations (fan-out)", () => {
  test("fetches orgs from multiple regions in parallel", async () => {
    const requestedUrls: string[] = [];

    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        requestedUrls.push(req.url);
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [
                { name: "us", url: "https://us.sentry.io" },
                { name: "de", url: "https://de.sentry.io" },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
      usRegion: (req) => {
        requestedUrls.push(req.url);
        return new Response(
          JSON.stringify([
            {
              id: "100",
              slug: "us-org",
              name: "US Organization",
              links: {
                organizationUrl: "https://us.sentry.io/organizations/us-org/",
                regionUrl: "https://us.sentry.io",
              },
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
      euRegion: (req) => {
        requestedUrls.push(req.url);
        return new Response(
          JSON.stringify([
            {
              id: "200",
              slug: "eu-org",
              name: "EU Organization",
              links: {
                organizationUrl: "https://de.sentry.io/organizations/eu-org/",
                regionUrl: "https://de.sentry.io",
              },
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
    });

    const orgs = await listOrganizations();

    // Should have requested regions endpoint and both region org endpoints
    expect(requestedUrls.some((u) => u.includes("/users/me/regions/"))).toBe(
      true
    );
    expect(
      requestedUrls.some(
        (u) => u.includes("us.sentry.io") && u.includes("/organizations/")
      )
    ).toBe(true);
    expect(
      requestedUrls.some(
        (u) => u.includes("de.sentry.io") && u.includes("/organizations/")
      )
    ).toBe(true);

    // Should have combined results from both regions
    expect(orgs).toHaveLength(2);
    expect(orgs.map((o) => o.slug).sort()).toEqual(["eu-org", "us-org"]);
  });

  test("caches region URLs for each organization", async () => {
    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [
                { name: "us", url: "https://us.sentry.io" },
                { name: "de", url: "https://de.sentry.io" },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
      usRegion: () =>
        new Response(
          JSON.stringify([
            {
              id: "101",
              slug: "acme-us",
              name: "Acme US",
              links: {
                organizationUrl: "https://us.sentry.io/organizations/acme-us/",
                regionUrl: "https://us.sentry.io",
              },
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
      euRegion: () =>
        new Response(
          JSON.stringify([
            {
              id: "201",
              slug: "acme-eu",
              name: "Acme EU",
              links: {
                organizationUrl: "https://de.sentry.io/organizations/acme-eu/",
                regionUrl: "https://de.sentry.io",
              },
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
    });

    await listOrganizations();

    // Verify region cache was populated
    const cachedRegions = await getAllOrgRegions();
    expect(cachedRegions.size).toBe(2);
    expect(cachedRegions.get("acme-us")).toBe("https://us.sentry.io");
    expect(cachedRegions.get("acme-eu")).toBe("https://de.sentry.io");
  });

  test("returns empty array when no regions", async () => {
    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
    });

    const orgs = await listOrganizations();

    expect(orgs).toHaveLength(0);
  });

  test("continues with other regions when one fails", async () => {
    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [
                { name: "us", url: "https://us.sentry.io" },
                { name: "de", url: "https://de.sentry.io" },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
      usRegion: () =>
        new Response(JSON.stringify({ detail: "Internal error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      euRegion: () =>
        new Response(
          JSON.stringify([
            {
              id: "202",
              slug: "eu-org",
              name: "EU Org",
              links: {
                organizationUrl: "https://de.sentry.io/organizations/eu-org/",
                regionUrl: "https://de.sentry.io",
              },
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
    });

    // Should not throw, should return orgs from working region
    const orgs = await listOrganizations();

    expect(orgs).toHaveLength(1);
    expect(orgs[0].slug).toBe("eu-org");
  });

  test("uses region URL from org links when available", async () => {
    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [{ name: "us", url: "https://us.sentry.io" }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
      usRegion: () =>
        new Response(
          JSON.stringify([
            {
              id: "103",
              slug: "org-with-links",
              name: "Org With Links",
              links: {
                organizationUrl:
                  "https://custom.sentry.io/organizations/org-with-links/",
                regionUrl: "https://custom.sentry.io",
              },
            },
            {
              id: "104",
              slug: "org-without-links",
              name: "Org Without Links",
              // No links - should fall back to region URL
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
    });

    await listOrganizations();

    // Check cached regions
    const cachedRegions = await getAllOrgRegions();
    // Org with links should use its regionUrl
    expect(cachedRegions.get("org-with-links")).toBe(
      "https://custom.sentry.io"
    );
    // Org without links should fall back to region URL
    expect(cachedRegions.get("org-without-links")).toBe("https://us.sentry.io");
  });
});

describe("findProjectByDsnKey (multi-region)", () => {
  test("searches all regions for project with DSN key", async () => {
    const requestedUrls: string[] = [];

    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        requestedUrls.push(req.url);
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [
                { name: "us", url: "https://us.sentry.io" },
                { name: "de", url: "https://de.sentry.io" },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
      usRegion: (req) => {
        requestedUrls.push(req.url);
        // US region doesn't have the project
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      euRegion: (req) => {
        requestedUrls.push(req.url);
        // EU region has the project
        // Check for URL-encoded query parameter (dsn%3Aabc123)
        if (req.url.includes("/projects/") && req.url.includes("abc123")) {
          return new Response(
            JSON.stringify([
              {
                id: "300",
                slug: "eu-project",
                name: "EU Project",
                organization: { id: "200", slug: "eu-org", name: "EU Org" },
              },
            ]),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
    });

    const project = await findProjectByDsnKey("abc123");

    // Should have searched both regions
    expect(
      requestedUrls.some(
        (u) => u.includes("us.sentry.io") && u.includes("/projects/")
      )
    ).toBe(true);
    expect(
      requestedUrls.some(
        (u) => u.includes("de.sentry.io") && u.includes("/projects/")
      )
    ).toBe(true);

    // Should find the project from EU region
    expect(project).not.toBeNull();
    expect(project?.slug).toBe("eu-project");
  });

  test("returns null when project not found in any region", async () => {
    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [{ name: "us", url: "https://us.sentry.io" }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
      usRegion: () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const project = await findProjectByDsnKey("nonexistent-key");

    expect(project).toBeNull();
  });

  test("falls back to default region for self-hosted (no regions)", async () => {
    let capturedUrl: string | undefined;

    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        capturedUrl = req.url;
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        if (req.url.includes("/projects/")) {
          return new Response(
            JSON.stringify([
              {
                id: "400",
                slug: "self-hosted-project",
                name: "Self Hosted Project",
              },
            ]),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
    });

    const project = await findProjectByDsnKey("self-hosted-key");

    // Should query control silo directly when no regions
    expect(capturedUrl).toContain("/projects/");
    // URL encodes the colon as %3A
    expect(capturedUrl).toContain("self-hosted-key");
    expect(project?.slug).toBe("self-hosted-project");
  });

  test("continues searching when one region fails", async () => {
    globalThis.fetch = createMultiRegionMockFetch({
      controlSilo: (req) => {
        if (req.url.includes("/users/me/regions/")) {
          return new Response(
            JSON.stringify({
              regions: [
                { name: "us", url: "https://us.sentry.io" },
                { name: "de", url: "https://de.sentry.io" },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      },
      usRegion: () => {
        throw new Error("Network error");
      },
      euRegion: () =>
        new Response(
          JSON.stringify([
            {
              id: "500",
              slug: "found-project",
              name: "Found Project",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
    });

    const project = await findProjectByDsnKey("abc123");

    // Should find project despite US region failing
    expect(project?.slug).toBe("found-project");
  });
});

describe("org-scoped requests use region cache", () => {
  test("routes request to cached region URL", async () => {
    // Pre-populate region cache
    await setOrgRegion("cached-org", "https://de.sentry.io");

    let capturedUrl: string | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      capturedUrl = req.url;

      return new Response(
        JSON.stringify({
          id: "600",
          slug: "cached-org",
          name: "Cached Organization",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    // Import getOrganization dynamically to use fresh module state
    const { getOrganization } = await import("../../src/lib/api-client.js");
    await getOrganization("cached-org");

    // Should route to EU region based on cache
    expect(capturedUrl).toContain("de.sentry.io");
    expect(capturedUrl).toContain("/organizations/cached-org/");
  });
});
