# Cli Commands

CLI-related commands

## `sentry cli feedback <message...>`

Send feedback about the CLI

**Examples:**

```bash
# Send positive feedback
sentry cli feedback i love this tool

# Report an issue
sentry cli feedback the issue view is confusing

# Suggest an improvement
sentry cli feedback would be great to have a search command
```

## `sentry cli fix`

Diagnose and repair CLI database issues

**Flags:**
- `--dry-run - Show what would be fixed without making changes`

## `sentry cli setup`

Configure shell integration

**Flags:**
- `--install - Install the binary from a temp location to the system path`
- `--method <value> - Installation method (curl, npm, pnpm, bun, yarn)`
- `--channel <value> - Release channel to persist (stable or nightly)`
- `--no-modify-path - Skip PATH modification`
- `--no-completions - Skip shell completion installation`
- `--no-agent-skills - Skip agent skill installation for AI coding assistants`
- `--quiet - Suppress output (for scripted usage)`

## `sentry cli upgrade <version>`

Update the Sentry CLI to the latest version

**Flags:**
- `--check - Check for updates without installing`
- `--force - Force upgrade even if already on the latest version`
- `--method <value> - Installation method to use (curl, brew, npm, pnpm, bun, yarn)`

**Examples:**

```bash
sentry cli upgrade --check

sentry cli upgrade

sentry cli upgrade nightly
# or equivalently:
sentry cli upgrade --channel nightly

sentry cli upgrade stable
# or equivalently:
sentry cli upgrade --channel stable

sentry cli upgrade 0.5.0

sentry cli upgrade --force

sentry cli upgrade --method npm
```

**Expected output:**

```
Installation method: curl
Current version: 0.4.0
Channel: stable
Latest version: 0.5.0

Run 'sentry cli upgrade' to update.

Installation method: curl
Current version: 0.4.0
Channel: stable
Latest version: 0.5.0

Upgrading to 0.5.0...

Successfully upgraded to 0.5.0.
```

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

## Workflows

### Update the CLI
1. Check for updates: `sentry cli upgrade --check`
2. Upgrade: `sentry cli upgrade`

### Switch to nightly builds
1. Switch channel: `sentry cli upgrade nightly`
2. Subsequent updates track nightly: `sentry cli upgrade`
3. Switch back to stable: `sentry cli upgrade stable`
