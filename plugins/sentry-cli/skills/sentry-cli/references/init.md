---
name: sentry-cli-init
version: 0.35.0-dev.0
description: Initialize Sentry in your project (experimental)
requires:
  bins: ["sentry"]
  auth: true
---

# Init Commands

Initialize Sentry in your project (experimental)

### `sentry init <target> <directory>`

Initialize Sentry in your project (experimental)

**Flags:**
- `-y, --yes - Accept non-interactive defaults (requires --features outside a TTY)`
- `-n, --dry-run - Show what would happen without making changes`
- `--features <value>... - Features to enable: errors,tracing,logs,replay,metrics,profiling,sourcemaps,crons,ai-monitoring,user-feedback`
- `-t, --team <value> - Team slug to create the project under`
- `--tui - Use the Ink-based interactive UI (default). Pass --no-tui to fall back to plain log output.`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
