---
name: sentry-cli-trials
version: 0.18.1
description: List and start product trials
requires:
  bins: ["sentry"]
  auth: true
---

# Trial Commands

Manage product trials

### `sentry trial list <org>`

List product trials

### `sentry trial start <name> <org>`

Start a product trial

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
