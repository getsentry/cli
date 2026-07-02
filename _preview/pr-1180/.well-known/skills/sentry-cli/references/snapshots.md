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

### `sentry snapshots download`

Download baseline snapshot images

**Flags:**
- `--app-id <value> - App identifier (e.g. my-app) to resolve the latest baseline; mutually exclusive with --snapshot-id`
- `--snapshot-id <value> - Direct snapshot artifact ID; mutually exclusive with --app-id`
- `--branch <value> - Git branch filter (only with --app-id)`
- `-o, --output <value> - Directory for extracted images (default: ./snapshots-base/)`

**Examples:**

```bash
# Download a specific baseline snapshot by ID
sentry snapshots download --snapshot-id 1234567890

# Download the latest baseline for an app, filtered by branch
sentry snapshots download --app-id my-app --branch main

# Extract images to a specific directory
sentry snapshots download --app-id my-app --output ./baseline/
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
