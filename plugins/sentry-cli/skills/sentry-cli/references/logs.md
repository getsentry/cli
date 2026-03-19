---
name: sentry-cli-logs
version: 0.18.1
description: List and stream logs from Sentry projects
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
- `-q, --query <value> - Filter query (Sentry search syntax)`
- `-f, --follow <value> - Stream logs (optionally specify poll interval in seconds)`
- `-t, --period <value> - Time period (e.g., "90d", "14d", "24h"). Default: 90d (project mode), 14d (trace mode)`
- `--fresh - Bypass cache, re-detect projects, and fetch fresh data`

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

### `sentry log view <args...>`

View details of one or more log entries

**Flags:**
- `-w, --web - Open in browser`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

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

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
