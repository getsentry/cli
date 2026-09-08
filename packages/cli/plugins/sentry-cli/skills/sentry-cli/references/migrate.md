---
name: sentry-cli-migrate
version: 0.43.0-dev.0
description: Upgrade a project across a Sentry SDK major version
requires:
  bins: ["sentry"]
  auth: true
---

# Migrate Commands

Upgrade a project across a Sentry SDK major version

### `sentry migrate`

Upgrade a project across a Sentry SDK major version

**Flags:**
- `--dry-run - Report what would change without writing anything`
- `--allow-dirty - Run even though the working tree has uncommitted changes`
- `--migration <value> - Run a specific migration instead of detecting one`
- `--cwd <value> - Directory to migrate (defaults to the current directory)`
- `--only <value> - Comma-separated task ids to run exclusively`
- `--skip <value> - Comma-separated task ids to skip`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
