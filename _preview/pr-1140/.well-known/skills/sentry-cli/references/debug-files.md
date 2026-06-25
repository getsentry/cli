---
name: sentry-cli-debug-files
version: 0.39.0-dev.0
description: Work with debug information files
requires:
  bins: ["sentry"]
  auth: true
---

# Debug-files Commands

Work with debug information files

### `sentry debug-files check <path>`

Inspect a debug information file

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
- `--derived-data - Also scan Xcode's DerivedData folder (macOS only)`
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

**Examples:**

```bash
# Inspect a debug information file (auto-detects the format)
sentry debug-files check ./libexample.so
sentry debug-files check MyApp.dSYM/Contents/Resources/DWARF/MyApp
sentry debug-files check ./app.pdb --json

# List the source files a debug file references (and whether they're available)
sentry debug-files print-sources ./libexample.so
sentry debug-files print-sources ./app.pdb --json

# Bundle a debug file's referenced source files (run on the build machine)
sentry debug-files bundle-sources ./libexample.so
sentry debug-files bundle-sources ./app.pdb --output ./app.src.zip

# Bundle JVM sources with a debug ID
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> ./src

# Exclude additional directories
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> --exclude generated --exclude build-tools ./src

# Output as JSON
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> --json ./src

# Upload debug information files (scans directories recursively)
sentry debug-files upload ./build
sentry debug-files upload ./libexample.so --include-sources

# Restrict by type or debug id, and wait for server-side processing
sentry debug-files upload ./dsyms --type dsym --wait
sentry debug-files upload ./build --id <debug-id> --require-all

# Preview what would be uploaded without uploading (no credentials needed)
sentry debug-files upload ./build --no-upload
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
