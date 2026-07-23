---
title: "dart-symbol-map"
description: "Dart-symbol-map commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-main/commands/dart-symbol-map/"
---

# dart-symbol-map

Work with Dart/Flutter symbol maps

## Commands

### `sentry dart-symbol-map upload <path>`

Upload a Dart/Flutter symbol map to Sentry

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path>` | Path to the dart symbol map JSON file |

**Options:**

| Option | Description |
| --- | --- |
| `-d, --debug-id <debug-id>` | Debug ID (UUID) from the companion native debug file |
| `--no-upload` | Validate the file without uploading (dry-run) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

```bash
# Upload a dart symbol map with a debug ID
sentry dart-symbol-map upload --debug-id 12345678-1234-1234-1234-123456789abc mapping.json


# Validate without uploading
sentry dart-symbol-map upload --debug-id 12345678-1234-1234-1234-123456789abc mapping.json --no-upload


# Output as JSON
sentry dart-symbol-map upload --debug-id 12345678-1234-1234-1234-123456789abc mapping.json --json
```


## Important Notes

- The `--debug-id` flag is **required** — it associates the map with a native
  debug file (dSYM/ELF). The sentry-dart-plugin extracts this automatically.
- The mapping file must be a **JSON array of strings** with an even number of
  entries (alternating obfuscated/original name pairs).
- Supported on Sentry SaaS and self-hosted >= 25.8.0.

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-main/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-main/commands.md)
- [Previous: code-mappings](https://cli.sentry.dev/_preview/pr-main/commands/code-mappings.md)
- [Next: dashboard](https://cli.sentry.dev/_preview/pr-main/commands/dashboard.md)
