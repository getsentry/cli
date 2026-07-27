---
name: sentry-cli-proguard
version: 0.39.0-dev.0
description: Work with ProGuard/R8 mapping files
requires:
  bins: ["sentry"]
  auth: true
---

# Proguard Commands

Work with ProGuard/R8 mapping files

### `sentry proguard upload <path...>`

Upload ProGuard/R8 mapping files to Sentry

**Flags:**
- `--uuid <value> - Force a specific UUID instead of computing from file content (only valid with a single file)`
- `--no-upload - Compute and print UUIDs without uploading (dry-run)`
- `--require-one - Require at least one mapping file (error if none provided)`

### `sentry proguard uuid <path>`

Compute the UUID for a ProGuard mapping file

**Examples:**

```bash
# Upload a ProGuard/R8 mapping file (auto-detects org/project)
sentry proguard upload ./app/build/outputs/mapping/release/mapping.txt

# Upload with a specific UUID (overrides content-derived UUID)
sentry proguard upload mapping.txt --uuid 5db7294d-87fc-5726-a5c0-4a90679657a5

# Dry-run: compute UUIDs without uploading
sentry proguard upload mapping.txt --no-upload

# Upload multiple mapping files at once
sentry proguard upload mapping-release.txt mapping-debug.txt

# Compute the UUID for a mapping file (without uploading)
sentry proguard uuid ./app/build/outputs/mapping/release/mapping.txt

# Output UUID as JSON (includes the file path)
sentry proguard uuid mapping.txt --json
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
