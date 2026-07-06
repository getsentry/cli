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

**Examples:**

```bash
# Upload a single ProGuard/R8 mapping file
sentry proguard upload ./app/build/outputs/mapping/release/mapping.txt

# Upload multiple mapping files at once
sentry proguard upload build/mapping1.txt build/mapping2.txt

# Force a specific UUID instead of computing from content
sentry proguard upload mapping.txt --uuid 5db7294d-87fc-5726-a5c0-4a90679657a5

# Dry-run: compute UUIDs without uploading
sentry proguard upload mapping.txt --no-upload

# Require at least one file (useful in CI)
sentry proguard upload mapping.txt --require-one
```

### `sentry proguard uuid <path>`

Compute the UUID for a ProGuard mapping file

**Examples:**

```bash
# Compute the UUID for a ProGuard/R8 mapping file
sentry proguard uuid ./app/build/outputs/mapping/release/mapping.txt

# Output as JSON (includes the file path)
sentry proguard uuid mapping.txt --json
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
