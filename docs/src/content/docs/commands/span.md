---
title: span
description: Span commands for the Sentry CLI
---

List and inspect spans from Sentry projects or within specific traces.

## Commands

### `sentry span list`

List spans in a project or within a specific trace.

```bash
# Project mode — list spans across the project
sentry span list
sentry span list <org>/<project>
sentry span list <project>

# Trace mode — list spans within a specific trace
sentry span list <trace-id>
sentry span list <org>/<project>/<trace-id>
sentry span list <project> <trace-id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>/<project>` | Explicit organization and project (project mode) |
| `<project>` | Search for project by name across all accessible organizations |
| `<trace-id>` | 32-character hex trace ID to list spans within (trace mode) |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <n>` | Number of spans (max 1000, default: 25) |
| `-q, --query <query>` | Filter spans (e.g., `"op:db"`, `"duration:>100ms"`) |
| `-s, --sort <field>` | Sort order: `date`, `duration` (default: `date`) |
| `--period <period>` | Time period (e.g., `24h`, `7d`; default: `7d`) |
| `-c, --cursor <dir>` | Pagination cursor (`next` or `prev`) |
| `--json` | Output as JSON |

**Examples:**

```bash
# List recent spans in the current project
sentry span list

# Find all DB spans
sentry span list -q "op:db"

# Slow spans in the last 24 hours
sentry span list -q "duration:>100ms" --period 24h

# List spans within a specific trace
sentry span list abc123def456abc123def456abc12345

# Paginate through results
sentry span list -c next
```

### `sentry span view`

View detailed information about one or more spans within a trace.

```bash
sentry span view <trace-id> <span-id>
sentry span view <org>/<project>/<trace-id> <span-id>
sentry span view <trace-id> <span-id> <span-id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<trace-id>` | The 32-character hexadecimal trace ID (optionally prefixed with `<org>/<project>/`) |
| `<span-id>` | One or more 16-character hexadecimal span IDs |

**Options:**

| Option | Description |
|--------|-------------|
| `--spans <depth>` | Span tree depth limit (number, `all` for unlimited, `no` to disable) |
| `--json` | Output as JSON |

**Examples:**

```bash
# View a single span
sentry span view abc123def456abc123def456abc12345 a1b2c3d4e5f67890

# View multiple spans at once
sentry span view abc123def456abc123def456abc12345 a1b2c3d4e5f67890 b2c3d4e5f6789012

# With explicit org/project
sentry span view my-org/backend/abc123def456abc123def456abc12345 a1b2c3d4e5f67890
```
