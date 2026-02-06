---
title: log
description: Log commands for the Sentry CLI
---

View and stream logs from Sentry projects.

## Commands

### `sentry log list`

List and stream logs from a project.

```bash
# Auto-detect from DSN or config
sentry log list

# Explicit org and project
sentry log list <org>/<project>

# Search for project across all accessible orgs
sentry log list <project>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>/<project>` | Explicit organization and project (e.g., `my-org/backend`) |
| `<project>` | Search for project by name across all accessible organizations |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <n>` | Number of log entries to show (1-1000, default: 100) |
| `-q, --query <query>` | Filter query (Sentry search syntax) |
| `-f, --follow [interval]` | Stream logs in real-time (optional: poll interval in seconds, default: 2) |
| `--json` | Output as JSON |

**Examples:**

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

**Stream logs in real-time:**

```bash
# Stream with default 2-second poll interval
sentry log list -f

# Stream with custom 5-second poll interval
sentry log list -f 5
```

**Filter logs:**

```bash
# Show only error logs
sentry log list -q 'level:error'

# Filter by message content
sentry log list -q 'database'
```

**Limit results:**

```bash
# Show last 50 logs
sentry log list --limit 50

# Show last 500 logs
sentry log list -n 500
```

**Combine options:**

```bash
# Stream error logs from a specific project
sentry log list my-org/backend -f -q 'level:error'
```

## JSON Output

Use `--json` for machine-readable output:

```bash
sentry log list --json | jq '.[] | select(.level == "error")'
```

In streaming mode with `--json`, each log entry is output as a separate JSON object (newline-delimited JSON), making it suitable for piping to other tools.
