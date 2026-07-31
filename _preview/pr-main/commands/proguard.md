---
title: "proguard"
description: "Proguard commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-main/commands/proguard/"
---

# proguard

Work with ProGuard/R8 mapping files

## Commands

### `sentry proguard upload <path...>`

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

Compute the UUID for a ProGuard mapping file

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path>` | Path to the ProGuard mapping file |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

```bash
# Compute the UUID for a ProGuard/R8 mapping file
sentry proguard uuid ./app/build/outputs/mapping/release/mapping.txt


# Output as JSON (includes the file path)
sentry proguard uuid mapping.txt --json
```


## Important Notes

- The UUID is **deterministically derived from the mapping file contents** —
  identical files always produce the same UUID. This is the same value
  Sentry uses to associate a mapping with obfuscated Android stack traces.
- This matches the UUID computed by the legacy `sentry-cli proguard uuid`
  command byte-for-byte.

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-main/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-main/commands.md)
- [Previous: org](https://cli.sentry.dev/_preview/pr-main/commands/org.md)
- [Next: project](https://cli.sentry.dev/_preview/pr-main/commands/project.md)
