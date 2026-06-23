---
name: sentry-cli-proguard
version: 0.38.0-dev.0
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
# Upload a ProGuard/R8 mapping file (org/project auto-detected)
sentry proguard upload ./app/build/outputs/mapping/release/mapping.txt

# Upload multiple mapping files
sentry proguard upload mapping-app.txt mapping-lib.txt

# Upload with a specific UUID (overrides the computed UUID)
sentry proguard upload --uuid abcdef01-2345-6789-abcd-ef0123456789 mapping.txt

# Validate without uploading
sentry proguard upload --no-upload mapping.txt
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
