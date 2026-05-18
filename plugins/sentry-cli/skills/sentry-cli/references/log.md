---
name: sentry-cli-log
version: 0.35.0-dev.0
description: View Sentry logs
requires:
  bins: ["sentry"]
  auth: true
---

# Log Commands

View Sentry logs

### `sentry log list <org/project-or-trace-id...>`

List logs from a project

**Flags:**
- `-n, --limit <value> - Number of log entries (1-1000) - (default: "100")`
- `-q, --query <value> - Filter query (e.g., "level:error", "project:backend", "project:[a,b]")`
- `-f, --follow <value> - Stream logs (optionally specify poll interval in seconds)`
- `-t, --period <value> - Time range: "7d", "2026-04-01..2026-05-01", ">=2026-04-01"`
- `-s, --sort <value> - Sort order: "newest" (default) or "oldest" - (default: "newest")`
- `--fresh - Bypass cache, re-detect projects, and fetch fresh data`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `sentry.item_id` | string | Unique log entry ID |
| `timestamp` | string | Log timestamp (ISO 8601) |
| `timestamp_precise` | number | Nanosecond-precision timestamp |
| `message` | string \| null | Log message |
| `severity` | string \| null | Severity level (error, warning, info, debug) |
| `trace` | string \| null | Trace ID for correlation |

### `sentry log view <org/project/log-id...>`

View details of one or more log entries

**Flags:**
- `-w, --web - Open in browser`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
