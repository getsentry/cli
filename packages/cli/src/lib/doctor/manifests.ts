/**
 * Dependency manifests, reduced to "which Sentry packages, at which versions".
 *
 * Two code paths only: JSON manifests get parsed properly; everything else
 * gets one regex sweep. That is deliberate — doctor needs the SDK name and
 * version, not a faithful model of nine packaging formats.
 */

import type { ParsedManifest } from "./types.js";

const MANIFEST_BASENAMES =
  /^(?:package\.json|composer\.json|requirements(?:-\w+)?\.txt|pyproject\.toml|Pipfile|Gemfile|go\.mod|pubspec\.yaml|pom\.xml|build\.gradle(?:\.kts)?|Cargo\.toml|.+\.csproj)$/;

/** True when this basename is a dependency manifest doctor reads. */
export function isManifest(basename: string): boolean {
  return MANIFEST_BASENAMES.test(basename);
}

const JSON_DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "require",
  "require-dev",
] as const;

/**
 * `sentry-sdk==2.18.0`, `io.sentry:sentry-android:7.14.0`,
 * `sentry_flutter: ^8.9.0`, `getsentry/sentry-go v0.29.0`.
 *
 * ponytail: one regex instead of nine parsers. It reads name and version off a
 * line that mentions sentry, which is all any check needs. Add a real parser
 * only when a check needs something structural, like dependency scopes.
 */
const GENERIC_DEP_RE =
  /([\w.@/-]*sentry[\w.@/:-]*?)\s*(?:[:=~^><]+|\s)\s*v?(\d[\w.+-]*)/gi;

function isSentryDep(name: string): boolean {
  return name.toLowerCase().includes("sentry");
}

function parseJsonManifest(
  file: string,
  content: string
): ParsedManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const deps: Record<string, string> = {};

  for (const section of JSON_DEP_SECTIONS) {
    const value = record[section];
    if (typeof value !== "object" || value === null) {
      continue;
    }
    for (const [name, spec] of Object.entries(value)) {
      if (isSentryDep(name) && typeof spec === "string") {
        deps[name] = spec;
      }
    }
  }

  return Object.keys(deps).length > 0 ? { file, deps } : null;
}

function parseGenericManifest(
  file: string,
  content: string
): ParsedManifest | null {
  const deps: Record<string, string> = {};
  GENERIC_DEP_RE.lastIndex = 0;

  let match = GENERIC_DEP_RE.exec(content);
  while (match !== null) {
    const name = (match[1] ?? "").replace(/^["']|["']$/g, "");
    const version = match[2];
    if (name && version && isSentryDep(name) && !(name in deps)) {
      deps[name] = version;
    }
    match = GENERIC_DEP_RE.exec(content);
  }

  return Object.keys(deps).length > 0 ? { file, deps } : null;
}

/**
 * Parse one manifest. Returns `null` when the file declares no Sentry
 * dependency — an absent entry means "nothing to check here", which callers
 * translate to `skip`, never `fail`.
 */
export function parseManifest(
  relPath: string,
  content: string
): ParsedManifest | null {
  return relPath.endsWith(".json")
    ? parseJsonManifest(relPath, content)
    : parseGenericManifest(relPath, content);
}
