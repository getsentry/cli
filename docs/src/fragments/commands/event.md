

## Examples

### Listing Events

```bash
# List events for an issue (using short ID)
sentry event list PROJ-ABC

# List events for an issue (using numeric ID)
sentry event list 123456789

# Filter by search query
sentry event list PROJ-ABC --query "browser:Chrome"

# Include full event bodies (stacktraces)
sentry event list PROJ-ABC --full

# Limit results and time range
sentry event list PROJ-ABC --limit 50 --period 24h

# Paginate through results
sentry event list PROJ-ABC -c next
sentry event list PROJ-ABC -c prev

# Output as JSON
sentry event list PROJ-ABC --json
```

### Viewing Events

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
