/**
 * Mobile build normalization for `sentry build upload`.
 *
 * Detects the build format from ZIP entry names and wraps the build into a
 * deterministic ZIP (STORE compression, fixed mtime) alongside a metadata
 * file, ready for chunk upload + assembly.
 *
 * Determinism matters: a byte-identical wrapper for an identical build lets the
 * server dedup already-uploaded chunks across re-uploads. We use STORE (level 0)
 * because APK/AAB/IPA are themselves already-compressed ZIPs — re-compressing
 * the wrapper would cost CPU for ~no size win — and a fixed modification time so
 * the output does not vary run to run.
 *
 * Note: the legacy Rust CLI compresses the wrapper with Zstd. STORE is chosen
 * here deliberately (simpler, no method-93 ZIP writer needed, avoids
 * double-compression). The tradeoff is that wrapper bytes differ from the Rust
 * CLI's, so chunks are not deduplicated across the two CLIs — only within this
 * one, which is what matters for repeated uploads from the same tool.
 *
 * Handles Android APK/AAB (file wrappers) and iOS XCArchive (directory) / IPA
 * (converted to an XCArchive layout). Unlike the legacy CLI, iOS is not gated to
 * Apple Silicon — the only native dependency was `Assets.car` parsing, which is
 * intentionally skipped (see `normalizeBuildDirectory`).
 */

import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { strToU8, unzipSync, type Zippable, zipSync } from "fflate";
import { CLI_VERSION } from "../constants.js";
import { logger } from "../logger.js";
import { walkFiles } from "../scan/walker.js";

const log = logger.withTag("build.normalize");

/** A recognized mobile build format. */
export type BuildFormat = "apk" | "aab" | "ipa" | "xcarchive";

/** ZIP local-file-header magic bytes (`PK\x03\x04`). */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/**
 * Fixed modification time for normalized ZIP entries. A constant timestamp
 * (the ZIP epoch, 1980-01-01) keeps the wrapper byte-deterministic so identical
 * builds produce identical chunks.
 */
const FIXED_MTIME = new Date("1980-01-01T00:00:00Z");

/** Name of the metadata file embedded in every normalized build ZIP. */
const METADATA_FILENAME = ".sentry-cli-metadata.txt";

/** Whether the bytes start with the ZIP local-file-header magic. */
function hasZipMagic(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, i) => bytes[i] === byte);
}

/**
 * List a ZIP's entry names without decompressing any entry.
 *
 * The fflate filter is invoked for every entry; returning `false` skips
 * decompression, so this only parses the central directory.
 */
function listZipEntryNames(content: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(content, {
    filter: (file) => {
      names.push(file.name);
      return false;
    },
  });
  return names;
}

/**
 * Detect the mobile build format from a file's bytes.
 *
 * APK/AAB/IPA are recognized by their ZIP entry names. Returns `null` for
 * anything unrecognized. (XCArchive is a directory, not a file, and is detected
 * by the caller.)
 *
 * @param content - The raw build file bytes.
 */
export function detectBuildFormat(content: Uint8Array): BuildFormat | null {
  if (!hasZipMagic(content)) {
    return null;
  }

  let names: string[];
  try {
    names = listZipEntryNames(content);
  } catch (err) {
    log.debug("Failed to read ZIP entries while detecting build format", err);
    return null;
  }

  const entries = new Set(names);
  // AAB is more specific than APK (an AAB also nests an AndroidManifest under
  // base/), so check it first.
  if (
    entries.has("BundleConfig.pb") &&
    entries.has("base/manifest/AndroidManifest.xml")
  ) {
    return "aab";
  }
  if (entries.has("AndroidManifest.xml")) {
    return "apk";
  }
  // IPA: a Payload/<name>.app/Info.plist entry (recognized so the caller can
  // emit an "iOS not yet supported" message rather than "unrecognized").
  if (names.some((name) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(name))) {
    return "ipa";
  }
  return null;
}

/** A Sentry build plugin parsed from `SENTRY_PIPELINE`. */
export type PipelinePlugin = { name: string; version: string };

/**
 * Parse a recognized Sentry plugin from a `SENTRY_PIPELINE` value.
 *
 * Format: `"<name>/<version>"` (e.g. `"sentry-gradle-plugin/4.12.0"`). Only the
 * gradle and fastlane plugins are recognized; anything else yields `null`.
 *
 * @param pipeline - The `SENTRY_PIPELINE` value, if set.
 */
export function parsePluginFromPipeline(
  pipeline: string | undefined
): PipelinePlugin | null {
  if (!pipeline) {
    return null;
  }
  const slash = pipeline.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  const name = pipeline.slice(0, slash);
  const version = pipeline.slice(slash + 1);
  if (
    version &&
    (name === "sentry-gradle-plugin" || name === "sentry-fastlane-plugin")
  ) {
    return { name, version };
  }
  return null;
}

/** Build the `.sentry-cli-metadata.txt` contents. */
function buildMetadataFile(plugin: PipelinePlugin | null): string {
  const version =
    process.env.SENTRY_CLI_INTEGRATION_TEST_VERSION_OVERRIDE ?? CLI_VERSION;
  let out = `sentry-cli-version: ${version}\n`;
  if (plugin) {
    out += `${plugin.name}: ${plugin.version}\n`;
  }
  return out;
}

/**
 * Wrap a build file into a deterministic normalized ZIP for upload.
 *
 * The ZIP stores the build under its basename plus `.sentry-cli-metadata.txt`,
 * using STORE (no compression) and a fixed mtime so identical inputs produce
 * identical bytes.
 *
 * @param filePath - Path to the build file (its basename becomes the ZIP entry).
 * @param content - The raw build file bytes.
 * @param plugin - Optional plugin identity for the metadata file.
 * @returns The normalized ZIP bytes.
 */
export function normalizeBuildFile(
  filePath: string,
  content: Uint8Array,
  plugin: PipelinePlugin | null
): Buffer {
  const entryOptions = { level: 0 as const, mtime: FIXED_MTIME };
  const zipped = zipSync({
    [basename(filePath)]: [content, entryOptions],
    [METADATA_FILENAME]: [strToU8(buildMetadataFile(plugin)), entryOptions],
  });
  return Buffer.from(zipped);
}

/** Deterministic STORE + fixed-mtime options for a normalized ZIP entry. */
const ENTRY_OPTIONS = { level: 0 as const, mtime: FIXED_MTIME };

/**
 * Wrap an XCArchive directory into a deterministic normalized ZIP for upload.
 *
 * Every file under `dirPath` is stored under `<dir-basename>/<relative-path>`
 * (STORE, fixed mtime, sorted for byte-stability) alongside a root
 * `.sentry-cli-metadata.txt`, mirroring the legacy CLI's `normalize_directory`.
 *
 * Fidelity gaps (documented): symlinks are followed and stored as their target
 * content (not preserved as symlink entries), Unix permissions are not
 * preserved (a `zipSync` limitation), and `Assets.car` asset catalogs are not
 * parsed into per-asset images (that required native macOS frameworks).
 *
 * The whole directory is read into memory; a very large XCArchive (e.g. with
 * dSYMs) could exceed Node's ~2 GiB Buffer cap — streaming is a follow-up.
 *
 * @param dirPath - Path to the XCArchive directory.
 * @param plugin - Optional plugin identity for the metadata file.
 * @returns The normalized ZIP bytes.
 */
export async function normalizeBuildDirectory(
  dirPath: string,
  plugin: PipelinePlugin | null
): Promise<Buffer> {
  const root = resolve(dirPath);
  const dirName = basename(root);

  // Collect relative paths first so we can sort for deterministic output.
  const relativePaths: string[] = [];
  for await (const entry of walkFiles({
    cwd: root,
    respectGitignore: false,
    alwaysSkipDirs: [],
    maxFileSize: Number.POSITIVE_INFINITY,
    followSymlinks: true,
    classifyBinary: false,
  })) {
    relativePaths.push(entry.relativePath);
  }
  relativePaths.sort();

  const entries: Zippable = {};
  for (const relativePath of relativePaths) {
    const content = await readFile(join(root, relativePath));
    entries[`${dirName}/${relativePath}`] = [content, ENTRY_OPTIONS];
  }
  entries[METADATA_FILENAME] = [
    strToU8(buildMetadataFile(plugin)),
    ENTRY_OPTIONS,
  ];

  return Buffer.from(zipSync(entries));
}

/** Regex matching an IPA's single `Payload/<name>.app/Info.plist` entry. */
const IPA_APP_INFO_PLIST = /^Payload\/([^/]+)\.app\/Info\.plist$/;

/**
 * Extract the single app name from an IPA's entry names.
 *
 * @throws {Error} If the IPA does not contain exactly one `.app`.
 */
export function extractIpaAppName(names: string[]): string {
  const appNames = new Set<string>();
  for (const name of names) {
    const match = IPA_APP_INFO_PLIST.exec(name);
    if (match?.[1]) {
      appNames.add(match[1]);
    }
  }
  const appName = appNames.values().next().value;
  if (appNames.size !== 1 || appName === undefined) {
    throw new Error("IPA did not contain exactly one .app");
  }
  return appName;
}

/** Build the XCArchive `Info.plist` for a converted IPA. */
function xcarchiveInfoPlist(appName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>ApplicationProperties</key>
	<dict>
		<key>ApplicationPath</key>
		<string>Applications/${appName}.app</string>
	</dict>
	<key>ArchiveVersion</key>
	<integer>1</integer>
</dict>
</plist>`;
}

/**
 * Convert an IPA into a deterministic normalized XCArchive ZIP for upload.
 *
 * The IPA (a ZIP of `Payload/<app>.app/…`) is remapped in-memory into an
 * XCArchive layout — `archive.xcarchive/Products/Applications/<app>.app/…` plus
 * a generated `archive.xcarchive/Info.plist` — and stored (STORE, fixed mtime)
 * alongside a root `.sentry-cli-metadata.txt`. Mirrors the legacy CLI's
 * `ipa_to_xcarchive` + `normalize_directory`.
 *
 * @param content - The raw IPA bytes.
 * @param plugin - Optional plugin identity for the metadata file.
 * @returns The normalized ZIP bytes.
 * @throws {Error} If the IPA does not contain exactly one `.app`.
 */
export function normalizeIpa(
  content: Uint8Array,
  plugin: PipelinePlugin | null
): Buffer {
  const ipaEntries = unzipSync(content);
  const appName = extractIpaAppName(Object.keys(ipaEntries));

  const archiveDir = "archive.xcarchive";
  const entries: Zippable = {};
  for (const [name, bytes] of Object.entries(ipaEntries)) {
    // Directory entries (trailing "/") carry no data; skip them.
    if (name.endsWith("/")) {
      continue;
    }
    const stripped = name.startsWith("Payload/")
      ? name.slice("Payload/".length)
      : null;
    if (stripped) {
      entries[`${archiveDir}/Products/Applications/${stripped}`] = [
        bytes,
        ENTRY_OPTIONS,
      ];
    }
  }
  entries[`${archiveDir}/Info.plist`] = [
    strToU8(xcarchiveInfoPlist(appName)),
    ENTRY_OPTIONS,
  ];
  entries[METADATA_FILENAME] = [
    strToU8(buildMetadataFile(plugin)),
    ENTRY_OPTIONS,
  ];

  return Buffer.from(zipSync(entries));
}
