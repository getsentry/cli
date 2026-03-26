---
title: schema
description: Schema commands for the Sentry CLI
---

Browse and search the Sentry API schema. Shows available resources, operations, and endpoint details.

## Usage

```bash
# List all API resources
sentry schema

# Show endpoints for a resource
sentry schema <resource>

# Show details for a specific endpoint
sentry schema <resource> <operation>

# Glob-match resources
sentry schema monitor*
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<resource>` | Resource name (e.g., `issues`, `projects`). Supports glob patterns. |
| `<operation>` | Operation name within a resource (e.g., `list`, `create`) |

**Options:**

| Option | Description |
|--------|-------------|
| `--all` | Show all endpoints in a flat list |
| `-q, --search <query>` | Search endpoints by keyword |
| `--json` | Output as JSON |

**Examples:**

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
