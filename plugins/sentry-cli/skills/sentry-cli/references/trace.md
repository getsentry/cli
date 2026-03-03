# Trace Commands

View distributed traces

## `sentry trace list <org/project>`

List recent traces in a project

**Flags:**
- `-n, --limit <value> - Number of traces (1-1000) - (default: "20")`
- `-q, --query <value> - Search query (Sentry search syntax)`
- `-s, --sort <value> - Sort by: date, duration - (default: "date")`
- `--json - Output as JSON`

## `sentry trace view <args...>`

View details of a specific trace

**Flags:**
- `--json - Output as JSON`
- `-w, --web - Open in browser`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`

## `sentry trace logs <args...>`

View logs associated with a trace

**Flags:**
- `--json - Output as JSON`
- `-w, --web - Open trace in browser`
- `-t, --period <value> - Time period to search (e.g., "14d", "7d", "24h"). Default: 14d - (default: "14d")`
- `-n, --limit <value> - Number of log entries (1-1000) - (default: "100")`
- `-q, --query <value> - Additional filter query (Sentry search syntax)`

## Shortcuts

- `sentry traces` → shortcut for `sentry trace list` (accepts the same flags)

## Workflows

### Investigate slow requests
1. List recent traces: `sentry trace list --sort duration`
2. View slowest trace: `sentry trace view <trace-id>`
3. Open in browser for waterfall view: `sentry trace view <trace-id> -w`

## Common Queries

- Sort by duration: `--sort duration`
- Search traces: `--query "http.method:GET"`
- Limit results: `--limit 50`
