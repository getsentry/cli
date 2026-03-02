---
title: cli upgrade
description: Update the Sentry CLI to the latest version
---

Self-update the Sentry CLI to the latest or a specific version.

## Usage

```bash
sentry cli upgrade              # Update using the persisted channel (default: stable)
sentry cli upgrade nightly      # Switch to nightly channel and update
sentry cli upgrade stable       # Switch back to stable channel and update
sentry cli upgrade 0.5.0        # Update to a specific stable version
sentry cli upgrade --check      # Check for updates without installing
sentry cli upgrade --force      # Force re-download even if already up to date
sentry cli upgrade --method npm # Force using npm to upgrade
```

## Options

| Option | Description |
|--------|-------------|
| `<version>` | Target version, or `nightly`/`stable` to switch channel (defaults to latest) |
| `--check` | Check for updates without installing |
| `--force` | Re-download even if already on the latest version |
| `--channel <channel>` | Set release channel: `stable` or `nightly` |
| `--method <method>` | Force installation method: curl, brew, npm, pnpm, bun, yarn |

## Release Channels

The CLI supports two release channels:

| Channel | Description |
|---------|-------------|
| `stable` | Latest stable release (default) |
| `nightly` | Built from `main`, updated on every commit |

The chosen channel is persisted locally so that subsequent bare `sentry cli upgrade`
calls use the same channel without requiring a flag.

## Installation Detection

The CLI auto-detects how it was installed and uses the same method to upgrade:

| Method | Detection |
|--------|-----------|
| curl | Binary located in `~/.sentry/bin` (installed via cli.sentry.dev) |
| brew | Binary located in a Homebrew Cellar (installed via `brew install getsentry/tools/sentry`) |
| npm | Globally installed via `npm install -g sentry` |
| pnpm | Globally installed via `pnpm add -g sentry` |
| bun | Globally installed via `bun install -g sentry` |
| yarn | Globally installed via `yarn global add sentry` |

> **Note:** Nightly builds are only available as standalone binaries (via the curl
> install method). If you switch to the nightly channel from a package manager or
> Homebrew install, the CLI will automatically migrate to a standalone binary and
> warn you about the existing package-manager installation.

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

### Upgrade to latest stable

```bash
sentry cli upgrade
```

```
Installation method: curl
Current version: 0.4.0
Channel: stable
Latest version: 0.5.0

Upgrading to 0.5.0...

Successfully upgraded to 0.5.0.
```

### Switch to nightly channel

```bash
sentry cli upgrade nightly
# or equivalently:
sentry cli upgrade --channel nightly
```

After switching, bare `sentry cli upgrade` will continue tracking nightly.

### Switch back to stable

```bash
sentry cli upgrade stable
# or equivalently:
sentry cli upgrade --channel stable
```

### Upgrade to specific version

```bash
sentry cli upgrade 0.5.0
```

### Force re-download

```bash
sentry cli upgrade --force
```

### Force installation method

If auto-detection fails or you want to switch installation methods:

```bash
sentry cli upgrade --method npm
```
