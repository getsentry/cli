---
name: sentry-cli-local
version: 0.31.0-dev.0
description: Run a local Spotlight sidecar to capture dev SDK events
requires:
  bins: ["sentry"]
  auth: true
---

# Local Commands

Run a local Spotlight sidecar to capture dev SDK events

### `sentry local`

Run a local Spotlight sidecar to capture dev SDK events

**Flags:**
- `-p, --port <value> - Port to listen on (default 8969) - (default: "8969")`
- `-H, --host <value> - Hostname to bind to (default localhost) - (default: "localhost")`
- `-o, --open - Open the sidecar SSE URL in a browser`
- `-q, --quiet - Suppress per-envelope tail output`
- `-f, --filter <value>... - Only show items of this type (repeatable: error, transaction, log)`

**Examples:**

```bash
# Start the sidecar on the default port (8969)
sentry local

# Use a custom port and bind to all interfaces
sentry local --port 9000 --host 0.0.0.0

# Run quietly (suppress per-envelope tail output)
sentry local --quiet

# Open the SSE endpoint in a browser on startup
sentry local --open

SENTRY_DSN=http://public@localhost:8969/1
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
