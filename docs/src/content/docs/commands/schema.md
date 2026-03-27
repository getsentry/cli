---
title: schema
description: Schema command for the Sentry CLI
---

Browse the Sentry API schema

## Usage

### `sentry schema <resource...>`

Browse the Sentry API schema

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<resource...>` | Resource name and optional operation (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `--all` | Show all endpoints in a flat list |
| `-q, --search <search>` | Search endpoints by keyword |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# List all API resources
sentry schema

# Browse issue endpoints
sentry schema issues

# View details for a specific operation
sentry schema issues list

# Search for monitoring-related endpoints
sentry schema --search monitor

# Flat list of every endpoint
sentry schema --all
```
