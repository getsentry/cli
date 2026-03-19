---
name: sentry-cli-setup
version: 0.18.1
description: Configure the CLI, install integrations, and manage upgrades
requires:
  bins: ["sentry"]
  auth: true
---

# CLI Setup Commands

CLI-related commands

Initialize Sentry in your project

Browse the Sentry API schema

### `sentry cli feedback <message...>`

Send feedback about the CLI

### `sentry cli fix`

Diagnose and repair CLI database issues

**Flags:**
- `--dry-run - Show what would be fixed without making changes`

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

### `sentry init <target> <directory>`

Initialize Sentry in your project

**Flags:**
- `-y, --yes - Non-interactive mode (accept defaults)`
- `--dry-run - Preview changes without applying them`
- `--features <value>... - Features to enable: errors,tracing,logs,replay,metrics,profiling,sourcemaps,crons,ai-monitoring,user-feedback`
- `-t, --team <value> - Team slug to create the project under`

### `sentry schema <resource...>`

Browse the Sentry API schema

**Flags:**
- `--all - Show all endpoints in a flat list`
- `-q, --search <value> - Search endpoints by keyword`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
