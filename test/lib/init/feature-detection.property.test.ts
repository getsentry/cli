/**
 * Property-Based Tests for Feature Detection
 *
 * Uses fast-check to verify properties that should always hold true
 * for the feature detection functions, regardless of input.
 */

import { describe, expect, test } from "bun:test";
import {
  array,
  boolean,
  constantFrom,
  assert as fcAssert,
  property,
  record,
  set,
  uniqueArray,
} from "fast-check";
import {
  computeRecommendedFeatures,
  type PlatformDeps,
} from "../../../src/lib/init/feature-detection.js";
import { DEFAULT_NUM_RUNS } from "../../model-based/helpers.js";

// Arbitraries

/** All possible Sentry features */
const ALL_FEATURES = [
  "performanceMonitoring",
  "sessionReplay",
  "logs",
  "profiling",
  "sourceMaps",
  "crons",
  "aiMonitoring",
  "metrics",
  "userFeedback",
] as const;

type SentryFeature = (typeof ALL_FEATURES)[number];

/** Generate a subset of features */
const featureSubsetArb = uniqueArray(
  constantFrom<SentryFeature>(...ALL_FEATURES),
  {
    minLength: 0,
    maxLength: ALL_FEATURES.length,
  }
);

/** All supported platforms */
const platforms = ["nodejs", "python", "go", "unknown"] as const;
type Platform = (typeof platforms)[number];

/** Generate a platform */
const platformArb = constantFrom<Platform>(...platforms);

/** Generate a package name */
const packageNameArb = array(
  constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-@/".split("")),
  { minLength: 1, maxLength: 30 }
).map((chars) => chars.join(""));

/** Generate a set of package names */
const packageSetArb = set(packageNameArb, { minLength: 0, maxLength: 20 });

/** Generate PlatformDeps */
const platformDepsArb = record({
  platform: platformArb,
  dependencies: packageSetArb,
  devDependencies: packageSetArb,
  hasTypeScript: boolean(),
  isFrontend: boolean(),
  isBackend: boolean(),
});

// Properties for computeRecommendedFeatures

describe("property: computeRecommendedFeatures", () => {
  test("recommended features are always a subset of available features", () => {
    fcAssert(
      property(featureSubsetArb, platformDepsArb, (available, deps) => {
        const recommended = computeRecommendedFeatures(available, deps);

        // Every recommended feature must be in the available list
        for (const feature of recommended) {
          expect(available).toContain(feature);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("recommended features list has no duplicates", () => {
    fcAssert(
      property(featureSubsetArb, platformDepsArb, (available, deps) => {
        const recommended = computeRecommendedFeatures(available, deps);
        const uniqueRecommended = new Set(recommended);

        expect(uniqueRecommended.size).toBe(recommended.length);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("always-on features are recommended when available", () => {
    const alwaysOnFeatures = ["performanceMonitoring", "logs"];

    fcAssert(
      property(platformDepsArb, (deps) => {
        const recommended = computeRecommendedFeatures(
          ALL_FEATURES as unknown as string[],
          deps
        );

        for (const feature of alwaysOnFeatures) {
          expect(recommended).toContain(feature);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("empty available list returns empty recommendations", () => {
    fcAssert(
      property(platformDepsArb, (deps) => {
        const recommended = computeRecommendedFeatures([], deps);

        expect(recommended).toEqual([]);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("recommendations are deterministic for same input", () => {
    fcAssert(
      property(featureSubsetArb, platformDepsArb, (available, deps) => {
        const recommended1 = computeRecommendedFeatures(available, deps);
        const recommended2 = computeRecommendedFeatures(available, deps);

        expect(recommended1).toEqual(recommended2);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("recommendations never exceed available count", () => {
    fcAssert(
      property(featureSubsetArb, platformDepsArb, (available, deps) => {
        const recommended = computeRecommendedFeatures(available, deps);

        expect(recommended.length).toBeLessThanOrEqual(available.length);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

// Feature-specific property tests

describe("property: crons detection", () => {
  const cronPackages: Record<string, string[]> = {
    nodejs: ["node-cron", "cron", "bull", "agenda"],
    python: ["celery", "apscheduler", "schedule"],
    go: ["github.com/robfig/cron"],
  };

  test("crons recommended when cron package present", () => {
    fcAssert(
      property(
        constantFrom<"nodejs" | "python" | "go">("nodejs", "python", "go"),
        (platform) => {
          const pkgs = cronPackages[platform];
          if (!pkgs || pkgs.length === 0) return;

          // Pick first cron package for this platform
          const cronPkg = pkgs[0]!;

          const deps: PlatformDeps = {
            platform,
            dependencies: new Set([cronPkg]),
            devDependencies: new Set(),
            hasTypeScript: false,
            isFrontend: false,
            isBackend: true,
          };

          const recommended = computeRecommendedFeatures(["crons"], deps);

          expect(recommended).toContain("crons");
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("crons not recommended without cron packages", () => {
    fcAssert(
      property(platformArb, (platform) => {
        const deps: PlatformDeps = {
          platform,
          dependencies: new Set(["express", "lodash"]),
          devDependencies: new Set(),
          hasTypeScript: false,
          isFrontend: false,
          isBackend: true,
        };

        const recommended = computeRecommendedFeatures(["crons"], deps);

        expect(recommended).not.toContain("crons");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: aiMonitoring detection", () => {
  const aiPackages: Record<string, string[]> = {
    nodejs: ["openai", "langchain", "@anthropic-ai/sdk"],
    python: ["openai", "langchain", "anthropic"],
    go: ["github.com/sashabaranov/go-openai"],
  };

  test("aiMonitoring recommended when AI package present", () => {
    fcAssert(
      property(
        constantFrom<"nodejs" | "python" | "go">("nodejs", "python", "go"),
        (platform) => {
          const pkgs = aiPackages[platform];
          if (!pkgs || pkgs.length === 0) return;

          const aiPkg = pkgs[0]!;

          const deps: PlatformDeps = {
            platform,
            dependencies: new Set([aiPkg]),
            devDependencies: new Set(),
            hasTypeScript: false,
            isFrontend: false,
            isBackend: true,
          };

          const recommended = computeRecommendedFeatures(
            ["aiMonitoring"],
            deps
          );

          expect(recommended).toContain("aiMonitoring");
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: frontend feature detection", () => {
  test("sessionReplay and userFeedback recommended for frontend projects", () => {
    fcAssert(
      property(boolean(), (hasTypeScript) => {
        const deps: PlatformDeps = {
          platform: "nodejs",
          dependencies: new Set(["react-dom"]),
          devDependencies: new Set(),
          hasTypeScript,
          isFrontend: true,
          isBackend: false,
        };

        const recommended = computeRecommendedFeatures(
          ["sessionReplay", "userFeedback"],
          deps
        );

        expect(recommended).toContain("sessionReplay");
        expect(recommended).toContain("userFeedback");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("sessionReplay not recommended for backend-only projects", () => {
    fcAssert(
      property(platformArb, (platform) => {
        const deps: PlatformDeps = {
          platform,
          dependencies: new Set(["express"]),
          devDependencies: new Set(),
          hasTypeScript: false,
          isFrontend: false,
          isBackend: true,
        };

        const recommended = computeRecommendedFeatures(["sessionReplay"], deps);

        expect(recommended).not.toContain("sessionReplay");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: sourceMaps detection", () => {
  test("sourceMaps recommended for TypeScript Node.js projects", () => {
    fcAssert(
      property(boolean(), boolean(), (isFrontend, isBackend) => {
        const deps: PlatformDeps = {
          platform: "nodejs",
          dependencies: new Set(),
          devDependencies: new Set(),
          hasTypeScript: true,
          isFrontend,
          isBackend,
        };

        const recommended = computeRecommendedFeatures(["sourceMaps"], deps);

        expect(recommended).toContain("sourceMaps");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("sourceMaps recommended for frontend Node.js projects", () => {
    fcAssert(
      property(boolean(), (hasTypeScript) => {
        const deps: PlatformDeps = {
          platform: "nodejs",
          dependencies: new Set(),
          devDependencies: new Set(),
          hasTypeScript,
          isFrontend: true,
          isBackend: false,
        };

        const recommended = computeRecommendedFeatures(["sourceMaps"], deps);

        expect(recommended).toContain("sourceMaps");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("sourceMaps not recommended for non-Node.js platforms", () => {
    fcAssert(
      property(
        constantFrom<"python" | "go" | "unknown">("python", "go", "unknown"),
        (platform) => {
          const deps: PlatformDeps = {
            platform,
            dependencies: new Set(),
            devDependencies: new Set(),
            hasTypeScript: false,
            isFrontend: false,
            isBackend: true,
          };

          const recommended = computeRecommendedFeatures(["sourceMaps"], deps);

          expect(recommended).not.toContain("sourceMaps");
        }
      ),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: profiling detection", () => {
  test("profiling recommended for backend projects", () => {
    fcAssert(
      property(platformArb, boolean(), (platform, hasTypeScript) => {
        const deps: PlatformDeps = {
          platform,
          dependencies: new Set(),
          devDependencies: new Set(),
          hasTypeScript,
          isFrontend: false,
          isBackend: true,
        };

        const recommended = computeRecommendedFeatures(["profiling"], deps);

        expect(recommended).toContain("profiling");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("profiling not recommended for frontend-only projects", () => {
    fcAssert(
      property(boolean(), (hasTypeScript) => {
        const deps: PlatformDeps = {
          platform: "nodejs",
          dependencies: new Set(),
          devDependencies: new Set(),
          hasTypeScript,
          isFrontend: true,
          isBackend: false,
        };

        const recommended = computeRecommendedFeatures(["profiling"], deps);

        expect(recommended).not.toContain("profiling");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

describe("property: metrics feature", () => {
  test("metrics never recommended by default", () => {
    fcAssert(
      property(platformDepsArb, (deps) => {
        const recommended = computeRecommendedFeatures(["metrics"], deps);

        expect(recommended).not.toContain("metrics");
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });
});

// Edge cases

describe("property: edge cases", () => {
  test("unknown platform only gets always-on features", () => {
    fcAssert(
      property(packageSetArb, packageSetArb, boolean(), (deps1, deps2, ts) => {
        const deps: PlatformDeps = {
          platform: "unknown",
          dependencies: deps1,
          devDependencies: deps2,
          hasTypeScript: ts,
          isFrontend: false,
          isBackend: false,
        };

        const recommended = computeRecommendedFeatures(
          ALL_FEATURES as unknown as string[],
          deps
        );

        // Should only have always-on features for unknown platform
        // without frontend/backend detection
        const nonAlwaysOn = recommended.filter(
          (f) => !["performanceMonitoring", "logs"].includes(f)
        );
        expect(nonAlwaysOn).toEqual([]);
      }),
      { numRuns: DEFAULT_NUM_RUNS }
    );
  });

  test("devDependencies are considered for detection", () => {
    // Test that cron packages in devDependencies trigger recommendation
    const deps: PlatformDeps = {
      platform: "nodejs",
      dependencies: new Set(),
      devDependencies: new Set(["node-cron"]),
      hasTypeScript: false,
      isFrontend: false,
      isBackend: true,
    };

    const recommended = computeRecommendedFeatures(["crons"], deps);
    expect(recommended).toContain("crons");
  });
});
