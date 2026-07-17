---
title: "trial"
description: "Trial commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1267/commands/trial/"
---

# trial

Manage product trials

## Commands

[Section titled “Commands”](#commands)

### `sentry trial list <org>`

[Section titled “sentry trial list <org>”](#sentry-trial-list-org)

List product trials

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org>` | Organization slug (auto-detected if omitted) |

### `sentry trial start <name> <org>`

[Section titled “sentry trial start <name> <org>”](#sentry-trial-start-name-org)

Start a product trial

**Arguments:**

| Argument | Description |
| --- | --- |
| `<name>` | Trial name (seer, replays, performance, spans, profiling, logs, monitors, uptime, plan) |
| `<org>` | Organization slug (auto-detected if omitted) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# List all trials for the current orgsentry trial list
# List trials for a specific orgsentry trial list my-org
# Start a Seer trialsentry trial start seer
# Start a trial for a specific orgsentry trial start replays my-org
# Start a Business plan trial (opens browser)sentry trial start plan
```
