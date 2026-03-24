---
name: sentry-cli-sourcemaps
version: 0.21.0-dev.0
description: Sentry CLI sourcemaps commands
requires:
  bins: ["sentry"]
  auth: true
---

# sourcemaps Commands

Manage sourcemaps

### `sentry sourcemaps inject <directory>`

Inject debug IDs into JavaScript files and sourcemaps

**Flags:**
- `--ext <value> - Comma-separated file extensions to process (default: .js,.cjs,.mjs)`
- `--dry-run - Show what would be modified without writing`

### `sentry sourcemaps upload <directory>`

Upload sourcemaps to Sentry

**Flags:**
- `--release <value> - Release version to associate with the upload`
- `--url-prefix <value> - URL prefix for uploaded files (default: ~/) - (default: "~/")`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
