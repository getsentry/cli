---
title: init
description: AI-powered project setup wizard for the Sentry CLI
---

> **Experimental:** `sentry init` is experimental and may modify your source files. Always review changes before committing.

Set up Sentry in your project with an AI-powered wizard. The `init` command detects your platform and framework, installs the Sentry SDK, and instruments your code for error monitoring, tracing, and more.

Run `sentry init` from your repo root — no arguments needed. The wizard auto-detects your framework and Sentry org.

**Prerequisites:** You must be authenticated first. Run `sentry auth login` if you haven't already.

## Usage

```bash
sentry init [target] [directory]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[target]` | Org/project target (see [Target syntax](#target-syntax) below). Omit to auto-detect. |
| `[directory]` | Project directory (default: current directory) |

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Continue even if Sentry is already installed |
| `-y, --yes` | Non-interactive mode (accept defaults) |
| `--dry-run` | Preview changes without applying them |
| `--features <list>` | Comma-separated features to enable (see [Features](#features) below) |
| `-t, --team <slug>` | Team slug to create the project under |

## Target syntax

The optional `[target]` argument lets you specify which Sentry org and project to use:

| Syntax | Meaning |
|--------|---------|
| _(omitted)_ | Auto-detect org and project |
| `acme/` | Use org `acme`, auto-detect or create project |
| `acme/my-app` | Use org `acme` and project `my-app` |
| `my-app` | Search for project `my-app` across all accessible orgs |

Path-like arguments (starting with `.`, `/`, or `~`) are always treated as the directory. The order of `[target]` and `[directory]` can be swapped — the CLI will auto-correct with a warning.

## Features

Pass a comma-separated list to `--features` to control which integrations are configured:

| Feature | Description |
|---------|-------------|
| `errors` | Error monitoring |
| `tracing` | Performance tracing |
| `logs` | Log integration |
| `replay` | Session replay |
| `metrics` | Custom metrics |
| `profiling` | Profiling |
| `sourcemaps` | Source map uploads |
| `crons` | Cron job monitoring |
| `ai-monitoring` | AI/LLM monitoring |
| `user-feedback` | User feedback widget |

## Examples

```bash
# Run the wizard in the current directory
sentry init

# Target a subdirectory
sentry init ./my-app

# Use a specific org (auto-detect project)
sentry init acme/

# Use a specific org and project
sentry init acme/my-app

# Use a specific org and project in a subdirectory
sentry init acme/my-app ./my-app

# Preview what changes would be made
sentry init --dry-run

# Select specific features
sentry init --features errors,tracing,logs

# Non-interactive mode (accept all defaults)
sentry init --yes

# Assign a team when creating a new project
sentry init acme/ --team backend
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
