---
title: log
description: Log commands for the Sentry CLI
---

View Sentry logs

## Commands

### `sentry log list <org/project-or-trace-id...>`

List logs from a project

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project-or-trace-id...>` | [&lt;org&gt;/[&lt;project&gt;/]]&lt;trace-id&gt;, &lt;org&gt;/&lt;project&gt;, or &lt;project&gt; |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <limit>` | Number of log entries (1-1000) (default: "100") |
| `-q, --query <query>` | Filter query (Sentry search syntax) |
| `-f, --follow <follow>` | Stream logs (optionally specify poll interval in seconds) |
| `-t, --period <period>` | Time range: "7d", "2026-03-09..2026-04-09", ">=2026-03-09" |
| `-s, --sort <sort>` | Sort order: "newest" (default) or "oldest" (default: "newest") |
| `--fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry log view <org/project/log-id...>`

View details of one or more log entries

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project/log-id...>` | [&lt;org&gt;/&lt;project&gt;] &lt;log-id&gt; [&lt;log-id&gt;...] - Target (optional) and one or more log IDs |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

### List logs

```bash
# List last 100 logs (default)
sentry log list
```

```
TIMESTAMP            LEVEL   MESSAGE
2024-01-20 14:22:01  info    User login successful
2024-01-20 14:22:03  debug   Processing request for /api/users
2024-01-20 14:22:05  error   Database connection timeout
2024-01-20 14:22:06  warn    Retry attempt 1 of 3

Showing 4 logs.
```

**Filter logs:**

```bash
# Show only error logs
sentry log list -q 'level:error'

# Filter by message content
sentry log list -q 'database'

# Limit results
sentry log list --limit 50
```

### Stream logs in real-time

```bash
# Stream with default 2-second poll interval
sentry log list -f

# Stream with custom 5-second poll interval
sentry log list -f 5

# Stream error logs from a specific project
sentry log list my-org/backend -f -q 'level:error'
```

### View a log entry

```bash
sentry log view 968c763c740cfda8b6728f27fb9e9b01
```

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

─── Trace ───

Trace ID:     abc123def456abc123def456abc12345
Span ID:      1234567890abcdef

─── Source Location ───

Function:     connect_to_database
File:         src/db/connection.py:142
```

```bash
# With explicit project
sentry log view my-org/backend 968c763c740cfda8b6728f27fb9e9b01

# Open in browser
sentry log view 968c763c740cfda8b6728f27fb9e9b01 -w
```

## Finding Log IDs

Log IDs can be found:

1. In the output of `sentry log list` (the ID column)
2. In the Sentry UI when viewing log entries
3. In the `sentry.item_id` field of JSON output

## JSON Output

Use `--json` for machine-readable output:

```bash
sentry log list --json | jq '.data[] | select(.severity == "error")'
```

In streaming mode with `--json`, each log entry is output as a separate JSON object (newline-delimited JSON), making it suitable for piping to other tools.
