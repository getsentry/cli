/**
 * Where Sentry gets configured, as data.
 *
 * Adding support for a platform is adding a row. If you find yourself adding
 * a branch instead, the table is wrong.
 */

import type { BlockDelims } from "./capture-block.js";

export type MarkerRule = {
  /** Ecosystem, not platform — `javascript`, not `nextjs`. */
  ecosystem: string;
  /** Label carried onto the `CapturedBlock`. */
  kind: string;
  /** Matched against the file's basename. */
  file: RegExp;
  marker: RegExp;
  delims: BlockDelims;
  /**
   * True when the platform initializes from this manifest rather than from an
   * explicit code call. For these, "no init call found" is `skip`, not `fail`.
   */
  autoInit?: boolean;
};

const JS_FILE = /\.(?:[cm]?[jt]sx?)$/;

export const INIT_MARKERS: readonly MarkerRule[] = [
  {
    ecosystem: "javascript",
    kind: "init",
    file: JS_FILE,
    marker: /Sentry\.init\s*\(/,
    delims: "paren",
  },
  {
    ecosystem: "python",
    kind: "init",
    file: /\.py$/,
    marker: /sentry_sdk\.init\s*\(/,
    delims: "paren",
  },
  {
    ecosystem: "ruby",
    kind: "init",
    file: /\.rb$/,
    marker: /Sentry\.init\b/,
    delims: "ruby",
  },
  {
    ecosystem: "php",
    kind: "init",
    file: /\.php$/,
    marker: /\\?Sentry\\init\s*\(/,
    delims: "paren",
  },
  {
    ecosystem: "go",
    kind: "init",
    file: /\.go$/,
    marker: /sentry\.Init\s*\(/,
    delims: "paren",
  },
  {
    ecosystem: "java",
    kind: "init",
    file: /\.(?:java|kt)$/,
    marker: /Sentry(?:Android)?\.init\s*\(/,
    delims: "paren",
  },
  {
    ecosystem: "dotnet",
    kind: "init",
    file: /\.cs$/,
    marker: /SentrySdk\.Init\s*\(/,
    delims: "paren",
  },
  {
    ecosystem: "apple",
    kind: "init",
    file: /\.(?:swift|m)$/,
    marker: /SentrySDK\.start\s*\(/,
    delims: "paren",
  },
  {
    ecosystem: "apple",
    kind: "init",
    file: /\.(?:swift|m)$/,
    marker: /SentrySDK\.start\s*\{/,
    delims: "brace",
  },
  {
    ecosystem: "dart",
    kind: "init",
    file: /\.dart$/,
    marker: /Sentry(?:Flutter)?\.init\s*\(/,
    delims: "paren",
  },
  {
    ecosystem: "rust",
    kind: "init",
    file: /\.rs$/,
    marker: /sentry::init\s*\(/,
    delims: "paren",
  },
  // --- Manifest-driven platforms: no init call is expected or required ---
  {
    ecosystem: "java",
    kind: "android-manifest",
    file: /^AndroidManifest\.xml$/,
    // ponytail: sample-app package ids look like io.sentry.samples.*
    marker: /android:name="io\.sentry\.(?!samples(?:\.|"))/,
    delims: "none",
    autoInit: true,
  },
  {
    ecosystem: "java",
    kind: "spring-config",
    file: /^application(?:-[\w-]+)?\.(?:properties|ya?ml)$/,
    marker: /^\s*sentry[.:]/m,
    delims: "paren",
    autoInit: true,
  },
  {
    ecosystem: "dotnet",
    kind: "appsettings",
    file: /^appsettings(?:\.\w+)?\.json$/,
    marker: /"Sentry"\s*:\s*\{/,
    delims: "brace",
    autoInit: true,
  },
  {
    ecosystem: "php",
    kind: "laravel-config",
    file: /^sentry\.php$/,
    marker: /return\s*\[/,
    delims: "paren",
    autoInit: true,
  },
  {
    ecosystem: "java",
    kind: "sentry-properties",
    file: /^sentry\.properties$/,
    marker: /./,
    delims: "none",
  },
];

export const BUILD_MARKERS: readonly MarkerRule[] = [
  {
    ecosystem: "javascript",
    kind: "bundler-plugin",
    file: /^(?:vite|webpack|rollup|next|nuxt|astro|svelte|remix)\.config\./,
    marker:
      /sentry(?:Vite|Webpack|Rollup|Esbuild)Plugin\s*\(|withSentryConfig\s*\(/,
    delims: "paren",
  },
  {
    ecosystem: "java",
    kind: "gradle",
    file: /^build\.gradle(?:\.kts)?$/,
    marker: /^\s*sentry\s*\{/m,
    delims: "brace",
  },
  {
    ecosystem: "apple",
    kind: "fastlane",
    file: /^Fastfile$/,
    marker: /sentry_(?:upload_d?sym|upload_sourcemap|debug_files_upload)\b/,
    delims: "ruby",
  },
];

/** Rules whose `file` pattern matches this basename. */
export function markersForFile(
  rules: readonly MarkerRule[],
  basename: string
): MarkerRule[] {
  return rules.filter((rule) => rule.file.test(basename));
}
