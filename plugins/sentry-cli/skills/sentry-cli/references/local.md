---
name: sentry-cli-local
version: 0.35.0-dev.0
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

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
