---
title: trace
description: Trace commands for the Sentry CLI
---

Inspect and browse distributed traces from Sentry projects.

## Commands

### `sentry trace list`

List recent traces in a project.

```bash
# Auto-detect from DSN or config
sentry trace list

# Explicit org and project
sentry trace list <org>/<project>

# Search for project across all accessible orgs
sentry trace list <project>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>/<project>` | Explicit organization and project (e.g., `my-org/backend`) |
| `<project>` | Search for project by name across all accessible organizations |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <n>` | Number of traces to show (1-1000, default: 20) |
| `-q, --query <query>` | Search query (Sentry search syntax) |
| `-s, --sort <field>` | Sort by: `date`, `duration` (default: `date`) |
| `--period <period>` | Time period (e.g., `24h`, `7d`, `14d`; default: `7d`) |
| `-c, --cursor <dir>` | Pagination cursor (`next` or `prev`) |
| `--json` | Output as JSON |

**Examples:**

```bash
# List last 20 traces (default)
sentry trace list

# Sort by slowest first
sentry trace list --sort duration

# Filter by transaction name, last 24 hours
sentry trace list -q "transaction:GET /api/users" --period 24h

# Paginate through results
sentry trace list my-org/backend -c next
```

### `sentry trace view`

View details of a specific trace, including a span tree.

```bash
# Auto-detect org from DSN or config
sentry trace view <trace-id>

# Explicit org and project
sentry trace view <org>/<project>/<trace-id>

# Search for project across all accessible orgs
sentry trace view <project> <trace-id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<trace-id>` | The 32-character hexadecimal trace ID |
| `<org>/<project>/<trace-id>` | Explicit organization, project, and trace ID |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `--spans <depth>` | Span tree depth limit (number, `all` for unlimited, `no` to disable) |
| `--json` | Output as JSON |

**Examples:**

```bash
# View trace details with span tree
sentry trace view abc123def456abc123def456abc12345

# Open trace in browser
sentry trace view abc123def456abc123def456abc12345 -w

# Auto-recover from an issue short ID
sentry trace view PROJ-123
```

### `sentry trace logs`

View logs associated with a specific trace.

```bash
# Auto-detect org
sentry trace logs <trace-id>

# Explicit org
sentry trace logs <org>/<trace-id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<trace-id>` | The 32-character hexadecimal trace ID |
| `<org>/<trace-id>` | Explicit organization and trace ID |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open trace in browser |
| `-t, --period <period>` | Time period to search (e.g., `14d`, `7d`, `24h`; default: `14d`) |
| `-n, --limit <n>` | Number of log entries (max 1000, default: 100) |
| `-q, --query <query>` | Additional filter query (Sentry search syntax) |
| `--json` | Output as JSON |

**Examples:**

```bash
# View logs for a trace
sentry trace logs abc123def456abc123def456abc12345

# Search with a longer time window
sentry trace logs --period 30d abc123def456abc123def456abc12345

# Filter logs within a trace
sentry trace logs -q 'level:error' abc123def456abc123def456abc12345
```
