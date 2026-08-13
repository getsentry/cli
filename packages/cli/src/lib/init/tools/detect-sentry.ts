import {
  collectGlob,
  collectGrep,
  DEFAULT_SKIP_DIRS,
  DSN_ADDITIONAL_SKIP_DIRS,
  isMonorepoPackageDir,
} from "../../scan/index.js";
import type { DetectSentryPayload, ToolResult } from "../types.js";
import type { InitToolDefinition } from "./types.js";

const SKIP_DIRS = [...DEFAULT_SKIP_DIRS, ...DSN_ADDITIONAL_SKIP_DIRS];
const MAX_SCAN_DEPTH = 6;

const CONFIG_PATTERNS = [
  "sentry.properties",
  "sentry.config.*",
  "sentry.*.config.*",
  "config/sentry.php",
  "config/packages/sentry.yaml",
];

const MANIFEST_PATTERNS = [
  "package.json",
  "requirements*.txt",
  "pyproject.toml",
  "Pipfile",
  "Gemfile",
  "composer.json",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "libs.versions.toml",
  "*.csproj",
  "*.fsproj",
  "*.vbproj",
  "Directory.Packages.props",
  "packages.config",
  "Package.swift",
  "Podfile",
  "pubspec.yaml",
  "mix.exs",
];

const SOURCE_PATTERNS = [
  "*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte}",
  "*.{py,go,rb,erb,php,java,kt,kts,scala,groovy}",
  "*.{cs,fs,vb,rs,swift,m,mm,dart,ex,exs,erl,lua}",
  "*.{xml,properties,yaml,yml}",
];

const SDK_PATTERN = String.raw`(?:@sentry\/(?!(?:cli|wizard|vite-plugin|webpack-plugin|rollup-plugin|esbuild-plugin|bundler-plugin-core)(?:["'\s/@]|$))|sentry-sdk|sentry-(?:ruby|rails|sidekiq|delayed_job|resque)|sentry\/sentry|github\.com\/getsentry\/sentry-go|io\.sentry|Package(?:Reference|Version)[^>]+Include=["']Sentry(?:\.[^"']+)?|\bsentry_flutter\b|\bsentry_dart\b|\bsentry-cocoa\b|\bpod\s+["']Sentry(?:\/[^"']+)?["']|\{\s*:sentry\b|\bsentry\s*=\s*["']|\bsentry\s*:)`;

const INIT_PATTERN = String.raw`(?:\bSentry[A-Za-z0-9_]*\s*(?:\.|::)\s*(?:init|Init|start)\s*(?:\(|\b)|\bsentry_sdk\s*\.\s*init\s*\(|\bsentry\s*\.\s*(?:init|Init)\s*\(|\bsentry\s*::\s*init\s*\(|\\Sentry\\init\s*\(|\bconfig\s+:sentry\b|\.(?:UseSentry|AddSentry)\s*\(|\[\s*SentrySDK\s+startWithConfigureOptions\s*:|\bio\.sentry\.(?:auto-init|dsn)\b|\bsentry\.dsn\s*=)`;

const COMMENT_PREFIX_RE = /^(?:\/\/|\/\*|\*|#|<!--|--)/;

function nextDepth(relativePath: string, currentDepth: number): number {
  return isMonorepoPackageDir(relativePath) ? 0 : currentDepth + 1;
}

const scanOptions = {
  alwaysSkipDirs: SKIP_DIRS,
  descentHook: nextDepth,
  hidden: true,
  maxDepth: MAX_SCAN_DEPTH,
  nestedGitignore: true,
  respectGitignore: true,
} as const;

async function detectScopedDsn(cwd: string) {
  const { detectFromEnvFiles, scanCodeForFirstDsn } = await import(
    "../../dsn/index.js"
  );

  const [codeDsn, envFileDsn] = await Promise.all([
    scanCodeForFirstDsn(cwd),
    detectFromEnvFiles(cwd),
  ]);
  return codeDsn ?? envFileDsn;
}

function firstRuntimeInitMatch<T extends { line: string }>(
  matches: T[]
): T | undefined {
  return matches.find(
    (match) => !COMMENT_PREFIX_RE.test(match.line.trimStart())
  );
}

/**
 * Detect existing Sentry signals in the local project directory.
 */
export async function detectSentry(cwd: string): Promise<ToolResult> {
  const [dsn, sdkResult, initResult, configResult] = await Promise.all([
    detectScopedDsn(cwd),
    collectGrep({
      cwd,
      pattern: SDK_PATTERN,
      include: MANIFEST_PATTERNS,
      maxResults: 1,
      stopOnFirst: true,
      ...scanOptions,
    }),
    collectGrep({
      cwd,
      pattern: INIT_PATTERN,
      include: SOURCE_PATTERNS,
      maxResults: 20,
      stopOnFirst: false,
      ...scanOptions,
    }),
    collectGlob({
      cwd,
      patterns: CONFIG_PATTERNS,
      maxResults: 1,
      ...scanOptions,
    }),
  ]);

  const signals: string[] = [];
  if (dsn) {
    signals.push(
      `dsn: ${dsn.source}${dsn.sourcePath ? ` (${dsn.sourcePath})` : ""}`
    );
  }
  const sdkMatch = sdkResult.matches[0];
  if (sdkMatch) {
    signals.push(`sdk: ${sdkMatch.path}`);
  }
  const configPath = configResult.files[0];
  // sentry.properties is also used by build-only debug-symbol/source-map
  // upload tooling. Treat it as runtime evidence only when corroborated by a
  // runtime SDK or init signal.
  if (configPath && configPath !== "sentry.properties") {
    signals.push(`config: ${configPath}`);
  }
  const initMatch = firstRuntimeInitMatch(initResult.matches);
  if (initMatch) {
    signals.push(`init: ${initMatch.path}:${initMatch.lineNum}`);
  }

  const hasStrongRuntimeSignal = Boolean(dsn || initMatch);
  const hasSdkAndConfig = Boolean(sdkMatch && configPath);
  let status: "installed" | "partial" | "none" = "none";
  if (hasStrongRuntimeSignal || hasSdkAndConfig) {
    status = "installed";
  } else if (signals.length > 0) {
    status = "partial";
  }

  return {
    ok: true,
    data: {
      cwd: cwd.replaceAll("\\", "/"),
      status,
      signals,
      ...(dsn ? { dsn: dsn.raw } : {}),
    },
  };
}

/**
 * Tool definition for Sentry install detection.
 */
export const detectSentryTool: InitToolDefinition<"detect-sentry"> = {
  operation: "detect-sentry",
  describe: () => "Checking for existing Sentry setup...",
  execute: async (payload: DetectSentryPayload) =>
    await detectSentry(payload.cwd),
};
