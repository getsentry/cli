/**
 * Feature Detection
 *
 * Scans project dependencies to determine which Sentry features are relevant.
 * Used to pre-select features in the init wizard based on actual project usage
 * rather than selecting all features by default.
 *
 * Supports Node.js (package.json), Python (requirements.txt, pyproject.toml),
 * and Go (go.mod) projects.
 */

import fs from "node:fs";
import path from "node:path";

/** Regex to extract package name from requirements.txt line. */
const REQUIREMENTS_PKG_RE = /^([a-zA-Z0-9_-]+)/;

/** Regex to match pyproject.toml [project] dependencies array. */
const PYPROJECT_PROJECT_DEPS_RE =
  /\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/;

/** Regex to match pyproject.toml [tool.poetry.dependencies] section. */
const PYPROJECT_POETRY_DEPS_RE =
  /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\[|$)/;

/** Regex to extract package name from pyproject.toml dependency entry. */
const PYPROJECT_PKG_RE = /["']?([a-zA-Z0-9_-]+)/g;

/** Regex to extract go.mod require line. */
const GOMOD_REQUIRE_RE = /^(?:require\s+)?([^\s]+)\s+v/;

/** Detected platform and dependency information. */
export type PlatformDeps = {
  platform: "nodejs" | "python" | "go" | "unknown";
  dependencies: Set<string>;
  devDependencies: Set<string>;
  hasTypeScript: boolean;
  isFrontend: boolean;
  isBackend: boolean;
};

/** Features that are always recommended regardless of detection. */
const ALWAYS_ON_FEATURES = new Set(["performanceMonitoring", "logs"]);

/**
 * Packages that indicate cron/scheduled job usage.
 */
const CRON_PACKAGES: Record<string, Set<string>> = {
  nodejs: new Set([
    "node-cron",
    "cron",
    "croner",
    "@nestjs/schedule",
    "bull",
    "bullmq",
    "agenda",
    "bree",
    "node-schedule",
    "later",
    "bottleneck",
  ]),
  python: new Set([
    "apscheduler",
    "celery",
    "schedule",
    "rq-scheduler",
    "django-celery-beat",
    "huey",
    "dramatiq",
    "rq",
  ]),
  go: new Set([
    "github.com/robfig/cron",
    "github.com/go-co-op/gocron",
    "github.com/jasonlvhit/gocron",
  ]),
};

/**
 * Packages that indicate AI/LLM usage.
 */
const AI_PACKAGES: Record<string, Set<string>> = {
  nodejs: new Set([
    "openai",
    "@anthropic-ai/sdk",
    "langchain",
    "@langchain/core",
    "@langchain/openai",
    "@langchain/anthropic",
    "@google/generative-ai",
    "cohere-ai",
    "ai",
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
    "@ai-sdk/google",
    "ollama",
    "replicate",
  ]),
  python: new Set([
    "openai",
    "anthropic",
    "langchain",
    "langchain-core",
    "langchain-openai",
    "langchain-anthropic",
    "google-generativeai",
    "cohere",
    "llama-index",
    "transformers",
    "torch",
    "tensorflow",
    "huggingface-hub",
  ]),
  go: new Set([
    "github.com/sashabaranov/go-openai",
    "github.com/anthropics/anthropic-sdk-go",
    "github.com/tmc/langchaingo",
  ]),
};

/**
 * Packages that indicate frontend/browser usage.
 */
const FRONTEND_PACKAGES: Record<string, Set<string>> = {
  nodejs: new Set([
    "react-dom",
    "vue",
    "@angular/core",
    "svelte",
    "next",
    "@remix-run/react",
    "solid-js",
    "preact",
    "qwik",
    "@builder.io/qwik",
    "astro",
    "nuxt",
    "gatsby",
    "@sveltejs/kit",
  ]),
  python: new Set([
    // Web frameworks that typically serve HTML
    "django",
    "flask",
    "fastapi",
    "streamlit",
    "gradio",
    "dash",
  ]),
  go: new Set(["github.com/a-h/templ"]),
};

/**
 * Packages that indicate backend/server usage.
 */
const BACKEND_PACKAGES: Record<string, Set<string>> = {
  nodejs: new Set([
    "express",
    "fastify",
    "koa",
    "hapi",
    "@nestjs/core",
    "hono",
    "elysia",
    "@trpc/server",
    "graphql",
    "apollo-server",
  ]),
  python: new Set([
    "django",
    "flask",
    "fastapi",
    "starlette",
    "sanic",
    "tornado",
    "aiohttp",
    "pyramid",
    "bottle",
  ]),
  go: new Set([
    "github.com/gin-gonic/gin",
    "github.com/labstack/echo",
    "github.com/gofiber/fiber",
    "github.com/gorilla/mux",
    "net/http",
  ]),
};

/**
 * Check if any package from a set exists in the dependencies.
 */
function hasAnyPackage(deps: Set<string>, packages: Set<string>): boolean {
  for (const pkg of packages) {
    if (deps.has(pkg)) {
      return true;
    }
    // Check for scoped packages and version specifiers
    for (const dep of deps) {
      // Handle cases like "@langchain/core" matching "langchain"
      if (
        (dep.startsWith(pkg) || pkg.startsWith(dep.split("/")[0] ?? "")) &&
        (packages.has(dep) || packages.has(pkg))
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Parse package.json and extract dependencies.
 */
function parsePackageJson(content: string): Partial<PlatformDeps> {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      platform: "nodejs",
      dependencies: new Set(Object.keys(pkg.dependencies ?? {})),
      devDependencies: new Set(Object.keys(pkg.devDependencies ?? {})),
    };
  } catch {
    return {};
  }
}

/**
 * Parse requirements.txt and extract package names.
 * Handles various formats: package==version, package>=version, package[extra], etc.
 */
function parseRequirementsTxt(content: string): Partial<PlatformDeps> {
  const deps = new Set<string>();
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) {
      continue;
    }
    // Extract package name (before any version specifier or extras)
    const match = trimmed.match(REQUIREMENTS_PKG_RE);
    if (match?.[1]) {
      deps.add(match[1].toLowerCase());
    }
  }

  return {
    platform: "python",
    dependencies: deps,
    devDependencies: new Set(),
  };
}

/**
 * Parse pyproject.toml and extract dependencies.
 * Basic parser for the dependencies section.
 */
function parsePyprojectToml(content: string): Partial<PlatformDeps> {
  const deps = new Set<string>();

  // Match dependencies in [project.dependencies] or [tool.poetry.dependencies]
  const depPatterns = [PYPROJECT_PROJECT_DEPS_RE, PYPROJECT_POETRY_DEPS_RE];

  for (const pattern of depPatterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      // Extract package names from the array or section
      const section = match[1];
      const pkgMatches = section.matchAll(PYPROJECT_PKG_RE);
      for (const pkgMatch of pkgMatches) {
        if (pkgMatch[1] && pkgMatch[1] !== "python") {
          deps.add(pkgMatch[1].toLowerCase());
        }
      }
    }
  }

  return {
    platform: "python",
    dependencies: deps,
    devDependencies: new Set(),
  };
}

/**
 * Parse go.mod and extract module dependencies.
 */
function parseGoMod(content: string): Partial<PlatformDeps> {
  const deps = new Set<string>();
  const lines = content.split("\n");
  let inRequire = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("require (")) {
      inRequire = true;
      continue;
    }
    if (trimmed === ")") {
      inRequire = false;
      continue;
    }

    // Single-line require or inside require block
    const requireMatch = trimmed.match(GOMOD_REQUIRE_RE);
    if (requireMatch?.[1] && (inRequire || trimmed.startsWith("require"))) {
      deps.add(requireMatch[1]);
    }
  }

  return {
    platform: "go",
    dependencies: deps,
    devDependencies: new Set(),
  };
}

/**
 * Read a file if it exists, returning null otherwise.
 */
function tryReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Detect project platform and dependencies from the directory.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential platform detection with priority ordering
export function detectPlatformDeps(directory: string): PlatformDeps {
  const result: PlatformDeps = {
    platform: "unknown",
    dependencies: new Set(),
    devDependencies: new Set(),
    hasTypeScript: false,
    isFrontend: false,
    isBackend: false,
  };

  // Check for TypeScript
  const tsconfigPath = path.join(directory, "tsconfig.json");
  result.hasTypeScript = fs.existsSync(tsconfigPath);

  // Try Node.js (package.json)
  const packageJsonPath = path.join(directory, "package.json");
  const packageJson = tryReadFile(packageJsonPath);
  if (packageJson) {
    const parsed = parsePackageJson(packageJson);
    if (parsed.platform) {
      result.platform = parsed.platform;
      result.dependencies = parsed.dependencies ?? new Set();
      result.devDependencies = parsed.devDependencies ?? new Set();
    }
  }

  // Try Python (requirements.txt, pyproject.toml)
  if (result.platform === "unknown") {
    const requirementsPath = path.join(directory, "requirements.txt");
    const requirements = tryReadFile(requirementsPath);
    if (requirements) {
      const parsed = parseRequirementsTxt(requirements);
      if (parsed.platform) {
        result.platform = parsed.platform;
        result.dependencies = parsed.dependencies ?? new Set();
      }
    }
  }

  if (result.platform === "unknown") {
    const pyprojectPath = path.join(directory, "pyproject.toml");
    const pyproject = tryReadFile(pyprojectPath);
    if (pyproject) {
      const parsed = parsePyprojectToml(pyproject);
      if (parsed.platform) {
        result.platform = parsed.platform;
        result.dependencies = parsed.dependencies ?? new Set();
      }
    }
  }

  // Try Go (go.mod)
  if (result.platform === "unknown") {
    const goModPath = path.join(directory, "go.mod");
    const goMod = tryReadFile(goModPath);
    if (goMod) {
      const parsed = parseGoMod(goMod);
      if (parsed.platform) {
        result.platform = parsed.platform;
        result.dependencies = parsed.dependencies ?? new Set();
      }
    }
  }

  // Determine frontend/backend status
  const allDeps = new Set([...result.dependencies, ...result.devDependencies]);
  const frontendPkgs = FRONTEND_PACKAGES[result.platform];
  const backendPkgs = BACKEND_PACKAGES[result.platform];

  if (frontendPkgs && hasAnyPackage(allDeps, frontendPkgs)) {
    result.isFrontend = true;
  }
  if (backendPkgs && hasAnyPackage(allDeps, backendPkgs)) {
    result.isBackend = true;
  }

  // Node.js with frontend packages but no explicit backend is likely frontend
  if (result.platform === "nodejs" && result.isFrontend && !result.isBackend) {
    // Check for Next.js or similar which are both frontend and backend
    const fullStackPkgs = new Set([
      "next",
      "nuxt",
      "@remix-run/react",
      "gatsby",
    ]);
    if (hasAnyPackage(allDeps, fullStackPkgs)) {
      result.isBackend = true;
    }
  }

  // Backend platforms without explicit frontend are backend-only
  if (
    result.platform === "go" ||
    (result.platform === "python" && !result.isFrontend)
  ) {
    result.isBackend = true;
  }

  return result;
}

/**
 * Compute which features should be pre-selected based on detected dependencies.
 *
 * Features default to OFF unless:
 * 1. They're in ALWAYS_ON_FEATURES, or
 * 2. Positive signals are detected in the project dependencies
 *
 * @param available - Features available for selection (from the remote workflow)
 * @param deps - Detected platform and dependencies
 * @returns Features that should be pre-selected
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: feature-specific switch cases are inherently branchy
export function computeRecommendedFeatures(
  available: string[],
  deps: PlatformDeps
): string[] {
  const recommended: string[] = [];
  const allDeps = new Set([...deps.dependencies, ...deps.devDependencies]);

  for (const feature of available) {
    // Always-on features
    if (ALWAYS_ON_FEATURES.has(feature)) {
      recommended.push(feature);
      continue;
    }

    // Feature-specific detection
    switch (feature) {
      case "crons": {
        const cronPkgs = CRON_PACKAGES[deps.platform];
        if (cronPkgs && hasAnyPackage(allDeps, cronPkgs)) {
          recommended.push(feature);
        }
        break;
      }

      case "aiMonitoring": {
        const aiPkgs = AI_PACKAGES[deps.platform];
        if (aiPkgs && hasAnyPackage(allDeps, aiPkgs)) {
          recommended.push(feature);
        }
        break;
      }

      case "sessionReplay": {
        // Session replay is for frontend apps
        if (deps.isFrontend) {
          recommended.push(feature);
        }
        break;
      }

      case "sourceMaps": {
        // Source maps are for JavaScript/TypeScript projects
        if (
          deps.platform === "nodejs" &&
          (deps.hasTypeScript || deps.isFrontend)
        ) {
          recommended.push(feature);
        }
        break;
      }

      case "profiling": {
        // Profiling is most useful for backend services
        if (deps.isBackend) {
          recommended.push(feature);
        }
        break;
      }

      case "userFeedback": {
        // User feedback is for apps with user interaction (frontend or web backend)
        if (deps.isFrontend) {
          recommended.push(feature);
        }
        break;
      }

      case "metrics": {
        // Metrics: default off, could add detection for metrics libraries
        break;
      }

      default:
        // Unknown features default to off
        break;
    }
  }

  return recommended;
}
