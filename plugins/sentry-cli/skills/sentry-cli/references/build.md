---
name: sentry-cli-build
version: 0.39.0-dev.0
description: Manage mobile build artifacts
requires:
  bins: ["sentry"]
  auth: true
---

# Build Commands

Manage mobile build artifacts

### `sentry build download <build-id>`

Download a build artifact

**Flags:**
- `-o, --output <value> - Output path (default: preprod_artifact_<build-id>.<ext> in the current directory)`

**Examples:**

```bash
# Download a build artifact by ID
sentry build download 1234567890

# Download to a specific path
sentry build download 1234567890 --output ./app.ipa

# Output the result as JSON
sentry build download 1234567890 --json
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
