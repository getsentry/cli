---
name: sentry-cli-traces
version: 0.22.0
description: List and inspect traces and spans for performance analysis
requires:
  bins: ["sentry"]
  auth: true
---

# Trace & Span Commands

List and view spans in projects or traces

View distributed traces

### `sentry span list <org/project/trace-id...>`

List spans in a project or trace

**Flags:**
- `-n, --limit <value> - Number of spans (<=1000) - (default: "25")`
- `-q, --query <value> - Filter spans (e.g., "op:db", "duration:>100ms", "project:backend")`
- `-s, --sort <value> - Sort order: date, duration - (default: "date")`
- `-t, --period <value> - Time period (e.g., "1h", "24h", "7d", "30d") - (default: "7d")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Span ID |
| `parent_span` | string \| null | Parent span ID |
| `span.op` | string \| null | Span operation (e.g. http.client, db) |
| `description` | string \| null | Span description |
| `span.duration` | number \| null | Duration (ms) |
| `timestamp` | string | Timestamp (ISO 8601) |
| `project` | string | Project slug |
| `transaction` | string \| null | Transaction name |
| `trace` | string | Trace ID |

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

### `sentry span view <trace-id/span-id...>`

View details of specific spans

**Flags:**
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# View a single span
sentry span view abc123def456abc123def456abc12345 a1b2c3d4e5f67890

# View multiple spans at once
sentry span view abc123def456abc123def456abc12345 a1b2c3d4e5f67890 b2c3d4e5f6789012

# With explicit org/project
sentry span view my-org/backend/abc123def456abc123def456abc12345 a1b2c3d4e5f67890
```

### `sentry trace list <org/project>`

List recent traces in a project

**Flags:**
- `-n, --limit <value> - Number of traces (1-1000) - (default: "20")`
- `-q, --query <value> - Search query (Sentry search syntax)`
- `-s, --sort <value> - Sort by: date, duration - (default: "date")`
- `-t, --period <value> - Time period (e.g., "1h", "24h", "7d", "30d") - (default: "7d")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `trace` | string | Trace ID |
| `id` | string | Event ID |
| `transaction` | string | Transaction name |
| `timestamp` | string | Timestamp (ISO 8601) |
| `transaction.duration` | number | Duration (ms) |
| `project` | string | Project slug |

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

### `sentry trace view <org/project/trace-id...>`

View details of a specific trace

**Flags:**
- `-w, --web - Open in browser`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# View trace details with span tree
sentry trace view abc123def456abc123def456abc12345

# Open trace in browser
sentry trace view abc123def456abc123def456abc12345 -w

# Auto-recover from an issue short ID
sentry trace view PROJ-123
```

### `sentry trace logs <org/trace-id...>`

View logs associated with a trace

**Flags:**
- `-w, --web - Open trace in browser`
- `-t, --period <value> - Time period to search (e.g., "14d", "7d", "24h"). Default: 14d - (default: "14d")`
- `-n, --limit <value> - Number of log entries (<=1000) - (default: "100")`
- `-q, --query <value> - Additional filter query (Sentry search syntax)`
- `-s, --sort <value> - Sort order: "newest" (default) or "oldest" - (default: "newest")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# View logs for a trace
sentry trace logs abc123def456abc123def456abc12345

# Search with a longer time window
sentry trace logs --period 30d abc123def456abc123def456abc12345

# Filter logs within a trace
sentry trace logs -q 'level:error' abc123def456abc123def456abc12345
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
