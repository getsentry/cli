---
name: sentry-cli-setup
version: 0.22.0
description: Configure the CLI, install integrations, and manage upgrades
requires:
  bins: ["sentry"]
  auth: true
---

# CLI Setup Commands

CLI-related commands

Initialize Sentry in your project (experimental)

Browse the Sentry API schema

### `sentry cli feedback <message...>`

Send feedback about the CLI

**Examples:**

```bash
# Send positive feedback
sentry cli feedback i love this tool

# Report an issue
sentry cli feedback the issue view is confusing
```

### `sentry cli fix`

Diagnose and repair CLI database issues

**Flags:**
- `--dry-run - Show what would be fixed without making changes`

**Examples:**

```bash
sentry cli fix
```

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

**Examples:**

```bash
sentry cli upgrade --check

# Upgrade to latest stable
sentry cli upgrade

# Upgrade to a specific version
sentry cli upgrade 0.5.0

# Force re-download
sentry cli upgrade --force

# Switch to nightly builds
sentry cli upgrade nightly

# Switch back to stable
sentry cli upgrade stable
```

### `sentry init <target> <directory>`

Initialize Sentry in your project (experimental)

**Flags:**
- `-y, --yes - Non-interactive mode (accept defaults)`
- `--dry-run - Preview changes without applying them`
- `--features <value>... - Features to enable: errors,tracing,logs,replay,metrics,profiling,sourcemaps,crons,ai-monitoring,user-feedback`
- `-t, --team <value> - Team slug to create the project under`

**Examples:**

```bash
# Interactive setup
sentry init

# Non-interactive with auto-yes
sentry init -y

# Dry run to preview changes
sentry init --dry-run

# Target a subdirectory
sentry init ./my-app

# Use a specific org (auto-detect project)
sentry init acme/

# Use a specific org and project
sentry init acme/my-app

# Assign a team when creating a new project
sentry init acme/ --team backend

# Enable specific features
sentry init --features profiling,replay
```

### `sentry schema <resource...>`

Browse the Sentry API schema

**Flags:**
- `--all - Show all endpoints in a flat list`
- `-q, --search <value> - Search endpoints by keyword`

**Examples:**

```bash
# List all API resources
sentry schema

# Browse issue endpoints
sentry schema issues

# View details for a specific operation
sentry schema issues list

# Search for monitoring-related endpoints
sentry schema --search monitor

# Flat list of every endpoint
sentry schema --all
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
