---
name: sentry-cli-traces
version: 0.18.1
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
- `-c, --cursor <value> - Pagination cursor (use "last" to continue from previous page)`

### `sentry span view <trace-id/span-id...>`

View details of specific spans

**Flags:**
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry trace list <org/project>`

List recent traces in a project

**Flags:**
- `-n, --limit <value> - Number of traces (1-1000) - (default: "20")`
- `-q, --query <value> - Search query (Sentry search syntax)`
- `-s, --sort <value> - Sort by: date, duration - (default: "date")`
- `-t, --period <value> - Time period (e.g., "1h", "24h", "7d", "30d") - (default: "7d")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Pagination cursor (use "last" to continue from previous page)`

### `sentry trace view <org/project/trace-id...>`

View details of a specific trace

**Flags:**
- `-w, --web - Open in browser`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry trace logs <org/trace-id...>`

View logs associated with a trace

**Flags:**
- `-w, --web - Open trace in browser`
- `-t, --period <value> - Time period to search (e.g., "14d", "7d", "24h"). Default: 14d - (default: "14d")`
- `-n, --limit <value> - Number of log entries (<=1000) - (default: "100")`
- `-q, --query <value> - Additional filter query (Sentry search syntax)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
