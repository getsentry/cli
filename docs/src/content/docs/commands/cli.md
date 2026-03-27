---
title: cli
description: CLI commands for the Sentry CLI
---

CLI-related commands

## Commands

### `sentry cli feedback <message...>`

Send feedback about the CLI

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<message...>` | Your feedback message (optional) |

### `sentry cli fix`

Diagnose and repair CLI database issues

**Options:**

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be fixed without making changes |

### `sentry cli setup`

Configure shell integration

**Options:**

| Option | Description |
|--------|-------------|
| `--install` | Install the binary from a temp location to the system path |
| `--method <method>` | Installation method (curl, npm, pnpm, bun, yarn) |
| `--channel <channel>` | Release channel to persist (stable or nightly) |
| `--no-modify-path` | Skip PATH modification |
| `--no-completions` | Skip shell completion installation |
| `--no-agent-skills` | Skip agent skill installation for AI coding assistants |
| `--quiet` | Suppress output (for scripted usage) |

### `sentry cli upgrade <version>`

Update the Sentry CLI to the latest version

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<version>` | Specific version (e.g. 0.5.0), or "nightly"/"stable" to switch channel; omit to update within current channel (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `--check` | Check for updates without installing |
| `--force` | Force upgrade even if already on the latest version |
| `--offline` | Upgrade using only cached version info and patches (no network) |
| `--method <method>` | Installation method to use (curl, brew, npm, pnpm, bun, yarn) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# Check for updates
sentry cli upgrade --check

# Upgrade to the latest version
sentry cli upgrade

# Send feedback
sentry cli feedback "Great CLI!"

# Fix configuration issues
sentry cli fix
```
