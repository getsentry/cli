---
title: cli upgrade
description: Update the Sentry CLI to the latest version
---

Self-update the Sentry CLI to the latest or a specific version.

## Usage

```bash
sentry cli upgrade              # Update to latest version
sentry cli upgrade 0.5.0        # Update to specific version
sentry cli upgrade --check      # Check for updates without installing
sentry cli upgrade --method npm # Force using npm to upgrade
```

## Options

| Option | Description |
|--------|-------------|
| `<version>` | Target version to install (defaults to latest) |
| `--check` | Check for updates without installing |
| `--method <method>` | Force installation method: curl, npm, pnpm, bun, yarn |

## Installation Detection

The CLI auto-detects how it was installed and uses the same method to upgrade:

| Method | Detection |
|--------|-----------|
| curl | Binary located in `~/.sentry/bin` (installed via cli.sentry.dev) |
| npm | Globally installed via `npm install -g sentry` |
| pnpm | Globally installed via `pnpm add -g sentry` |
| bun | Globally installed via `bun install -g sentry` |
| yarn | Globally installed via `yarn global add sentry` |

## Examples

### Check for updates

```bash
sentry cli upgrade --check
```

```
Installation method: curl
Current version: 0.4.0
Latest version: 0.5.0

Run 'sentry cli upgrade' to update.
```

### Upgrade to latest

```bash
sentry cli upgrade
```

```
Installation method: curl
Current version: 0.4.0
Latest version: 0.5.0

Upgrading to 0.5.0...

Successfully upgraded to 0.5.0.
```

### Upgrade to specific version

```bash
sentry cli upgrade 0.5.0
```

### Force installation method

If auto-detection fails or you want to switch installation methods:

```bash
sentry cli upgrade --method npm
```
