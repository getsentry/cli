# Event Commands

View Sentry events

## `sentry event view <args...>`

View details of a specific event

**Flags:**
- `--json - Output as JSON`
- `-w, --web - Open in browser`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`

**Examples:**

```bash
sentry event view <event-id>

sentry event view abc123def456

sentry event view abc123def456 -w
```

**Expected output:**

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

## Finding Event IDs

Event IDs can be found:

1. In the Sentry UI when viewing an issue's events
2. In the output of `sentry issue view` commands
3. In error reports sent to Sentry (as `event_id`)

## Workflows

### Investigate an error event
1. Find the event ID from `sentry issue view <issue-id>` output
2. View event details: `sentry event view <event-id>`
3. Open in browser for full stack trace: `sentry event view <event-id> -w`
