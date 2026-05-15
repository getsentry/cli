---
name: sentry-cli-local
version: 0.35.0-dev.0
description: Run a local Spotlight server to capture dev SDK events
requires:
  bins: ["sentry"]
  auth: true
---

# Local Commands

Run a local Spotlight server to capture dev SDK events

### `sentry local`

Run a local Spotlight server to capture dev SDK events

**Flags:**
- `-p, --port <value> - Port to listen on (default 8969) - (default: "8969")`
- `-H, --host <value> - Hostname to bind to (default localhost) - (default: "localhost")`
- `-q, --quiet - Suppress per-envelope tail output`
- `-f, --filter <value>... - Only show items of this type (repeatable: error, transaction, log)`

**Examples:**

```bash
# Start the server on the default port (8969)
sentry local

# Use a custom port and bind to all interfaces
sentry local --port 9000 --host 0.0.0.0

# Run quietly (suppress per-envelope tail output)
sentry local --quiet

# Only show errors and logs (filter out transactions)
sentry local -f error -f log

sentry local -f error -f log    # only errors and logs
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
