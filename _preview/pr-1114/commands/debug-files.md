---
title: "debug-files"
description: "Debug-files commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1114/commands/debug-files/"
---

# debug-files

Work with debug information files

## Commands

[Section titled “Commands”](#commands)

### `sentry debug-files check <path>`

[Section titled “sentry debug-files check <path>”](#sentry-debug-files-check-path)

Inspect a debug information file

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path>` | Path to the debug information file |

### `sentry debug-files bundle-jvm <path>`

[Section titled “sentry debug-files bundle-jvm <path>”](#sentry-debug-files-bundle-jvm-path)

Create a JVM source bundle for source context

**Arguments:**

| Argument | Description |
| --- | --- |
| `<path>` | Directory containing JVM source files |

**Options:**

| Option | Description |
| --- | --- |
| `-o, --output <output>` | Output directory for the bundle ZIP |
| `-d, --debug-id <debug-id>` | Debug ID (UUID) to stamp on the bundle |
| `-e, --exclude <exclude>...` | Additional directory names to exclude (repeatable) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# Inspect a debug information file (auto-detects the format)sentry debug-files check ./libexample.sosentry debug-files check MyApp.dSYM/Contents/Resources/DWARF/MyAppsentry debug-files check ./app.pdb --json
# Bundle JVM sources with a debug IDsentry debug-files bundle-jvm --output ./out --debug-id <uuid> ./src
# Exclude additional directoriessentry debug-files bundle-jvm --output ./out --debug-id <uuid> --exclude generated --exclude build-tools ./src
# Output as JSONsentry debug-files bundle-jvm --output ./out --debug-id <uuid> --json ./src
```
