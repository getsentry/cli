---
name: sentry-cli-dashboards
version: 0.18.1
description: List, view, and create Sentry dashboards
requires:
  bins: ["sentry"]
  auth: true
---

# Dashboard Commands

Manage Sentry dashboards

### `sentry dashboard list <org/project>`

List dashboards

**Flags:**
- `-w, --web - Open in browser`
- `-n, --limit <value> - Maximum number of dashboards to list - (default: "30")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry dashboard view <args...>`

View a dashboard

**Flags:**
- `-w, --web - Open in browser`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry dashboard create <args...>`

Create a dashboard

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
