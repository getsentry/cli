---
name: sentry-cli-send-envelope
version: 0.32.0-dev.0
description: Send a Sentry envelope file
requires:
  bins: ["sentry"]
  auth: true
---

# Send-envelope Commands

Send a Sentry envelope file

### `sentry send-envelope <path...>`

Send a Sentry envelope file

**Flags:**
- `--dsn <value> - DSN to send envelopes to (overrides SENTRY_DSN env var)`
- `--raw - Send file bytes without parsing or validating the envelope`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
