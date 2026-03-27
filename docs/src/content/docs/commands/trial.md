---
title: trial
description: Trial commands for the Sentry CLI
---

Manage product trials

## Commands

### `sentry trial list <org>`

List product trials

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>` | Organization slug (auto-detected if omitted) (optional) |

### `sentry trial start <name> <org>`

Start a product trial

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<name>` | Trial name (seer, replays, performance, spans, profiling, logs, monitors, uptime, plan) |
| `<org>` | Organization slug (auto-detected if omitted) (optional) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# List all trials for the current org
sentry trial list

# List trials for a specific org
sentry trial list my-org

# Start a Seer trial
sentry trial start seer

# Start a trial for a specific org
sentry trial start replays my-org

# Start a Business plan trial (opens browser)
sentry trial start plan
```
