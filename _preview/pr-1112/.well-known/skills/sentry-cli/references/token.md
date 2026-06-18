---
name: sentry-cli-token
version: 0.38.0-dev.0
description: Manage org auth tokens
requires:
  bins: ["sentry"]
  auth: true
---

# Token Commands

Manage org auth tokens

### `sentry token create <org>`

Create an org auth token

**Flags:**
- `--name <value> - Name for the new token`

### `sentry token delete <org> <token-id>`

Delete an org auth token

**Flags:**
- `-y, --yes - Skip confirmation prompt`
- `-f, --force - Force the operation without confirmation`
- `-n, --dry-run - Show what would happen without making changes`

### `sentry token list <org>`

List org auth tokens

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
