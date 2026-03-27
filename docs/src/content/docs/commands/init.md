---
title: init
description: Init command for the Sentry CLI
---

Initialize Sentry in your project (experimental)

## Usage

### `sentry init <target> <directory>`

Initialize Sentry in your project (experimental)

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<target>` | &lt;org&gt;/&lt;project&gt;, &lt;org&gt;/, &lt;project&gt;, or a directory path (optional) |
| `<directory>` | Project directory (default: current directory) (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-y, --yes` | Non-interactive mode (accept defaults) |
| `--dry-run` | Preview changes without applying them |
| `--features <features>...` | Features to enable: errors,tracing,logs,replay,metrics,profiling,sourcemaps,crons,ai-monitoring,user-feedback |
| `-t, --team <team>` | Team slug to create the project under |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# Interactive setup
sentry init

# Non-interactive with auto-yes
sentry init -y

# Dry run to preview changes
sentry init --dry-run

# Enable specific features
sentry init --features profiling,replays
```
