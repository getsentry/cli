---
name: sentry-cli-dashboards
version: 0.18.0-dev.0
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

**Flags:**
- `--widget-title <value> - Inline widget title`
- `--widget-display <value> - Inline widget display type (line, bar, table, big_number, ...)`
- `--widget-dataset <value> - Inline widget dataset (default: spans)`
- `--widget-query <value>... - Inline widget aggregate (e.g. count, p95:span.duration)`
- `--widget-where <value> - Inline widget search conditions filter`
- `--widget-group-by <value>... - Inline widget group-by column (repeatable)`
- `--widget-sort <value> - Inline widget order by (prefix - for desc)`
- `--widget-limit <value> - Inline widget result limit`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
