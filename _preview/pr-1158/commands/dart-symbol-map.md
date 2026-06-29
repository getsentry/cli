---
title: "dart-symbol-map"
description: "Dart-symbol-map commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1158/commands/dart-symbol-map/"
---

# dart-symbol-map

Work with Dart/Flutter symbol maps

## Commands

[Section titled “Commands”](#commands)

### `sentry dart-symbol-map upload <path>`

[Section titled “sentry dart-symbol-map upload <path>”](#sentry-dart-symbol-map-upload-path)

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

[Section titled “Examples”](#examples)
Terminal window

```
# Upload a dart symbol map with a debug IDsentry dart-symbol-map upload --debug-id 12345678-1234-1234-1234-123456789abc mapping.json
# Validate without uploadingsentry dart-symbol-map upload --debug-id 12345678-1234-1234-1234-123456789abc mapping.json --no-upload
# Output as JSONsentry dart-symbol-map upload --debug-id 12345678-1234-1234-1234-123456789abc mapping.json --json
```


## Important Notes

[Section titled “Important Notes”](#important-notes)

- The `--debug-id` flag is **required** — it associates the map with a native
  debug file (dSYM/ELF). The sentry-dart-plugin extracts this automatically.
- The mapping file must be a **JSON array of strings** with an even number of
  entries (alternating obfuscated/original name pairs).
- Supported on Sentry SaaS and self-hosted >= 25.8.0.
