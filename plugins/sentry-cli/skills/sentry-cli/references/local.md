---
name: sentry-cli-local
version: 0.35.0-dev.0
description: Run a local Spotlight server for development
requires:
  bins: ["sentry"]
  auth: true
---

# Local Commands

Run a local Spotlight server for development

### `sentry local server`

Run a local Spotlight server to capture dev SDK events

**Flags:**
- `-p, --port <value> - Port to listen on (default 8969) - (default: "8969")`
- `-H, --host <value> - Hostname to bind to (default localhost) - (default: "localhost")`
- `-q, --quiet - Suppress per-envelope tail output`
- `-f, --filter <value>... - Only show items of this type (repeatable: error, transaction, log)`

### `sentry local run <command...>`

Run a command with Spotlight enabled

**Flags:**
- `-p, --port <value> - Port for the Spotlight server (default 8969) - (default: "8969")`
- `--host <value> - Hostname for the Spotlight server (default localhost) - (default: "localhost")`

**Examples:**

```bash
# Start the server and tail events (default)
sentry local

# Run your app with Spotlight auto-enabled
sentry local run -- npm run dev
sentry local run -- python manage.py runserver

# Use a custom port
sentry local --port 9000

# Only show errors and logs (filter out transactions)
sentry local -f error -f log

# Run quietly (suppress per-envelope tail output)
sentry local --quiet

sentry local -f error -f log    # only errors and logs
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
