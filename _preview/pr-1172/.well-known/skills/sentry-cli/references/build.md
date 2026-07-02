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

### `sentry build upload <path...>`

Upload builds to a project

**Flags:**
- `--build-configuration <value> - Build configuration for the upload (defaults to the current version)`
- `--release-notes <value> - Release notes for the build`
- `--install-group <value>... - Install group(s) for this build (repeatable); builds sharing a group show updates for each other`

### `sentry build download <build-id>`

Download a build artifact

**Flags:**
- `-o, --output <value> - Output path (default: preprod_artifact_<build-id>.<ext> in the current directory)`

**Examples:**

```bash
# Upload an Android build (APK or AAB) for size analysis
sentry build upload ./app-release.apk

# Upload with a build configuration and release notes
sentry build upload ./app.aab --build-configuration Release --release-notes "Nightly"

# Tag a build with install groups (repeatable)
sentry build upload ./app.aab --install-group qa --install-group beta

# Download a build artifact by ID
sentry build download 1234567890

# Download to a specific path
sentry build download 1234567890 --output ./app.ipa

# Output the result as JSON
sentry build download 1234567890 --json
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
