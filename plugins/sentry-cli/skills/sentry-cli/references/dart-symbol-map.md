---
name: sentry-cli-dart-symbol-map
version: 0.38.0-dev.0
description: Work with Dart/Flutter symbol maps
requires:
  bins: ["sentry"]
  auth: true
---

# Dart-symbol-map Commands

Work with Dart/Flutter symbol maps

### `sentry dart-symbol-map upload <path>`

Upload a Dart/Flutter symbol map to Sentry

**Flags:**
- `-d, --debug-id <value> - Debug ID (UUID) from the companion native debug file`
- `--no-upload - Validate the file without uploading (dry-run)`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
