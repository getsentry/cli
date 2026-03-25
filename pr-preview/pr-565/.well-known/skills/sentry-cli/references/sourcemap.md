---
name: sentry-cli-sourcemap
version: 0.21.0-dev.0
description: Sentry CLI sourcemap commands
requires:
  bins: ["sentry"]
  auth: true
---

# sourcemap Commands

Manage sourcemaps

### `sentry sourcemap inject <directory>`

Inject debug IDs into JavaScript files and sourcemaps

**Flags:**
- `--ext <value> - Comma-separated file extensions to process (default: .js,.cjs,.mjs)`
- `--dry-run - Show what would be modified without writing`

### `sentry sourcemap upload <directory>`

Upload sourcemaps to Sentry

**Flags:**
- `--release <value> - Release version to associate with the upload`
- `--url-prefix <value> - URL prefix for uploaded files (default: ~/) - (default: "~/")`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
