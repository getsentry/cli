---
title: "proguard"
description: "Proguard commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1229/commands/proguard/"
---

# proguard

Work with ProGuard/R8 mapping files

## Commands

[Section titled “Commands”](#commands)

### `sentry proguard upload <path...>`

[Section titled “sentry proguard upload <path...>”](#sentry-proguard-upload-path)

Upload ProGuard/R8 mapping files to Sentry

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path...>` | Paths to ProGuard/R8 mapping files |

**Options:**

| Option | Description |
| --- | --- |
| `--uuid <uuid>` | Force a specific UUID instead of computing from file content (only valid with a single file) |
| `--no-upload` | Compute and print UUIDs without uploading (dry-run) |
| `--require-one` | Require at least one mapping file (error if none provided) |

### `sentry proguard uuid <path>`

[Section titled “sentry proguard uuid <path>”](#sentry-proguard-uuid-path)

Compute the UUID for a ProGuard mapping file

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path>` | Path to the ProGuard mapping file |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### `sentry proguard upload`

[Section titled “sentry proguard upload”](#sentry-proguard-upload)
Terminal window

```
# Upload a ProGuard/R8 mapping filesentry proguard upload ./app/build/outputs/mapping/release/mapping.txt
# Upload multiple mapping filessentry proguard upload build/mapping1.txt build/mapping2.txt
# Force a specific UUID (single file only)sentry proguard upload mapping.txt --uuid 5db7294d-87fc-5726-a5c0-4a90679657a5
# Dry-run: compute UUIDs without uploadingsentry proguard upload mapping.txt --no-upload
# Require at least one mapping file (useful in CI)sentry proguard upload mapping.txt --require-one
```


### `sentry proguard uuid`

[Section titled “sentry proguard uuid”](#sentry-proguard-uuid)
Terminal window

```
# Compute the UUID for a ProGuard/R8 mapping filesentry proguard uuid ./app/build/outputs/mapping/release/mapping.txt
# Output as JSON (includes the file path)sentry proguard uuid mapping.txt --json
```


## Important Notes

[Section titled “Important Notes”](#important-notes)

- The UUID is **deterministically derived from the mapping file contents** —
  identical files always produce the same UUID. This is the same value
  Sentry uses to associate a mapping with obfuscated Android stack traces.
- This matches the UUID computed by the legacy `sentry-cli proguard uuid`
  command byte-for-byte.
- The `upload` command uses the DIF chunk-upload protocol; org/project are
  resolved via the standard auto-detection cascade (DSN, env vars, config defaults).
