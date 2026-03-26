---
name: sentry-cli-trials
version: 0.21.0-dev.0
description: List and start product trials
requires:
  bins: ["sentry"]
  auth: true
---

# Trial Commands

Manage product trials

### `sentry trial list <org>`

List product trials

**Examples:**

```bash
# Auto-detect org
sentry trial list

# Explicit org
sentry trial list <org>

# List all trials for the current org
sentry trial list

# List trials for a specific org
sentry trial list my-org

# Machine-readable output
sentry trial list --json
```

### `sentry trial start <name> <org>`

Start a product trial

**Examples:**

```bash
sentry trial start <name>
sentry trial start <name> <org>

# Start a Seer trial
sentry trial start seer

# Start a trial for a specific org
sentry trial start replays my-org

# Start a Business plan trial (opens browser)
sentry trial start plan
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
