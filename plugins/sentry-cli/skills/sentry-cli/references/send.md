---
name: sentry-cli-send
version: 0.32.0-dev.0
description: Send events and envelopes to Sentry via DSN
requires:
  bins: ["sentry"]
  auth: true
---

# Send Commands

Send events and envelopes to Sentry via DSN

### `sentry send event <args...>`

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
- `--raw - Send file contents as-is without parsing`

**Examples:**

```bash
# Send an error event (default level)
sentry send event -m "Something went wrong"

# Specify level, release, and environment
sentry send event -m "Deploy check" -l info -r 1.0.0 -E production

# Add tags and extra data
sentry send event -m "Payment failed" --tag env:prod --tag region:us-east --extra amount:99.99

# Set user context
sentry send event -m "Login error" --user id:42 --user email:alice@example.com

# Custom fingerprint to group related events together
sentry send event -m "DB timeout" --fingerprint db-timeout --fingerprint {{ default }}

# Send a serialized Sentry Event object
sentry send event ./crash.json

# Send without re-parsing (raw mode)
sentry send event --raw ./crash.json

# Explicit DSN
sentry send event -m "Test" --dsn "https://key@o123.ingest.us.sentry.io/456"

# Via environment variable
export SENTRY_DSN="https://key@o123.ingest.us.sentry.io/456"
sentry send event -m "Test"

sentry send-event    # same as: sentry send event
sentry send-envelope # same as: sentry send envelope
```

### `sentry send envelope <path...>`

Send a Sentry envelope file

**Flags:**
- `--dsn <value> - DSN to send envelopes to (overrides SENTRY_DSN env var)`
- `--raw - Send file bytes without parsing or validating the envelope`

**Examples:**

```bash
# Send a captured Sentry envelope file
sentry send envelope ./captured.envelope

# Send without validation (raw mode)
sentry send envelope --raw ./binary.envelope

# Send multiple envelope files
sentry send envelope ./a.envelope ./b.envelope
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
