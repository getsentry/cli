---
name: sentry-cli-status
version: 0.45.0-dev.0
description: Check Sentry service status
requires:
  bins: ["sentry"]
  auth: true
---

# Status Commands

Check Sentry service status

### `sentry status show`

Show Sentry service status

**Flags:**
- `--url <value> - Status page base URL to query - (default: "https://status.sentry.io")`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
