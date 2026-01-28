---
title: event
description: Event commands for the Sentry CLI
---

Inspect Sentry events.

## Commands

### `sentry event view`

View details of a specific event.

```bash
sentry event view <event-id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<event-id>` | The event ID |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `--json` | Output as JSON |

**Example:**

```bash
sentry event view abc123def456
```

```
Event: abc123def456
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

**Open in browser:**

```bash
sentry event view abc123def456 -w
```

## Finding Event IDs

Event IDs can be found:

1. In the Sentry UI when viewing an issue's events
2. In the output of `sentry issue view` commands
3. In error reports sent to Sentry (as `event_id`)
