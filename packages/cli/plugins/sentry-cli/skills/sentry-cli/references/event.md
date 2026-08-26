---
name: sentry-cli-event
version: 0.44.0-dev.0
description: View, list, and send Sentry events
requires:
  bins: ["sentry"]
  auth: true
---

# Event Commands

View, list, and send Sentry events

### `sentry event view <org/project/event-id...>`

View details of one or more events

**Flags:**
- `-w, --web - Open in browser`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry event list <issue>`

List events for an issue

**Flags:**
- `-n, --limit <value> - Number of events (1-1000) - (default: "25")`
- `-q, --query <value> - Search query (Sentry search syntax)`
- `--full - Include full event body (stacktraces)`
- `-t, --period <value> - Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01" - (default: "7d")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Internal event ID |
| `event.type` | string | Event type (error, default, transaction) |
| `groupID` | string \| null | Group (issue) ID |
| `eventID` | string | UUID-format event ID |
| `projectID` | string | Project ID |
| `message` | string | Event message |
| `title` | string | Event title |
| `location` | string \| null | Source location (file:line) |
| `culprit` | string \| null | Culprit function/module |
| `user` | object \| null | User context |
| `tags` | array | Event tags |
| `platform` | string \| null | Platform (python, javascript, etc.) |
| `dateCreated` | string | ISO 8601 creation timestamp |
| `crashFile` | string \| null | Crash file URL |
| `metadata` | object | Event metadata |

### `sentry event send <args...>`

Send a Sentry event

**Flags:**
- `--dsn <value> - DSN to send events to (overrides SENTRY_DSN env var)`
- `-m, --message <value>... - Event message (repeat for multi-line)`
- `-a, --message-arg <value>... - Arguments for message template (repeat for multiple)`
- `-l, --level <value> - Event severity level - (default: "error")`
- `-r, --release <value> - Release version`
- `-d, --dist <value> - Distribution identifier`
- `-E, --env <value> - Environment name (e.g. production, staging)`
- `-p, --platform <value> - Platform identifier (default: other)`
- `-t, --tag <value>... - Tag as KEY:VALUE (repeat for multiple)`
- `-e, --extra <value>... - Extra data as KEY:VALUE (repeat for multiple)`
- `-u, --user <value>... - User info as KEY:VALUE — id, email, username, ip_address, or custom`
- `-f, --fingerprint <value>... - Custom fingerprint part (repeat for multiple)`
- `--timestamp <value> - Event timestamp (Unix epoch, ISO 8601, or RFC 2822)`
- `--no-environ - Do not include environment variables in the event`
- `--logfile <value> - Path to a log file — last 100 lines are attached as breadcrumbs`
- `--with-categories - Parse 'CATEGORY: message' prefixes from logfile breadcrumbs`
- `--raw - Send file contents as-is without parsing`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
