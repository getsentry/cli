---
name: sentry-cli-trace
version: 0.35.0-dev.0
description: View distributed traces
requires:
  bins: ["sentry"]
  auth: true
---

# Trace Commands

View distributed traces

### `sentry trace list <org/project>`

List recent traces in a project

**Flags:**
- `-n, --limit <value> - Number of traces (1-1000) - (default: "25")`
- `-q, --query <value> - Search query (Sentry search syntax)`
- `-s, --sort <value> - Sort by: date, duration - (default: "date")`
- `-t, --period <value> - Time range: "7d", "2026-04-01..2026-05-01", ">=2026-04-01" - (default: "7d")`
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

### `sentry trace view <org/project/trace-id...>`

View details of a specific trace

**Flags:**
- `-w, --web - Open in browser`
- `--full - Fetch full span attributes (auto-enabled with --json)`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry trace logs <org/project/trace-id...>`

View logs associated with a trace

**Flags:**
- `-w, --web - Open trace in browser`
- `-t, --period <value> - Time range: "7d", "2026-04-01..2026-05-01", ">=2026-04-01" - (default: "14d")`
- `-n, --limit <value> - Number of log entries (<=1000) - (default: "100")`
- `-q, --query <value> - Filter query (e.g., "level:error", "project:backend", "project:[a,b]")`
- `-s, --sort <value> - Sort order: "newest" (default) or "oldest" - (default: "newest")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
