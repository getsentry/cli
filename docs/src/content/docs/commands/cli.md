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
| `<message...>` | Your feedback message |

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
| `<version>` | Specific version (e.g. 0.5.0), or "nightly"/"stable" to switch channel; omit to update within current channel |

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

### Check for updates

```bash
sentry cli upgrade --check
```

```
Installation method: curl
Current version: 0.4.0
Channel: stable
Latest version: 0.5.0

Run 'sentry cli upgrade' to update.
```

### Upgrade

```bash
# Upgrade to latest stable
sentry cli upgrade

# Upgrade to a specific version
sentry cli upgrade 0.5.0

# Force re-download
sentry cli upgrade --force
```

### Release Channels

```bash
# Switch to nightly builds
sentry cli upgrade nightly

# Switch back to stable
sentry cli upgrade stable
```

After switching, bare `sentry cli upgrade` will continue tracking that channel.

| Channel | Description |
|---------|-------------|
| `stable` | Latest stable release (default) |
| `nightly` | Built from `main`, updated on every commit |

### Installation Detection

The CLI detects how it was installed and uses the appropriate upgrade method:

| Method | Detection |
|--------|-----------|
| curl | Binary in `~/.sentry/bin` (installed via cli.sentry.dev) |
| brew | Binary in a Homebrew Cellar (`brew install getsentry/tools/sentry`) |
| npm | Globally installed via `npm install -g sentry` |
| pnpm | Globally installed via `pnpm add -g sentry` |
| bun | Globally installed via `bun add -g sentry` |
| yarn | Globally installed via `yarn global add sentry` |

Nightly builds are only available as standalone binaries (via the curl install method). Switching to nightly from a package manager install will automatically migrate to a standalone binary.

### Send feedback

```bash
# Send positive feedback
sentry cli feedback i love this tool

# Report an issue
sentry cli feedback the issue view is confusing
```

Feedback is sent via Sentry's telemetry system. If telemetry is disabled (`SENTRY_CLI_NO_TELEMETRY=1`), feedback cannot be sent.

### Fix configuration issues

```bash
sentry cli fix
```

### Configure shell integration

```bash
# Run full setup (PATH, completions, agent skills)
sentry cli setup

# Skip agent skill installation
sentry cli setup --no-agent-skills

# Skip PATH and completion modifications
sentry cli setup --no-modify-path --no-completions
```
