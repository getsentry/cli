---
title: sourcemap
description: Sourcemap commands for the Sentry CLI
---

Inject debug IDs and upload sourcemaps to Sentry for readable stack traces.

## Commands

### `sentry sourcemap inject`

Inject Sentry debug IDs into JavaScript files and their companion sourcemaps.

```bash
sentry sourcemap inject <directory>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<directory>` | Directory to scan for JS + sourcemap pairs |

**Options:**

| Option | Description |
|--------|-------------|
| `--ext <extensions>` | Comma-separated file extensions to process (default: `.js,.cjs,.mjs`) |
| `--dry-run` | Show what would be modified without writing |

The injection is idempotent -- files that already have debug IDs are skipped.

**Examples:**

```bash
# Inject debug IDs into all JS files in dist/
sentry sourcemap inject ./dist

# Preview changes without writing
sentry sourcemap inject ./dist --dry-run

# Only process specific extensions
sentry sourcemap inject ./build --ext .js,.mjs
```

### `sentry sourcemap upload`

Upload JavaScript sourcemaps to Sentry using debug-ID-based matching.

```bash
sentry sourcemap upload <directory>
```

Automatically injects debug IDs into any files that don't already have them. Org and project are auto-detected from DSN, env vars, or config defaults.

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<directory>` | Directory containing sourcemaps |

**Options:**

| Option | Description |
|--------|-------------|
| `--release <version>` | Release version to associate with the upload |
| `--url-prefix <prefix>` | URL prefix for uploaded files (default: `~/`) |

**Examples:**

```bash
# Upload sourcemaps from dist/
sentry sourcemap upload ./dist

# Associate with a release
sentry sourcemap upload ./dist --release 1.0.0

# Set a custom URL prefix
sentry sourcemap upload ./dist --url-prefix '~/static/js/'
```
