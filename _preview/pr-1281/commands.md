---
title: "Commands"
description: "Available commands in the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1281/commands/"
---

# Commands

The Sentry CLI provides commands for interacting with various Sentry resources.

## Available Commands

[Section titled “Available Commands”](#available-commands)

| Command | Description |
| --- | --- |
| [`alert`](https://cli.sentry.dev/_preview/pr-1281/commands/alert.md) | Manage Sentry alert rules |
| [`auth`](https://cli.sentry.dev/_preview/pr-1281/commands/auth.md) | Authenticate with Sentry |
| [`build`](https://cli.sentry.dev/_preview/pr-1281/commands/build.md) | Manage mobile build artifacts |
| [`cli`](https://cli.sentry.dev/_preview/pr-1281/commands/cli.md) | CLI-related commands |
| [`code-mappings`](https://cli.sentry.dev/_preview/pr-1281/commands/code-mappings.md) | Manage code mappings for stack trace linking |
| [`dart-symbol-map`](https://cli.sentry.dev/_preview/pr-1281/commands/dart-symbol-map.md) | Work with Dart/Flutter symbol maps |
| [`debug-files`](https://cli.sentry.dev/_preview/pr-1281/commands/debug-files.md) | Work with debug information files |
| [`dashboard`](https://cli.sentry.dev/_preview/pr-1281/commands/dashboard.md) | Manage Sentry dashboards |
| [`org`](https://cli.sentry.dev/_preview/pr-1281/commands/org.md) | Work with Sentry organizations |
| [`project`](https://cli.sentry.dev/_preview/pr-1281/commands/project.md) | Work with Sentry projects |
| [`proguard`](https://cli.sentry.dev/_preview/pr-1281/commands/proguard.md) | Work with ProGuard/R8 mapping files |
| [`react-native`](https://cli.sentry.dev/_preview/pr-1281/commands/react-native.md) | Upload React Native sourcemaps from build steps |
| [`replay`](https://cli.sentry.dev/_preview/pr-1281/commands/replay.md) | Search and inspect Session Replays |
| [`release`](https://cli.sentry.dev/_preview/pr-1281/commands/release.md) | Work with Sentry releases |
| [`repo`](https://cli.sentry.dev/_preview/pr-1281/commands/repo.md) | Work with Sentry repositories |
| [`team`](https://cli.sentry.dev/_preview/pr-1281/commands/team.md) | Work with Sentry teams |
| [`issue`](https://cli.sentry.dev/_preview/pr-1281/commands/issue.md) | Manage Sentry issues |
| [`event`](https://cli.sentry.dev/_preview/pr-1281/commands/event.md) | View, list, and send Sentry events |
| [`explore`](https://cli.sentry.dev/_preview/pr-1281/commands/explore.md) | Query aggregate event data (Explore) |
| [`log`](https://cli.sentry.dev/_preview/pr-1281/commands/log.md) | View Sentry logs |
| [`monitor`](https://cli.sentry.dev/_preview/pr-1281/commands/monitor.md) | Work with Sentry cron monitors |
| [`snapshots`](https://cli.sentry.dev/_preview/pr-1281/commands/snapshots.md) | Manage and compare snapshots |
| [`sourcemap`](https://cli.sentry.dev/_preview/pr-1281/commands/sourcemap.md) | Manage sourcemaps |
| [`span`](https://cli.sentry.dev/_preview/pr-1281/commands/span.md) | List and view spans in projects or traces |
| [`trace`](https://cli.sentry.dev/_preview/pr-1281/commands/trace.md) | View distributed traces |
| [`trial`](https://cli.sentry.dev/_preview/pr-1281/commands/trial.md) | Manage product trials |
| [`init`](https://cli.sentry.dev/_preview/pr-1281/commands/init.md) | Initialize Sentry in your project (experimental) |
| [`info`](https://cli.sentry.dev/_preview/pr-1281/commands/info.md) | Print configuration and verify authentication |
| [`local`](https://cli.sentry.dev/_preview/pr-1281/commands/local.md) | Sentry for local development |
| [`api`](https://cli.sentry.dev/_preview/pr-1281/commands/api.md) | Make an authenticated API request |
| [`schema`](https://cli.sentry.dev/_preview/pr-1281/commands/schema.md) | Browse the Sentry API schema |

## Global Options

[Section titled “Global Options”](#global-options)

All commands support the following global options:

- `--help` - Show help for the command
- `--version` - Show CLI version
- `--log-level <level>` - Set log verbosity (`error`, `warn`, `log`, `info`, `debug`, `trace`). Overrides `SENTRY_LOG_LEVEL`
- `--verbose` - Shorthand for `--log-level debug`

## JSON Output

[Section titled “JSON Output”](#json-output)

Most list and view commands support `--json` flag for JSON output, making it easy to integrate with other tools:

Terminal window

```
sentry org list --json | jq '.[] | .slug'
```


## Opening in Browser

[Section titled “Opening in Browser”](#opening-in-browser)

View commands support `-w` or `--web` flag to open the resource in your browser:

Terminal window

```
sentry issue view PROJ-123 -w
```

## Pages in this section

- [alert](https://cli.sentry.dev/_preview/pr-1281/commands/alert.md)
- [api](https://cli.sentry.dev/_preview/pr-1281/commands/api.md)
- [auth](https://cli.sentry.dev/_preview/pr-1281/commands/auth.md)
- [build](https://cli.sentry.dev/_preview/pr-1281/commands/build.md)
- [cli](https://cli.sentry.dev/_preview/pr-1281/commands/cli.md)
- [code-mappings](https://cli.sentry.dev/_preview/pr-1281/commands/code-mappings.md)
- [dart-symbol-map](https://cli.sentry.dev/_preview/pr-1281/commands/dart-symbol-map.md)
- [dashboard](https://cli.sentry.dev/_preview/pr-1281/commands/dashboard.md)
- [debug-files](https://cli.sentry.dev/_preview/pr-1281/commands/debug-files.md)
- [event](https://cli.sentry.dev/_preview/pr-1281/commands/event.md)
- [explore](https://cli.sentry.dev/_preview/pr-1281/commands/explore.md)
- [info](https://cli.sentry.dev/_preview/pr-1281/commands/info.md)
- [init](https://cli.sentry.dev/_preview/pr-1281/commands/init.md)
- [issue](https://cli.sentry.dev/_preview/pr-1281/commands/issue.md)
- [local](https://cli.sentry.dev/_preview/pr-1281/commands/local.md)
- [log](https://cli.sentry.dev/_preview/pr-1281/commands/log.md)
- [monitor](https://cli.sentry.dev/_preview/pr-1281/commands/monitor.md)
- [org](https://cli.sentry.dev/_preview/pr-1281/commands/org.md)
- [proguard](https://cli.sentry.dev/_preview/pr-1281/commands/proguard.md)
- [project](https://cli.sentry.dev/_preview/pr-1281/commands/project.md)
- [react-native](https://cli.sentry.dev/_preview/pr-1281/commands/react-native.md)
- [release](https://cli.sentry.dev/_preview/pr-1281/commands/release.md)
- [replay](https://cli.sentry.dev/_preview/pr-1281/commands/replay.md)
- [repo](https://cli.sentry.dev/_preview/pr-1281/commands/repo.md)
- [schema](https://cli.sentry.dev/_preview/pr-1281/commands/schema.md)
- [snapshots](https://cli.sentry.dev/_preview/pr-1281/commands/snapshots.md)
- [sourcemap](https://cli.sentry.dev/_preview/pr-1281/commands/sourcemap.md)
- [span](https://cli.sentry.dev/_preview/pr-1281/commands/span.md)
- [team](https://cli.sentry.dev/_preview/pr-1281/commands/team.md)
- [trace](https://cli.sentry.dev/_preview/pr-1281/commands/trace.md)
- [trial](https://cli.sentry.dev/_preview/pr-1281/commands/trial.md)
