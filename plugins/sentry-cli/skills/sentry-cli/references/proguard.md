---
name: sentry-cli-proguard
version: 0.36.0-dev.0
description: Work with ProGuard/R8 mapping files
requires:
  bins: ["sentry"]
  auth: true
---

# Proguard Commands

Work with ProGuard/R8 mapping files

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
