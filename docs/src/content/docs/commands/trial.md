---
title: trial
description: Trial commands for the Sentry CLI
---

View and start product trials for a Sentry organization.

## Commands

### `sentry trial list`

List product trials for an organization, including available, active, and expired trials.

```bash
# Auto-detect org
sentry trial list

# Explicit org
sentry trial list <org>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>` | Organization slug (auto-detected if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

**Examples:**

```bash
# List all trials for the current org
sentry trial list

# List trials for a specific org
sentry trial list my-org

# Machine-readable output
sentry trial list --json
```

### `sentry trial start`

Start a product trial for an organization.

```bash
sentry trial start <name>
sentry trial start <name> <org>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<name>` | Trial name (e.g., `seer`, `replays`, `profiling`, `plan`) |
| `<org>` | Organization slug (auto-detected if omitted) |

Use `plan` to start a Business plan trial (opens the billing page in a browser).

**Examples:**

```bash
# Start a Seer trial
sentry trial start seer

# Start a trial for a specific org
sentry trial start replays my-org

# Start a Business plan trial (opens browser)
sentry trial start plan
```
