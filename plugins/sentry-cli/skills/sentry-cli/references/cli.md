---
name: sentry-cli-cli
version: 0.35.0-dev.0
description: CLI-related commands
requires:
  bins: ["sentry"]
  auth: true
---

# CLI Commands

CLI-related commands

### `sentry cli defaults <key value...>`

View and manage default settings

**Flags:**
- `--clear - Clear the specified default, or all defaults if no key is given`
- `-y, --yes - Skip confirmation prompt`
- `-f, --force - Force the operation without confirmation`

### `sentry cli feedback <message...>`

Send feedback about the CLI

### `sentry cli fix`

Diagnose and repair CLI database issues

**Flags:**
- `--dry-run - Show what would be fixed without making changes`

### `sentry cli import`

Import settings from legacy .sentryclirc files

**Flags:**
- `-y, --yes - Skip confirmation prompt`
- `-n, --dry-run - Show what would happen without making changes`
- `--url <value> - Explicitly trust this URL (bypasses same-file trust check)`
- `--skip-validation - Skip token validation against the Sentry API`

### `sentry cli setup`

Configure shell integration

**Flags:**
- `--install - Install the binary from a temp location to the system path`
- `--method <value> - Installation method (curl, npm, pnpm, bun, yarn)`
- `--channel <value> - Release channel to persist (stable or nightly)`
- `--no-modify-path - Skip PATH modification`
- `--no-completions - Skip shell completion installation`
- `--no-agent-skills - Skip agent skill installation for AI coding assistants`
- `--quiet - Suppress output (for scripted usage)`

### `sentry cli upgrade <version>`

Update the Sentry CLI to the latest version

**Flags:**
- `--check - Check for updates without installing`
- `--force - Force upgrade even if already on the latest version`
- `--offline - Upgrade using only cached version info and patches (no network)`
- `--method <value> - Installation method to use (curl, brew, npm, pnpm, bun, yarn)`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
