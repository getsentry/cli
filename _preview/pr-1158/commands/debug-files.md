---
title: "debug-files"
description: "Debug-files commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1158/commands/debug-files/"
---

# debug-files

Work with debug information files

## Commands

[Section titled “Commands”](#commands)

### `sentry debug-files check <path>`

[Section titled “sentry debug-files check <path>”](#sentry-debug-files-check-path)

Inspect a debug information file

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path>` | Path to the debug information file |

### `sentry debug-files upload <path...>`

[Section titled “sentry debug-files upload <path...>”](#sentry-debug-files-upload-path)

Upload debug information files to Sentry

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path...>` | Files or directories to scan for debug information files |

**Options:**

| Option | Description |
| --- | --- |
| `-t, --type <type>...` | Only upload files of this type (repeatable): dsym, elf, pe, pdb, portablepdb, wasm, breakpad, sourcebundle, jvm |
| `--id <id>...` | Only upload the object with this debug id (repeatable) |
| `--require-all` | Fail if any --id value was not found among scanned files |
| `--no-debug` | Do not upload files whose only feature is debug/symbol info |
| `--no-unwind` | Do not upload files whose only feature is unwind info |
| `--no-sources` | Do not upload files whose only feature is source info |
| `--include-sources` | Build and upload a source bundle for each file with debug info |
| `--derived-data` | Also scan Xcode's DerivedData folder (macOS only) |
| `--no-zips` | Do not scan inside .zip archives |
| `--no-upload` | Scan and print what would be uploaded without uploading |
| `--wait` | Wait for server-side processing and report any errors |
| `--wait-for <wait-for>` | Wait up to this many seconds for server-side processing |

### `sentry debug-files print-sources <path>`

[Section titled “sentry debug-files print-sources <path>”](#sentry-debug-files-print-sources-path)

List the source files a debug file references

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path>` | Path to the debug information file |

### `sentry debug-files bundle-sources <path>`

[Section titled “sentry debug-files bundle-sources <path>”](#sentry-debug-files-bundle-sources-path)

Bundle a debug file's source files for source context

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path>` | Path to the debug information file |

**Options:**

| Option | Description |
| --- | --- |
| `-o, --output <output>` | Output path for the source bundle ZIP (default: .src.zip) |

### `sentry debug-files bundle-jvm <path>`

[Section titled “sentry debug-files bundle-jvm <path>”](#sentry-debug-files-bundle-jvm-path)

Create a JVM source bundle for source context

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path>` | Directory containing JVM source files |

**Options:**

| Option | Description |
| --- | --- |
| `-o, --output <output>` | Output directory for the bundle ZIP |
| `-d, --debug-id <debug-id>` | Debug ID (UUID) to stamp on the bundle |
| `-e, --exclude <exclude>...` | Additional directory names to exclude (repeatable) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# Inspect a debug information file (auto-detects the format)sentry debug-files check ./libexample.sosentry debug-files check MyApp.dSYM/Contents/Resources/DWARF/MyAppsentry debug-files check ./app.pdb --json
# List the source files a debug file references (and whether they're available)sentry debug-files print-sources ./libexample.sosentry debug-files print-sources ./app.pdb --json
# Bundle a debug file's referenced source files (run on the build machine)sentry debug-files bundle-sources ./libexample.sosentry debug-files bundle-sources ./app.pdb --output ./app.src.zip
# Bundle JVM sources with a debug IDsentry debug-files bundle-jvm --output ./out --debug-id <uuid> ./src
# Exclude additional directoriessentry debug-files bundle-jvm --output ./out --debug-id <uuid> --exclude generated --exclude build-tools ./src
# Output as JSONsentry debug-files bundle-jvm --output ./out --debug-id <uuid> --json ./src
# Upload debug information files (scans directories recursively)sentry debug-files upload ./buildsentry debug-files upload ./libexample.so --include-sources
# .zip archives are scanned in place; use --no-zips to skip themsentry debug-files upload ./symbols.zipsentry debug-files upload ./build --no-zips
# Restrict by type or debug id, and wait for server-side processingsentry debug-files upload ./dsyms --type dsym --waitsentry debug-files upload ./build --id <debug-id> --require-all
# Preview what would be uploaded without uploading (no credentials needed)sentry debug-files upload ./build --no-upload
```
