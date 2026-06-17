---
title: "cli"
description: "CLI commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1108/commands/cli/"
---

# cli

CLI-related commands

## Commands

[Section titled “Commands”](#commands)

### `sentry cli defaults <key value...>`

[Section titled “sentry cli defaults <key value...>”](#sentry-cli-defaults-key-value)

View and manage default settings

**Arguments:**

| Argument | Description |
| --- | --- |
| `<key value...>` | Setting key and optional value |

**Options:**

| Option | Description |
| --- | --- |
| `--clear` | Clear the specified default, or all defaults if no key is given |
| `-y, --yes` | Skip confirmation prompt |
| `-f, --force` | Force the operation without confirmation |

### `sentry cli feedback <message...>`

[Section titled “sentry cli feedback <message...>”](#sentry-cli-feedback-message)

Send feedback about the CLI

**Arguments:**

| Argument | Description |
| --- | --- |
| `<message...>` | Your feedback message |

### `sentry cli fix`

[Section titled “sentry cli fix”](#sentry-cli-fix)

Diagnose and repair CLI database issues

**Options:**

| Option | Description |
| --- | --- |
| `--dry-run` | Show what would be fixed without making changes |

### `sentry cli import`

[Section titled “sentry cli import”](#sentry-cli-import)

Import settings from legacy .sentryclirc files

**Options:**

| Option | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation prompt |
| `-n, --dry-run` | Show what would happen without making changes |
| `--url <url>` | Explicitly trust this URL (bypasses same-file trust check) |
| `--skip-validation` | Skip token validation against the Sentry API |

### `sentry cli setup`

[Section titled “sentry cli setup”](#sentry-cli-setup)

Configure shell integration

**Options:**

| Option | Description |
| --- | --- |
| `--install` | Install the binary from a temp location to the system path |
| `--method <method>` | Installation method (curl, npm, pnpm, bun, yarn) |
| `--channel <channel>` | Release channel to persist (stable or nightly) |
| `--no-modify-path` | Skip PATH modification |
| `--no-completions` | Skip shell completion installation |
| `--no-agent-skills` | Skip agent skill installation for AI coding assistants |
| `--quiet` | Suppress output (for scripted usage) |

### `sentry cli uninstall`

[Section titled “sentry cli uninstall”](#sentry-cli-uninstall)

Uninstall Sentry CLI

**Options:**

| Option | Description |
| --- | --- |
| `--keep-config` | Keep the config directory (~/.sentry) and auth tokens |
| `-y, --yes` | Skip confirmation prompt |
| `-f, --force` | Force the operation without confirmation |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry cli upgrade <version>`

[Section titled “sentry cli upgrade <version>”](#sentry-cli-upgrade-version)

Update the Sentry CLI to the latest version

**Arguments:**

| Argument | Description |
| --- | --- |
| `<version>` | Specific version (e.g. 0.5.0), or "nightly"/"stable" to switch channel; omit to update within current channel |

**Options:**

| Option | Description |
| --- | --- |
| `--check` | Check for updates without installing |
| `--force` | Force upgrade even if already on the latest version |
| `--offline` | Upgrade using only cached version info and patches (no network) |
| `--method <method>` | Installation method to use (curl, brew, npm, pnpm, bun, yarn) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### Check for updates

[Section titled “Check for updates”](#check-for-updates)
Terminal window

```
sentry cli upgrade --check
```


```
Installation method: curlCurrent version: 0.4.0Channel: stableLatest version: 0.5.0
Run 'sentry cli upgrade' to update.
```


### Upgrade

[Section titled “Upgrade”](#upgrade)
Terminal window

```
# Upgrade to latest stablesentry cli upgrade
# Upgrade to a specific versionsentry cli upgrade 0.5.0
# Force re-downloadsentry cli upgrade --force
```


### Release Channels

[Section titled “Release Channels”](#release-channels)
Terminal window

```
# Switch to nightly buildssentry cli upgrade nightly
# Switch back to stablesentry cli upgrade stable
```


After switching, bare `sentry cli upgrade` will continue tracking that channel.

| Channel | Description |
| --- | --- |
| `stable` | Latest stable release (default) |
| `nightly` | Built from `main`, updated on every commit |

### Installation Detection

[Section titled “Installation Detection”](#installation-detection)

The CLI detects how it was installed and uses the appropriate upgrade method:

| Method | Detection |
| --- | --- |
| curl | Binary in `~/.sentry/bin` (installed via cli.sentry.dev) |
| brew | Binary in a Homebrew Cellar (`brew install getsentry/tools/sentry`) |
| npm | Globally installed via `npm install -g sentry` |
| pnpm | Globally installed via `pnpm add -g sentry` |
| bun | Globally installed via `bun install -g sentry` |

Nightly builds are only available as standalone binaries (via the curl install method). Switching to nightly from a package manager install will automatically migrate to a standalone binary.

### View and manage defaults

[Section titled “View and manage defaults”](#view-and-manage-defaults)
Terminal window

```
# Show all current defaultssentry cli defaults
# Set default organizationsentry cli defaults org my-org
# Set default projectsentry cli defaults project my-project
# Set default Sentry URL (self-hosted)sentry cli defaults url https://sentry.example.com
# Set custom HTTP headers (self-hosted, e.g. for IAP/proxies)sentry cli defaults headers "X-IAP: token"
# Set a custom CA certificate (self-hosted, behind a TLS proxy)sentry cli defaults ca-cert /path/to/ca.pem
# Disable telemetrysentry cli defaults telemetry off
# Clear a single defaultsentry cli defaults org --clear
# Clear all defaultssentry cli defaults --clear
```


### Import legacy settings

[Section titled “Import legacy settings”](#import-legacy-settings)

Import settings from `.sentryclirc` files used by the legacy `sentry-cli`:

Terminal window

```
# Auto-detect and import .sentryclircsentry cli import
# Preview what would be importedsentry cli import --dry-run
# Skip confirmation promptsentry cli import --yes
# Explicitly trust a self-hosted URLsentry cli import --url https://sentry.example.com
# Skip API validation of the imported tokensentry cli import --skip-validation
```


### Send feedback

[Section titled “Send feedback”](#send-feedback)
Terminal window

```
# Send positive feedbacksentry cli feedback i love this tool
# Report an issuesentry cli feedback the issue view is confusing
```


Feedback is sent via Sentry's telemetry system. If telemetry is disabled (`SENTRY_CLI_NO_TELEMETRY=1`), feedback cannot be sent.

### Fix configuration issues

[Section titled “Fix configuration issues”](#fix-configuration-issues)
Terminal window

```
sentry cli fix
```


### Configure shell integration

[Section titled “Configure shell integration”](#configure-shell-integration)
Terminal window

```
# Run full setup (PATH, completions, agent skills)sentry cli setup
# Skip agent skill installationsentry cli setup --no-agent-skills
# Skip PATH and completion modificationssentry cli setup --no-modify-path --no-completions
```


### Uninstall

[Section titled “Uninstall”](#uninstall)
Terminal window

```
# Show what would be removed (dry run)sentry cli uninstall --dry-run
# Uninstall, keeping config directorysentry cli uninstall --yes --keep-config
# Full uninstall with confirmationsentry cli uninstall
```
