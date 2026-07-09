---
title: "log"
description: "Log commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1212/commands/log/"
---

# log

View Sentry logs

## Commands

[Section titled “Commands”](#commands)

### `sentry log list <org/project-or-trace-id...>`

[Section titled “sentry log list <org/project-or-trace-id...>”](#sentry-log-list-orgproject-or-trace-id)

List logs from a project

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project-or-trace-id...>` | [<org>/[<project>/]]<trace-id>, <org>/<project>, or <project> |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Number of log entries (1-1000) (default: "100") |
| `-q, --query <query>` | Filter query (e.g., "level:error", "project:backend", "project:[a,b]") |
| `-f, --follow <follow>` | Stream logs (optionally specify poll interval in seconds) |
| `-t, --period <period>` | Time range: "7d", "2026-06-01..2026-07-01", ">=2026-06-01" |
| `-s, --sort <sort>` | Sort order: "newest" (default) or "oldest" (default: "newest") |
| `--fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry log view <org/project/log-id...>`

[Section titled “sentry log view <org/project/log-id...>”](#sentry-log-view-orgprojectlog-id)

View details of one or more log entries

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/log-id...>` | [<org>/<project>] <log-id> [<log-id>...] - Target (optional) and one or more log IDs |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### List logs

[Section titled “List logs”](#list-logs)
Terminal window

```
# List last 100 logs (default)sentry log list
```


```
TIMESTAMP            LEVEL   MESSAGE2024-01-20 14:22:01  info    User login successful2024-01-20 14:22:03  debug   Processing request for /api/users2024-01-20 14:22:05  error   Database connection timeout2024-01-20 14:22:06  warn    Retry attempt 1 of 3
Showing 4 logs.
```


**Filter logs:**

Terminal window

```
# Show only error logssentry log list -q 'level:error'
# Filter by message contentsentry log list -q 'database'
# Limit resultssentry log list --limit 50
```


### Stream logs in real-time

[Section titled “Stream logs in real-time”](#stream-logs-in-real-time)
Terminal window

```
# Stream with default 2-second poll intervalsentry log list -f
# Stream with custom 5-second poll intervalsentry log list -f 5
# Stream error logs from a specific projectsentry log list my-org/backend -f -q 'level:error'
```


### View a log entry

[Section titled “View a log entry”](#view-a-log-entry)
Terminal window

```
sentry log view 968c763c740cfda8b6728f27fb9e9b01
```


```
Log 968c763c740c...════════════════════
ID:         968c763c740cfda8b6728f27fb9e9b01Timestamp:  2024-01-20 14:22:05Severity:   ERROR
Message:  Database connection timeout after 30s
─── Context ───
Project:      backendEnvironment:  productionRelease:      1.2.3
─── Trace ───
Trace ID:     abc123def456abc123def456abc12345Span ID:      1234567890abcdef
─── Source Location ───
Function:     connect_to_databaseFile:         src/db/connection.py:142
```


Terminal window

```
# With explicit projectsentry log view my-org/backend 968c763c740cfda8b6728f27fb9e9b01
# Open in browsersentry log view 968c763c740cfda8b6728f27fb9e9b01 -w
```


## Finding Log IDs

[Section titled “Finding Log IDs”](#finding-log-ids)

Log IDs can be found:

1. In the output of `sentry log list` (the ID column)
2. In the Sentry UI when viewing log entries
3. In the `sentry.item_id` field of JSON output

## JSON Output

[Section titled “JSON Output”](#json-output)

Use `--json` for machine-readable output:

Terminal window

```
sentry log list --json | jq '.data[] | select(.severity == "error")'
```


In streaming mode with `--json`, each log entry is output as a separate JSON object (newline-delimited JSON), making it suitable for piping to other tools.
