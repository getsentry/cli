# Log Commands

View Sentry logs

## `sentry log list <org/project>`

List logs from a project

**Flags:**
- `-n, --limit <value> - Number of log entries (1-1000) - (default: "100")`
- `-q, --query <value> - Filter query (Sentry search syntax)`
- `-f, --follow <value> - Stream logs (optionally specify poll interval in seconds)`
- `--json - Output as JSON`

**Examples:**

```bash
# Auto-detect from DSN or config
sentry log list

# Explicit org and project
sentry log list <org>/<project>

# Search for project across all accessible orgs
sentry log list <project>

# List last 100 logs (default)
sentry log list

# Stream with default 2-second poll interval
sentry log list -f

# Stream with custom 5-second poll interval
sentry log list -f 5

# Show only error logs
sentry log list -q 'level:error'

# Filter by message content
sentry log list -q 'database'

# Show last 50 logs
sentry log list --limit 50

# Show last 500 logs
sentry log list -n 500

# Stream error logs from a specific project
sentry log list my-org/backend -f -q 'level:error'
```

**Expected output:**

```
TIMESTAMP            LEVEL   MESSAGE
2024-01-20 14:22:01  info    User login successful
2024-01-20 14:22:03  debug   Processing request for /api/users
2024-01-20 14:22:05  error   Database connection timeout
2024-01-20 14:22:06  warn    Retry attempt 1 of 3

Showing 4 logs.
```

## `sentry log view <args...>`

View details of a specific log entry

In streaming mode with `--json`, each log entry is output as a separate JSON object (newline-delimited JSON), making it suitable for piping to other tools.

**Flags:**
- `--json - Output as JSON`
- `-w, --web - Open in browser`

**Examples:**

```bash
# Auto-detect from DSN or config
sentry log view <log-id>

# Explicit org and project
sentry log view <org>/<project> <log-id>

# Search for project across all accessible orgs
sentry log view <project> <log-id>

sentry log view 968c763c740cfda8b6728f27fb9e9b01

sentry log view 968c763c740cfda8b6728f27fb9e9b01 -w

sentry log view my-org/backend 968c763c740cfda8b6728f27fb9e9b01

sentry log list --json | jq '.[] | select(.level == "error")'
```

**Expected output:**

```
Log 968c763c740c...
════════════════════

ID:         968c763c740cfda8b6728f27fb9e9b01
Timestamp:  2024-01-20 14:22:05
Severity:   ERROR

Message:
  Database connection timeout after 30s

─── Context ───

Project:      backend
Environment:  production
Release:      1.2.3

─── SDK ───

SDK:          sentry.python 1.40.0

─── Trace ───

Trace ID:     abc123def456abc123def456abc12345
Span ID:      1234567890abcdef
Link:         https://sentry.io/organizations/my-org/explore/traces/abc123...

─── Source Location ───

Function:     connect_to_database
File:         src/db/connection.py:142
```

## Shortcuts

- `sentry logs` → shortcut for `sentry log list` (accepts the same flags)

## Finding Log IDs

Log IDs can be found:

1. In the output of `sentry log list` (shown as trace IDs in brackets)
2. In the Sentry UI when viewing log entries
3. In the `sentry.item_id` field of JSON output

## JSON Output

Use `--json` for machine-readable output:

```bash
sentry log list --json | jq '.[] | select(.level == "error")'
```

In streaming mode with `--json`, each log entry is output as a separate JSON object (newline-delimited JSON), making it suitable for piping to other tools.

## Workflows

### Monitor production logs
1. Stream all logs: `sentry log list -f`
2. Filter to errors only: `sentry log list -f -q 'level:error'`
3. Investigate a specific log: `sentry log view <log-id>`

### Debug a specific issue
1. Filter by message content: `sentry log list -q 'database timeout'`
2. View error details: `sentry log view <log-id>`
3. Check related trace: follow the Trace ID from the log view output

## Common Queries

- Error logs only: `-q 'level:error'`
- Warning and above: `-q 'level:warning'`
- By message content: `-q 'database'`
- Limit results: `--limit 50`
- Stream with interval: `-f 5` (poll every 5 seconds)

## JSON Recipes

- Extract error messages: `sentry log list --json -q 'level:error' | jq '.[].message'`
- Filter by level in JSON: `sentry log list --json | jq '.[] | select(.level == "error")'`
