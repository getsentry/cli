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

**Examples:**

```bash
# List org auth tokens
sentry token list my-org

# Create a new token
sentry token create my-org --name 'CI deploy token'

# Delete a token by ID
sentry token delete my-org 12345 --yes

# Delete a token (dry run)
sentry token delete my-org 12345 --dry-run

# Output as JSON
sentry token list --json
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
