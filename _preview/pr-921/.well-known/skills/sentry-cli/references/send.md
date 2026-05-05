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

### `sentry send envelope <path...>`

Send a Sentry envelope file

**Flags:**
- `--dsn <value> - DSN to send envelopes to (overrides SENTRY_DSN env var)`
- `--raw - Send file bytes without parsing or validating the envelope`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
