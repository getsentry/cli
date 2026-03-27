---
title: sourcemap
description: Sourcemap commands for the Sentry CLI
---

Manage sourcemaps

## Commands

### `sentry sourcemap inject <directory>`

Inject debug IDs into JavaScript files and sourcemaps

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<directory>` | Directory to scan for JS + sourcemap pairs |

**Options:**

| Option | Description |
|--------|-------------|
| `--ext <ext>` | Comma-separated file extensions to process (default: .js,.cjs,.mjs) |
| `--dry-run` | Show what would be modified without writing |

### `sentry sourcemap upload <directory>`

Upload sourcemaps to Sentry

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<directory>` | Directory containing sourcemaps |

**Options:**

| Option | Description |
|--------|-------------|
| `--release <release>` | Release version to associate with the upload |
| `--url-prefix <url-prefix>` | URL prefix for uploaded files (default: ~/) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

### Inject debug IDs

```bash
# Inject debug IDs into all JS files in dist/
sentry sourcemap inject ./dist

# Preview changes without writing
sentry sourcemap inject ./dist --dry-run

# Only process specific extensions
sentry sourcemap inject ./build --ext .js,.mjs
```

### Upload sourcemaps

```bash
# Upload sourcemaps from dist/
sentry sourcemap upload ./dist

# Associate with a release
sentry sourcemap upload ./dist --release 1.0.0

# Set a custom URL prefix
sentry sourcemap upload ./dist --url-prefix '~/static/js/'
```
