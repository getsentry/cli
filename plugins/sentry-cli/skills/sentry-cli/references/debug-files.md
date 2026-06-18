---
name: sentry-cli-debug-files
version: 0.38.0-dev.0
description: Work with debug information files
requires:
  bins: ["sentry"]
  auth: true
---

# Debug-files Commands

Work with debug information files

### `sentry debug-files check <path>`

Inspect a debug information file

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

# Bundle JVM sources with a debug ID
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> ./src

# Exclude additional directories
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> --exclude generated --exclude build-tools ./src

# Output as JSON
sentry debug-files bundle-jvm --output ./out --debug-id <uuid> --json ./src
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
