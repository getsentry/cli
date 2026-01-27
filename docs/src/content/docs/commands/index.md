---
title: Commands Overview
description: Overview of all Sentry CLI commands
---

The Sentry CLI provides commands for interacting with various Sentry resources.

## Available Commands

| Command | Description |
|---------|-------------|
| [`auth`](./auth/) | Authentication management |
| [`org`](./org/) | Organization operations |
| [`project`](./project/) | Project operations |
| [`issue`](./issue/) | Issue tracking |
| [`event`](./event/) | Event inspection |
| [`api`](./api/) | Direct API access |

## Global Options

All commands support the following global options:

- `--help` - Show help for the command
- `--version` - Show CLI version

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
