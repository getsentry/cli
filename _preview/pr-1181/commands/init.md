---
title: "init"
description: "Init command for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1181/commands/init/"
---

# init

Initialize Sentry in your project (experimental)

## Usage

[Section titled “Usage”](#usage)

### `sentry init <target> <directory>`

[Section titled “sentry init <target> <directory>”](#sentry-init-target-directory)

Initialize Sentry in your project (experimental)

**Arguments:**

| Argument | Description |
| --- | --- |
| `<target>` | <org>/<project>, <org>/, <project>, or a directory path |
| `<directory>` | Project directory (default: current directory) |

**Options:**

| Option | Description |
| --- | --- |
| `-y, --yes` | Accept non-interactive defaults (requires --features outside a TTY) |
| `-n, --dry-run` | Show what would happen without making changes |
| `--features <features>...` | Features to enable: errors,tracing,logs,replay,metrics,profiling,sourcemaps,crons,ai-monitoring,user-feedback |
| `-t, --team <team>` | Team slug to create the project under |
| `--app <app>` | App to initialize in a monorepo (required with --yes when multiple apps are detected) |
| `--tui` | Use the Ink-based interactive UI (default). Pass --no-tui to fall back to plain log output. |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

> **Experimental:** `sentry init` is experimental and may modify your source files. Always review changes before committing.

**Prerequisites:** You must be authenticated first. Run `sentry auth login` if you haven't already.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# Interactive setupsentry init
# Non-interactive agent/CI setupsentry init --yes --features errors,tracing,replay
# Dry run to preview changessentry init --dry-run
# Target a subdirectorysentry init ./my-app
# Use a specific org (auto-detect project)sentry init acme/
# Use a specific org and projectsentry init acme/my-app
# Assign a team when creating a new projectsentry init acme/ --team backend
# Enable specific featuressentry init --features profiling,replay
```


## Target Syntax

[Section titled “Target Syntax”](#target-syntax)

| Syntax | Meaning |
| --- | --- |
| _(omitted)_ | Auto-detect org and project |
| `acme/` | Use org `acme`, auto-detect or create project |
| `acme/my-app` | Use org `acme` and project `my-app` |
| `my-app` | Search for project `my-app` across all accessible orgs |

Path-like arguments (starting with `.`, `/`, or `~`) are always treated as the directory. The order of target and directory can be swapped — the CLI will auto-correct with a warning.

## Available Features

[Section titled “Available Features”](#available-features)

| Feature | Description |
| --- | --- |
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

## What the Wizard Does

[Section titled “What the Wizard Does”](#what-the-wizard-does)

1. **Detects your framework** — scans your project files to identify the platform and framework
2. **Installs the SDK** — adds the appropriate Sentry SDK package to your project
3. **Instruments your code** — configures error monitoring, tracing, and any selected features

### Supported Platforms

[Section titled “Supported Platforms”](#supported-platforms)

- **JavaScript / TypeScript** — Next.js, Express, SvelteKit, React
- **Python** — Flask, FastAPI

More platforms and frameworks are coming soon.
