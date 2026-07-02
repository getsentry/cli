---
name: sentry-cli-snapshots
version: 0.39.0-dev.0
description: Manage and compare snapshots
requires:
  bins: ["sentry"]
  auth: true
---

# Snapshots Commands

Manage and compare snapshots

### `sentry snapshots diff <base-dir> <head-dir>`

Compare two directories of snapshot images

**Flags:**
- `-o, --output <value> - Directory for diff mask images (default: ./diff-output/)`
- `--threshold <value> - Pixel color difference threshold (0.0-1.0) - (default: "0.01")`
- `--no-antialiasing - Disable antialiasing detection`
- `--fail-on-diff - Exit non-zero if any diffs (changed/added/removed/errored) are found`
- `--selective - Treat images missing from head as skipped instead of removed`

### `sentry snapshots download`

Download baseline snapshot images

**Flags:**
- `--app-id <value> - App identifier (e.g. my-app) to resolve the latest baseline; mutually exclusive with --snapshot-id`
- `--snapshot-id <value> - Direct snapshot artifact ID; mutually exclusive with --app-id`
- `--branch <value> - Git branch filter (only with --app-id)`
- `-o, --output <value> - Directory for extracted images (default: ./snapshots-base/)`

**Examples:**

```bash
# Compare two directories of snapshot images locally
sentry snapshots diff ./baseline ./head

# Fail (non-zero exit) if any images changed, with a custom threshold
sentry snapshots diff ./baseline ./head --fail-on-diff --threshold 0.02

# Download a specific baseline snapshot by ID
sentry snapshots download --snapshot-id 1234567890

# Download the latest baseline for an app, filtered by branch
sentry snapshots download --app-id my-app --branch main

# Extract images to a specific directory
sentry snapshots download --app-id my-app --output ./baseline/
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
