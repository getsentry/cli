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

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `category` | string | Trial category (e.g. seerUsers, seerAutofix) |
| `startDate` | string \| null | Start date (ISO 8601) |
| `endDate` | string \| null | End date (ISO 8601) |
| `reasonCode` | number | Reason code |
| `isStarted` | boolean | Whether the trial has started |
| `lengthDays` | number \| null | Trial duration in days |

### `sentry trial start <name> <org>`

Start a product trial

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
