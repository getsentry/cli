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
# Upload a ProGuard/R8 mapping file
sentry proguard upload ./app/build/outputs/mapping/release/mapping.txt

# Upload multiple mapping files at once
sentry proguard upload mapping1.txt mapping2.txt

# Preview without uploading (dry run)
sentry proguard upload mapping.txt --no-upload

# Force a specific UUID instead of computing from content
sentry proguard upload mapping.txt --uuid 12345678-1234-1234-1234-123456789abc

# Require at least one mapping file (exit non-zero if none found)
sentry proguard upload ./mappings/ --require-one
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
