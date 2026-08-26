---
name: sentry-cli-debug-files
version: 0.44.0-dev.0
description: Work with debug information files
requires:
  bins: ["sentry"]
  auth: true
---

# Debug-files Commands

Work with debug information files

### `sentry debug-files check <path>`

Inspect a debug information file

### `sentry debug-files find <id...>`

Locate debug files for given debug identifiers

**Flags:**
- `-t, --type <value>... - Only consider debug files of the given type (repeatable). Default: all`
- `--no-well-known - Do not look for debug files in well-known locations`
- `--no-cwd - Do not look for debug files in the current directory`
- `-p, --path <value>... - Add a directory to search recursively (repeatable)`

### `sentry debug-files upload <path...>`

Upload debug information files to Sentry

**Flags:**
- `-t, --type <value>... - Only upload files of this type (repeatable): dsym, elf, pe, pdb, portablepdb, wasm, breakpad, sourcebundle, jvm`
- `--id <value>... - Only upload the object with this debug id (repeatable)`
- `--require-all - Fail if any --id value was not found among scanned files`
- `--no-debug - Do not upload files whose only feature is debug/symbol info`
- `--no-unwind - Do not upload files whose only feature is unwind info`
- `--no-sources - Do not upload files whose only feature is source info`
- `--include-sources - Build and upload a source bundle for each file with debug info`
- `--il2cpp-mapping - Compute and upload Unity IL2CPP line mappings for each scanned file`
- `--derived-data - Also scan Xcode's DerivedData folder (macOS only)`
- `--no-zips - Do not scan inside .zip archives`
- `--no-upload - Scan and print what would be uploaded without uploading`
- `--wait - Wait for server-side processing and report any errors`
- `--wait-for <value> - Wait up to this many seconds for server-side processing`

### `sentry debug-files print-sources <path>`

List the source files a debug file references

### `sentry debug-files bundle-sources <path>`

Bundle a debug file's source files for source context

**Flags:**
- `-o, --output <value> - Output path for the source bundle ZIP (default: <path>.src.zip)`

### `sentry debug-files bundle-jvm <path>`

Create a JVM source bundle for source context

**Flags:**
- `-o, --output <value> - Output directory for the bundle ZIP`
- `-d, --debug-id <value> - Debug ID (UUID) to stamp on the bundle`
- `-e, --exclude <value>... - Additional directory names to exclude (repeatable)`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
