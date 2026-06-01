---
name: sentry-cli-local
version: 0.35.0
description: Sentry for local development
requires:
  bins: ["sentry"]
  auth: true
---

# Local Commands

Sentry for local development

### `sentry local serve`

Start the local dev server and tail events

**Flags:**
- `-p, --port <value> - Port to listen on (default 8969) - (default: "8969")`
- `-H, --host <value> - Hostname to bind to (default localhost) - (default: "localhost")`
- `-q, --quiet - Suppress per-envelope tail output`
- `-f, --filter <value>... - Only show items of this type (repeatable: error, transaction, log, ai)`
- `-F, --format <value> - Output format: human (default) or json (NDJSON) - (default: "human")`

### `sentry local run <command...>`

Run a command with the local dev server enabled

**Flags:**
- `-p, --port <value> - Port for the local server (default 8969) - (default: "8969")`
- `--host <value> - Hostname for the local server (default localhost) - (default: "localhost")`

**Examples:**

```bash
# Start the server and tail events (default)
sentry local

# Run your app with the local server auto-enabled
sentry local run -- npm run dev
sentry local run -- python manage.py runserver

# Use a custom port
sentry local --port 9000

# Only show errors and logs (filter out transactions)
sentry local -f error -f log

# Run quietly (suppress per-envelope tail output)
sentry local --quiet

sentry local -f error -f log    # only errors and logs

sentry local --format json
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
