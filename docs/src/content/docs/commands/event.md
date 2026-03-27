---
title: event
description: Event commands for the Sentry CLI
---

View Sentry events

## Commands

### `sentry event view <org/project/event-id...>`

View details of a specific event

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project/event-id...>` | [&lt;org&gt;/&lt;project&gt;] &lt;event-id&gt; - Target (optional) and event ID (required) (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `--spans <spans>` | Span tree depth limit (number, "all" for unlimited, "no" to disable) (default: "3") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

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

```bash
# Open in browser
sentry event view abc123def456 -w
```

## Finding Event IDs

Event IDs can be found:

1. In the Sentry UI when viewing an issue's events
2. In the output of `sentry issue view` commands
3. In error reports sent to Sentry (as `event_id`)
