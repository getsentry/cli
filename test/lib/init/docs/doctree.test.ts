import { describe, expect, test } from "vitest";
import {
  findPagesForLibsFeatures,
  libFeaturePath,
  libToPlatformPath,
} from "../../../../src/lib/init/docs/doctree.js";
import { normalizeDocPath } from "../../../../src/lib/init/docs/fetcher.js";

describe("libToPlatformPath", () => {
  test("maps known lib slugs to platform paths", () => {
    expect(libToPlatformPath("nextjs")).toBe(
      "/platforms/javascript/guides/nextjs/"
    );
    expect(libToPlatformPath("Django")).toBe(
      "/platforms/python/integrations/django/"
    );
    expect(libToPlatformPath("react native")).toBe("/platforms/react-native/");
  });

  test("returns null for unknown libs", () => {
    expect(libToPlatformPath("not-a-framework")).toBeNull();
  });
});

describe("libFeaturePath", () => {
  test("builds feature subpaths under a platform guide", () => {
    expect(libFeaturePath("nextjs", "session-replay")).toBe(
      "/platforms/javascript/guides/nextjs/session-replay"
    );
    expect(libFeaturePath("nextjs", "error-monitoring")).toBe(
      "/platforms/javascript/guides/nextjs"
    );
  });

  test("returns null for unknown lib or feature", () => {
    expect(libFeaturePath("nextjs", "not-a-feature")).toBeNull();
    expect(libFeaturePath("not-a-framework", "tracing")).toBeNull();
  });
});

describe("findPagesForLibsFeatures", () => {
  test("seeds platform root + install + manual-setup pages", () => {
    const pages = findPagesForLibsFeatures(["nextjs"], []);
    expect(pages).toContain(
      normalizeDocPath("/platforms/javascript/guides/nextjs/")
    );
    expect(pages).toContain(
      normalizeDocPath("/platforms/javascript/guides/nextjs/install/")
    );
    expect(pages).toContain(
      normalizeDocPath("/platforms/javascript/guides/nextjs/manual-setup/")
    );
  });

  test("adds per-feature pages and caps feature pages at the limit", () => {
    const pages = findPagesForLibsFeatures(["nextjs"], ["session-replay"], 10);
    expect(pages).toContain(
      normalizeDocPath("/platforms/javascript/guides/nextjs/session-replay")
    );
    // The platform seed triple (root + install + manual-setup) is always added;
    // once the limit is reached no further per-feature pages are appended.
    const capped = findPagesForLibsFeatures(
      ["nextjs"],
      ["session-replay", "profiling"],
      3
    );
    expect(capped).toHaveLength(3);
    expect(capped).not.toContain(
      normalizeDocPath("/platforms/javascript/guides/nextjs/profiling")
    );
  });
});

describe("normalizeDocPath", () => {
  test("strips host, trailing slash, and .md; ensures leading slash", () => {
    expect(
      normalizeDocPath("https://docs.sentry.io/platforms/javascript/")
    ).toBe("/platforms/javascript");
    expect(normalizeDocPath("platforms/python/.md")).toBe("/platforms/python");
  });
});
