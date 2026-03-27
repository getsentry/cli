/**
 * Feature Detection Tests
 *
 * Tests for the feature detection module that analyzes project dependencies
 * to determine which Sentry features should be pre-selected.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeRecommendedFeatures,
  detectPlatformDeps,
  type PlatformDeps,
} from "../../../src/lib/init/feature-detection.js";

describe("detectPlatformDeps", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feature-detection-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Node.js projects (package.json)", () => {
    test("detects basic Node.js project", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: { express: "^4.18.0" },
        })
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("nodejs");
      expect(deps.dependencies.has("express")).toBe(true);
      expect(deps.isBackend).toBe(true);
    });

    test("detects frontend project with React", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
        })
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("nodejs");
      expect(deps.isFrontend).toBe(true);
    });

    test("detects fullstack Next.js project", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: {
            next: "^14.0.0",
            react: "^18.0.0",
            "react-dom": "^18.0.0",
          },
        })
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("nodejs");
      expect(deps.isFrontend).toBe(true);
      expect(deps.isBackend).toBe(true);
    });

    test("detects TypeScript", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ dependencies: {} })
      );
      fs.writeFileSync(path.join(tempDir, "tsconfig.json"), "{}");

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.hasTypeScript).toBe(true);
    });

    test("detects cron packages", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: { express: "^4.18.0", "node-cron": "^3.0.0" },
        })
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.dependencies.has("node-cron")).toBe(true);
    });

    test("detects AI packages", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: { openai: "^4.0.0" },
        })
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.dependencies.has("openai")).toBe(true);
    });

    test("includes devDependencies", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          dependencies: { express: "^4.18.0" },
          devDependencies: { typescript: "^5.0.0" },
        })
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.devDependencies.has("typescript")).toBe(true);
    });
  });

  describe("Python projects", () => {
    test("detects requirements.txt", async () => {
      fs.writeFileSync(
        path.join(tempDir, "requirements.txt"),
        "django==4.2.0\ncelery>=5.0.0\n"
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("python");
      expect(deps.dependencies.has("django")).toBe(true);
      expect(deps.dependencies.has("celery")).toBe(true);
    });

    test("handles requirements.txt with comments", async () => {
      fs.writeFileSync(
        path.join(tempDir, "requirements.txt"),
        "# This is a comment\nflask>=2.0.0\n# Another comment\nopenai\n"
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("python");
      expect(deps.dependencies.has("flask")).toBe(true);
      expect(deps.dependencies.has("openai")).toBe(true);
    });

    test("handles requirements.txt with extras", async () => {
      fs.writeFileSync(
        path.join(tempDir, "requirements.txt"),
        "celery[redis]>=5.0.0\n"
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.dependencies.has("celery")).toBe(true);
    });

    test("detects pyproject.toml with project.dependencies", async () => {
      fs.writeFileSync(
        path.join(tempDir, "pyproject.toml"),
        `[project]
name = "myproject"
dependencies = [
  "fastapi>=0.100.0",
  "openai>=1.0.0",
]
`
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("python");
      expect(deps.dependencies.has("fastapi")).toBe(true);
      expect(deps.dependencies.has("openai")).toBe(true);
    });

    test("detects pyproject.toml with poetry dependencies", async () => {
      fs.writeFileSync(
        path.join(tempDir, "pyproject.toml"),
        `[tool.poetry.dependencies]
python = "^3.11"
django = "^4.2"
apscheduler = "^3.10"
`
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("python");
      expect(deps.dependencies.has("django")).toBe(true);
      expect(deps.dependencies.has("apscheduler")).toBe(true);
    });
  });

  describe("Go projects (go.mod)", () => {
    test("detects go.mod", async () => {
      fs.writeFileSync(
        path.join(tempDir, "go.mod"),
        `module example.com/myapp

go 1.21

require (
    github.com/gin-gonic/gin v1.9.0
    github.com/robfig/cron/v3 v3.0.1
)
`
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("go");
      expect(deps.dependencies.has("github.com/gin-gonic/gin")).toBe(true);
      expect(deps.dependencies.has("github.com/robfig/cron/v3")).toBe(true);
      expect(deps.isBackend).toBe(true);
    });

    test("handles single-line require", async () => {
      fs.writeFileSync(
        path.join(tempDir, "go.mod"),
        `module example.com/myapp

go 1.21

require github.com/sashabaranov/go-openai v1.17.0
`
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("go");
      expect(deps.dependencies.has("github.com/sashabaranov/go-openai")).toBe(
        true
      );
    });
  });

  describe("unknown projects", () => {
    test("returns unknown platform for empty directory", async () => {
      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("unknown");
      expect(deps.dependencies.size).toBe(0);
    });

    test("prefers package.json over other files", async () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ dependencies: { express: "^4.18.0" } })
      );
      fs.writeFileSync(
        path.join(tempDir, "requirements.txt"),
        "django==4.2.0\n"
      );

      const deps = await detectPlatformDeps(tempDir);

      expect(deps.platform).toBe("nodejs");
    });
  });
});

describe("computeRecommendedFeatures", () => {
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
  ];

  describe("always-on features", () => {
    test("recommends performanceMonitoring and logs for any platform", () => {
      const deps: PlatformDeps = {
        platform: "unknown",
        dependencies: new Set(),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: false,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("performanceMonitoring");
      expect(recommended).toContain("logs");
    });
  });

  describe("crons detection", () => {
    test("recommends crons for Node.js with node-cron", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["node-cron"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("crons");
    });

    test("recommends crons for Python with celery", () => {
      const deps: PlatformDeps = {
        platform: "python",
        dependencies: new Set(["celery"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("crons");
    });

    test("recommends crons for Go with robfig/cron", () => {
      const deps: PlatformDeps = {
        platform: "go",
        dependencies: new Set(["github.com/robfig/cron"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("crons");
    });

    test("does not recommend crons without scheduler packages", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["express"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).not.toContain("crons");
    });
  });

  describe("aiMonitoring detection", () => {
    test("recommends aiMonitoring for Node.js with openai", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["openai"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("aiMonitoring");
    });

    test("recommends aiMonitoring for Python with langchain", () => {
      const deps: PlatformDeps = {
        platform: "python",
        dependencies: new Set(["langchain"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("aiMonitoring");
    });

    test("does not recommend aiMonitoring without AI packages", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["express"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).not.toContain("aiMonitoring");
    });
  });

  describe("sessionReplay detection", () => {
    test("recommends sessionReplay for frontend projects", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["react-dom"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: true,
        isBackend: false,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("sessionReplay");
    });

    test("does not recommend sessionReplay for backend-only projects", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["express"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).not.toContain("sessionReplay");
    });
  });

  describe("sourceMaps detection", () => {
    test("recommends sourceMaps for TypeScript projects", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["express"]),
        devDependencies: new Set(),
        hasTypeScript: true,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("sourceMaps");
    });

    test("recommends sourceMaps for frontend Node.js projects", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["react-dom"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: true,
        isBackend: false,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("sourceMaps");
    });

    test("does not recommend sourceMaps for Python projects", () => {
      const deps: PlatformDeps = {
        platform: "python",
        dependencies: new Set(["django"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).not.toContain("sourceMaps");
    });
  });

  describe("profiling detection", () => {
    test("recommends profiling for backend projects", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["express"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("profiling");
    });

    test("does not recommend profiling for frontend-only projects", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["react-dom"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: true,
        isBackend: false,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).not.toContain("profiling");
    });
  });

  describe("userFeedback detection", () => {
    test("recommends userFeedback for frontend projects", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["react-dom"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: true,
        isBackend: false,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("userFeedback");
    });
  });

  describe("metrics", () => {
    test("does not recommend metrics by default", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["express"]),
        devDependencies: new Set(),
        hasTypeScript: false,
        isFrontend: false,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).not.toContain("metrics");
    });
  });

  describe("feature filtering", () => {
    test("only returns features that are in the available list", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["openai", "node-cron"]),
        devDependencies: new Set(),
        hasTypeScript: true,
        isFrontend: true,
        isBackend: true,
      };

      // Only provide a subset of features
      const limitedFeatures = ["crons", "aiMonitoring"];
      const recommended = computeRecommendedFeatures(limitedFeatures, deps);

      expect(recommended).toContain("crons");
      expect(recommended).toContain("aiMonitoring");
      expect(recommended).not.toContain("performanceMonitoring");
      expect(recommended).not.toContain("sourceMaps");
    });
  });

  describe("fullstack projects", () => {
    test("recommends both frontend and backend features for Next.js", () => {
      const deps: PlatformDeps = {
        platform: "nodejs",
        dependencies: new Set(["next", "react", "react-dom"]),
        devDependencies: new Set(),
        hasTypeScript: true,
        isFrontend: true,
        isBackend: true,
      };

      const recommended = computeRecommendedFeatures(ALL_FEATURES, deps);

      expect(recommended).toContain("sessionReplay");
      expect(recommended).toContain("sourceMaps");
      expect(recommended).toContain("profiling");
      expect(recommended).toContain("userFeedback");
    });
  });
});
