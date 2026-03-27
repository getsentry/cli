---
title: trace
description: Trace commands for the Sentry CLI
---

View distributed traces

## Commands

### `sentry trace list <org/project>`

List recent traces in a project

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project>` | &lt;org&gt;/&lt;project&gt; or &lt;project&gt; (search) |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <limit>` | Number of traces (1-1000) (default: "20") |
| `-q, --query <query>` | Search query (Sentry search syntax) |
| `-s, --sort <sort>` | Sort by: date, duration (default: "date") |
| `-t, --period <period>` | Time period (e.g., "1h", "24h", "7d", "30d") (default: "7d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry trace view <org/project/trace-id...>`

View details of a specific trace

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project/trace-id...>` | [&lt;org&gt;/&lt;project&gt;/]&lt;trace-id&gt; - Target (optional) and trace ID (required) |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `--spans <spans>` | Span tree depth limit (number, "all" for unlimited, "no" to disable) (default: "3") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry trace logs <org/trace-id...>`

View logs associated with a trace

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/trace-id...>` | [&lt;org&gt;/]&lt;trace-id&gt; - Optional org and required trace ID |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open trace in browser |
| `-t, --period <period>` | Time period to search (e.g., "14d", "7d", "24h"). Default: 14d (default: "14d") |
| `-n, --limit <limit>` | Number of log entries (<=1000) (default: "100") |
| `-q, --query <query>` | Additional filter query (Sentry search syntax) |
| `-s, --sort <sort>` | Sort order: "newest" (default) or "oldest" (default: "newest") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

### List traces

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

### View a trace

```bash
# View trace details with span tree
sentry trace view abc123def456abc123def456abc12345

# Open trace in browser
sentry trace view abc123def456abc123def456abc12345 -w

# Auto-recover from an issue short ID
sentry trace view PROJ-123
```

### View trace logs

```bash
# View logs for a trace
sentry trace logs abc123def456abc123def456abc12345

# Search with a longer time window
sentry trace logs --period 30d abc123def456abc123def456abc12345

# Filter logs within a trace
sentry trace logs -q 'level:error' abc123def456abc123def456abc12345
```
