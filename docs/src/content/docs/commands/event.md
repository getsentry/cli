---
title: event
description: Event commands for the Sentry CLI
---

View and list Sentry events

## Commands

### `sentry event view <org/project/event-id...>`

View details of a specific event

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project/event-id...>` | [&lt;org&gt;/&lt;project&gt;] &lt;event-id&gt; - Target (optional) and event ID (required) |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `--spans <spans>` | Span tree depth limit (number, "all" for unlimited, "no" to disable) (default: "3") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry event list <issue>`

List events for an issue

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<issue>` | Issue: @latest, @most_frequent, &lt;org&gt;/ID, &lt;project&gt;-suffix, ID, or suffix |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <limit>` | Number of events (1-1000) (default: "25") |
| `-q, --query <query>` | Search query (Sentry search syntax) |
| `--full` | Include full event body (stacktraces) |
| `-t, --period <period>` | Time range: "7d", "2024-01-01..2024-02-01", ">=2024-01-01" (default: "7d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
sentry event view abc123def456abc123def456abc12345
```

```
Event: abc123def456abc123def456abc12345
Issue: FRONT-ABC
Timestamp: 2024-01-20 14:22:00

Exception:
  TypeError: Cannot read property 'foo' of undefined
    at processData (app.js:123:45)
    at handleClick (app.js:89:12)
    at HTMLButtonElement.onclick (app.js:45:8)

Tags:
  browser: Chrome 120
  os: Windows 10
  environment: production
  release: 1.2.3

Context:
  url: https://example.com/app
  user_id: 12345
```

```bash
# Open in browser
sentry event view abc123def456abc123def456abc12345 -w
```

## Finding Event IDs

Event IDs can be found:

1. In the Sentry UI when viewing an issue's events
2. In the output of `sentry issue view` commands
3. In error reports sent to Sentry (as `event_id`)
