---
title: Commands
description: Available commands in the Sentry CLI
---

The Sentry CLI provides commands for interacting with various Sentry resources.

## Available Commands

| Command | Description |
|---------|-------------|
| [`auth`](./auth/) | Authenticate with Sentry |
| [`cli`](./cli/) | CLI-related commands |
| [`org`](./org/) | Work with Sentry organizations |
| [`project`](./project/) | Work with Sentry projects |
| [`team`](./team/) | Work with Sentry teams |
| [`issue`](./issue/) | Manage Sentry issues |
| [`event`](./event/) | View Sentry events |
| [`log`](./log/) | View Sentry logs |
| [`trace`](./trace/) | View distributed traces |
| [`span`](./span/) | List and view spans in projects or traces |
| [`dashboard`](./dashboard/) | Manage Sentry dashboards |
| [`sourcemap`](./sourcemap/) | Manage sourcemaps |
| [`repo`](./repo/) | Work with Sentry repositories |
| [`trial`](./trial/) | Manage product trials |
| [`init`](./init/) | Initialize Sentry in your project (experimental) |
| [`schema`](./schema/) | Browse the Sentry API schema |
| [`api`](./api/) | Make an authenticated API request |

<!-- GENERATED:END -->

## Global Options

All commands support the following global options:

- `--help` - Show help for the command
- `--version` - Show CLI version
- `--log-level <level>` - Set log verbosity (`error`, `warn`, `log`, `info`, `debug`, `trace`). Overrides `SENTRY_LOG_LEVEL`
- `--verbose` - Shorthand for `--log-level debug`

## JSON Output

Most list and view commands support `--json` flag for JSON output, making it easy to integrate with other tools:

```bash
sentry org list --json | jq '.[] | .slug'
```

## Opening in Browser

View commands support `-w` or `--web` flag to open the resource in your browser:

```bash
sentry issue view PROJ-123 -w
```
