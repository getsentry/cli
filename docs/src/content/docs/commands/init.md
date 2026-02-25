---
title: init
description: AI-powered project setup wizard for the Sentry CLI
---

Set up Sentry in your project with an AI-powered wizard. The `init` command detects your platform and framework, installs the Sentry SDK, and instruments your code for error monitoring, tracing, and more.

**Prerequisites:** You must be authenticated first. Run `sentry auth login` if you haven't already.

## Usage

```bash
sentry init [directory]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[directory]` | Project directory (default: current directory) |

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Continue even if Sentry is already installed |
| `-y, --yes` | Non-interactive mode (accept defaults) |
| `--dry-run` | Preview changes without applying them |
| `--features <list>` | Comma-separated features: `errors`, `tracing`, `logs`, `replay`, `metrics` |

## Examples

```bash
# Run the wizard in the current directory
sentry init

# Target a subdirectory
sentry init ./my-app

# Preview what changes would be made
sentry init --dry-run

# Select specific features
sentry init --features errors,tracing,logs

# Non-interactive mode (accept all defaults)
sentry init --yes
```

## What the wizard does

1. **Detects your framework** — scans your project files to identify the platform and framework
2. **Installs the SDK** — adds the appropriate Sentry SDK package to your project
3. **Instruments your code** — configures error monitoring, tracing, and any selected features

## Supported platforms

The wizard currently supports:

- **JavaScript / TypeScript** — Next.js, Express, SvelteKit, React
- **Python** — Flask, FastAPI

More platforms and frameworks are coming soon.
