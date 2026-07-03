/**
 * Xcode build-environment helpers for `react-native xcode`.
 *
 * Ports the pieces of the legacy `utils/xcode` needed to (a) locate the Node and
 * Hermes compilers the way the React Native build script does, and (b) derive a
 * release/distribution from the build environment or the project `Info.plist`.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Bundle identity extracted from an `Info.plist` or the build environment. */
export type InfoPlist = {
  /** `CFBundleName` / `PRODUCT_NAME`. */
  name: string;
  /** `CFBundleIdentifier` / `PRODUCT_BUNDLE_IDENTIFIER`. */
  bundleId: string;
  /** `CFBundleShortVersionString` / `MARKETING_VERSION`. */
  version: string;
  /** `CFBundleVersion` / `CURRENT_PROJECT_VERSION`. */
  build: string;
};

/** A read-only view of the process environment. */
type Env = Record<string, string | undefined>;

/**
 * Resolve the Node binary the RN build script should call, matching the legacy
 * `find_node`: `NODE_BINARY` if set and non-empty, else `node`.
 */
export function findNode(env: Env): string {
  const fromEnv = env.NODE_BINARY;
  return fromEnv && fromEnv.length > 0 ? fromEnv : "node";
}

/**
 * Resolve the Hermes compiler path, matching the legacy `find_hermesc`:
 * `HERMES_CLI_PATH` if set, else `$PODS_ROOT/hermes-engine/destroot/bin/hermesc`.
 */
export function findHermesc(env: Env): string {
  const fromEnv = env.HERMES_CLI_PATH;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  const podsRoot = env.PODS_ROOT ?? "";
  return `${podsRoot}/hermes-engine/destroot/bin/hermesc`;
}

/**
 * Expand Xcode-style variable references (`$(VAR)`, `${VAR}`) in a string,
 * supporting the `:rfc1034identifier` and `:identifier` modifiers.
 *
 * @param input - The string possibly containing variable references.
 * @param vars - The variable table (typically the process environment).
 */
export function expandXcodeVars(input: string, vars: Env): string {
  return input.replace(/\$[({]([^)}]*)[)}]/g, (_match, key: string) => {
    if (!key) {
      return "";
    }
    const colon = key.indexOf(":");
    const name = colon < 0 ? key : key.slice(0, colon);
    const modifier = colon < 0 ? undefined : key.slice(colon + 1);
    const value = vars[name] ?? "";
    if (modifier === "rfc1034identifier") {
      return value.replace(/[\s/]+/g, "-");
    }
    if (modifier === "identifier") {
      return value.replace(/[\s/]+/g, "_");
    }
    return value;
  });
}

/** Decode the handful of XML entities that appear in plist string values. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Extract `<key>…</key><string>…</string>` pairs from an XML `Info.plist`.
 *
 * This is a deliberately small parser: it only reads top-level string entries,
 * which is all the CFBundle* metadata the command needs. Binary plists are not
 * supported (the source `Info.plist` referenced by `INFOPLIST_FILE` is XML).
 */
export function parseInfoPlistStrings(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g;
  let match: RegExpExecArray | null = re.exec(xml);
  while (match !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      result[decodeXmlEntities(key.trim())] = decodeXmlEntities(value);
    }
    match = re.exec(xml);
  }
  return result;
}

/** Build an {@link InfoPlist} purely from Xcode build-setting env vars. */
function fromEnvVars(vars: Env): InfoPlist | null {
  const name = vars.PRODUCT_NAME;
  const bundleId = vars.PRODUCT_BUNDLE_IDENTIFIER;
  const version = vars.MARKETING_VERSION;
  const build = vars.CURRENT_PROJECT_VERSION;
  if (!(name && bundleId && version && build)) {
    return null;
  }
  return { name, bundleId, version, build };
}

/** Whether a parsed plist carries the fields we require. */
function plistComplete(p: Partial<InfoPlist>): p is InfoPlist {
  return Boolean(p.name && p.bundleId && p.version && p.build);
}

/**
 * Discover the app's bundle identity from the Xcode build environment.
 *
 * Handles the common case of running inside an Xcode build phase
 * (`XCODE_VERSION_ACTUAL` set): reads `INFOPLIST_FILE` (expanding `$(VAR)`
 * references from the environment) and falls back to build-setting env vars.
 * Returns `null` when the identity cannot be determined.
 *
 * Not supported (returns `null` / falls back): `INFOPLIST_PREPROCESS` C
 * preprocessing, and discovery via `xcodebuild` when run outside Xcode.
 */
export async function discoverInfoPlist(
  env: Env,
  cwd: string
): Promise<InfoPlist | null> {
  if (!env.XCODE_VERSION_ACTUAL) {
    return null;
  }
  const filename = env.INFOPLIST_FILE;
  if (!filename) {
    return fromEnvVars(env);
  }
  const path = join(cwd, env.PROJECT_DIR ?? ".", filename);
  let raw: Record<string, string>;
  try {
    raw = parseInfoPlistStrings(await readFile(path, "utf-8"));
  } catch {
    return fromEnvVars(env);
  }
  const parsed: Partial<InfoPlist> = {
    name: raw.CFBundleName,
    bundleId: raw.CFBundleIdentifier,
    version: raw.CFBundleShortVersionString,
    build: raw.CFBundleVersion,
  };
  if (!plistComplete(parsed)) {
    return fromEnvVars(env);
  }
  return {
    name: expandXcodeVars(parsed.name, env),
    bundleId: expandXcodeVars(parsed.bundleId, env),
    version: expandXcodeVars(parsed.version, env),
    build: expandXcodeVars(parsed.build, env),
  };
}

/** A resolved release + distribution for the sourcemap upload. */
export type ReleaseAndDist = {
  release?: string;
  dist?: string;
};

/**
 * Resolve the release name and distribution to upload under.
 *
 * Priority mirrors the legacy CLI: `SENTRY_RELEASE`/`SENTRY_DIST` env vars win;
 * otherwise the app `Info.plist` yields `release = <bundleId>@<version>+<build>`
 * and `dist = <build>`.
 *
 * @throws When neither env vars nor the Info.plist provide the identity and
 *   auto-release was not disabled.
 */
export async function resolveReleaseAndDist(
  env: Env,
  cwd: string,
  noAutoRelease: boolean
): Promise<ReleaseAndDist> {
  const distEnv = env.SENTRY_DIST;
  const releaseEnv = env.SENTRY_RELEASE;

  if (!(distEnv || releaseEnv) && noAutoRelease) {
    return {};
  }
  if (distEnv || releaseEnv) {
    return { release: releaseEnv, dist: distEnv };
  }

  const plist = await discoverInfoPlist(env, cwd);
  if (!plist) {
    throw new Error(
      "Could not determine release: set SENTRY_RELEASE/SENTRY_DIST, run from " +
        "Xcode, or pass --no-auto-release."
    );
  }
  return {
    dist: plist.build,
    release: `${plist.bundleId}@${plist.version}+${plist.build}`,
  };
}
