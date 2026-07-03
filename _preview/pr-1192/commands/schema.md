---
title: "schema"
description: "Schema command for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1192/commands/schema/"
---

# schema

Browse the Sentry API schema

## Usage

[Section titled “Usage”](#usage)

### `sentry schema <resource...>`

[Section titled “sentry schema <resource...>”](#sentry-schema-resource)

Browse the Sentry API schema

**Arguments:**

| Argument | Description |
| --- | --- |
| `<resource...>` | Resource name and optional operation |

**Options:**

| Option | Description |
| --- | --- |
| `--all` | Show all endpoints in a flat list |
| `-q, --search <search>` | Search endpoints by keyword |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# List all API resourcessentry schema
# Browse issue endpointssentry schema issues
# View details for a specific operationsentry schema issues list
# Search for monitoring-related endpointssentry schema --search monitor
# Flat list of every endpointsentry schema --all
```
