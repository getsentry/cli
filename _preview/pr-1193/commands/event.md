---
title: "event"
description: "Event commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1193/commands/event/"
---

# event

View, list, and send Sentry events

## Commands

[Section titled “Commands”](#commands)

### `sentry event view <org/project/event-id...>`

[Section titled “sentry event view <org/project/event-id...>”](#sentry-event-view-orgprojectevent-id)

View details of one or more events

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/event-id...>` | [<org>/<project>] <event-id> [<event-id>...] - Target (optional) and one or more event IDs |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `--spans <spans>` | Span tree depth limit (number, "all" for unlimited, "no" to disable) (default: "3") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry event list <issue>`

[Section titled “sentry event list <issue>”](#sentry-event-list-issue)

List events for an issue

**Arguments:**

| Argument | Description |
| --- | --- |
| `<issue>` | Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Number of events (1-1000) (default: "25") |
| `-q, --query <query>` | Search query (Sentry search syntax) |
| `--full` | Include full event body (stacktraces) |
| `-t, --period <period>` | Time range: "7d", "2026-06-01..2026-07-01", ">=2026-06-01" (default: "7d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry event send <args...>`

[Section titled “sentry event send <args...>”](#sentry-event-send-args)

Send a Sentry event

**Arguments:**

| Argument | Description |
| --- | --- |
| `<args...>` | Path(s) to JSON event file(s) to send |

**Options:**

| Option | Description |
| --- | --- |
| `--dsn <dsn>` | DSN to send events to (overrides SENTRY_DSN env var) |
| `-m, --message <message>...` | Event message (repeat for multi-line) |
| `-a, --message-arg <message-arg>...` | Arguments for message template (repeat for multiple) |
| `-l, --level <level>` | Event severity level (default: "error") |
| `-r, --release <release>` | Release version |
| `-d, --dist <dist>` | Distribution identifier |
| `-E, --env <env>` | Environment name (e.g. production, staging) |
| `-p, --platform <platform>` | Platform identifier (default: other) |
| `-t, --tag <tag>...` | Tag as KEY:VALUE (repeat for multiple) |
| `-e, --extra <extra>...` | Extra data as KEY:VALUE (repeat for multiple) |
| `-u, --user <user>...` | User info as KEY:VALUE — id, email, username, ip_address, or custom |
| `-f, --fingerprint <fingerprint>...` | Custom fingerprint part (repeat for multiple) |
| `--timestamp <timestamp>` | Event timestamp (Unix epoch, ISO 8601, or RFC 2822) |
| `--no-environ` | Do not include environment variables in the event |
| `--logfile <logfile>` | Path to a log file — last 100 lines are attached as breadcrumbs |
| `--with-categories` | Parse 'CATEGORY: message' prefixes from logfile breadcrumbs |
| `--raw` | Send file contents as-is without parsing |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### Sending Events

[Section titled “Sending Events”](#sending-events)
Terminal window

```
# Send an error event (default level)sentry event send -m "Something went wrong"
# Specify level, release, and environmentsentry event send -m "Deploy check" -l info -r 1.0.0 -E production
# Add tags and extra datasentry event send -m "Payment failed" --tag env:prod --tag region:us-east --extra amount:99.99
# Set user contextsentry event send -m "Login error" --user id:42 --user email:alice@example.com
# Custom fingerprint to group related events togethersentry event send -m "DB timeout" --fingerprint db-timeout --fingerprint {{ default }}
```


### Send from a JSON file

[Section titled “Send from a JSON file”](#send-from-a-json-file)
Terminal window

```
# Send a serialized Sentry Event objectsentry event send ./crash.json
# Send without re-parsing (raw mode — also supports pre-built envelopes)sentry event send --raw ./crash.jsonsentry event send --raw ./captured.envelope
```


### DSN authentication

[Section titled “DSN authentication”](#dsn-authentication)

`sentry event send` authenticates via a **DSN** rather than a user token. No `sentry auth login` is required.

The DSN is resolved in priority order:

1. `--dsn <value>` flag (explicit)
2. `SENTRY_DSN` environment variable

Terminal window

```
# Explicit DSNsentry event send -m "Test" --dsn "https://key@o123.ingest.us.sentry.io/456"
# Via environment variableexport SENTRY_DSN="https://key@o123.ingest.us.sentry.io/456"sentry event send -m "Test"
```


### Listing Events

[Section titled “Listing Events”](#listing-events)
Terminal window

```
# List events for an issue (using short ID)sentry event list PROJ-ABC
# List events for an issue (using numeric ID)sentry event list 123456789
# Filter by search querysentry event list PROJ-ABC --query "browser:Chrome"
# Include full event bodies (stacktraces)sentry event list PROJ-ABC --full
# Limit results and time rangesentry event list PROJ-ABC --limit 50 --period 24h
# Paginate through resultssentry event list PROJ-ABC -c nextsentry event list PROJ-ABC -c prev
# Output as JSONsentry event list PROJ-ABC --json
```


### Viewing Events

[Section titled “Viewing Events”](#viewing-events)
Terminal window

```
sentry event view abc123def456abc123def456abc12345
```


```
Event: abc123def456abc123def456abc12345Issue: FRONT-ABCTimestamp: 2024-01-20 14:22:00
Exception:  TypeError: Cannot read property 'foo' of undefined    at processData (app.js:123:45)    at handleClick (app.js:89:12)    at HTMLButtonElement.onclick (app.js:45:8)
Tags:  browser: Chrome 120  os: Windows 10  environment: production  release: 1.2.3
Context:  url: https://example.com/app  user_id: 12345
```


Terminal window

```
# Open in browsersentry event view abc123def456abc123def456abc12345 -w
```


## Finding Event IDs

[Section titled “Finding Event IDs”](#finding-event-ids)

Event IDs can be found:

1. In the Sentry UI when viewing an issue's events
2. In the output of `sentry issue view` commands
3. In error reports sent to Sentry (as `event_id`)

## Backward compatibility

[Section titled “Backward compatibility”](#backward-compatibility)

The old sentry-cli top-level command is available as a hidden alias:

Terminal window

```
sentry send-event    # same as: sentry event send
```
