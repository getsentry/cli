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
| [`dashboard`](./dashboard/) | Manage Sentry dashboards |
| [`org`](./org/) | Work with Sentry organizations |
| [`project`](./project/) | Work with Sentry projects |
| [`release`](./release/) | Work with Sentry releases |
| [`repo`](./repo/) | Work with Sentry repositories |
| [`team`](./team/) | Work with Sentry teams |
| [`issue`](./issue/) | Manage Sentry issues |
| [`event`](./event/) | View Sentry events |
| [`log`](./log/) | View Sentry logs |
| [`sourcemap`](./sourcemap/) | Manage sourcemaps |
| [`span`](./span/) | List and view spans in projects or traces |
| [`trace`](./trace/) | View distributed traces |
| [`trial`](./trial/) | Manage product trials |
| [`init`](./init/) | Initialize Sentry in your project (experimental) |
| [`api`](./api/) | Make an authenticated API request |
| [`schema`](./schema/) | Browse the Sentry API schema |

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
