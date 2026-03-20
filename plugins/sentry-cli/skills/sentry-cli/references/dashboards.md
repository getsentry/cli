---
name: sentry-cli-dashboards
version: 0.19.0-dev.0
description: List, view, create, and manage Sentry dashboards and widgets
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

### `sentry dashboard widget add [<org/project>] <dashboard> <title>`

Add a widget to a dashboard

**Flags:**
- `-d, --display <value> - Display type (line, bar, table, big_number, ...)`
- `--dataset <value> - Widget dataset (default: spans)`
- `-q, --query <value>... - Aggregate expression (e.g. count, p95:span.duration)`
- `-w, --where <value> - Search conditions filter`
- `-g, --group-by <value>... - Group-by column (repeatable)`
- `-s, --sort <value> - Order by (prefix - for desc)`
- `-n, --limit <value> - Result limit`

### `sentry dashboard widget edit [<org/project>] <dashboard>`

Edit a widget in a dashboard

**Flags:**
- `--index <value> - Widget index (1-based)`
- `--title <value> - Match widget by title`
- `--new-title <value> - New widget title`
- `-d, --display <value> - Display type`
- `--dataset <value> - Widget dataset`
- `-q, --query <value>... - Aggregate expression`
- `-w, --where <value> - Search conditions filter`
- `-g, --group-by <value>... - Group-by column`
- `-s, --sort <value> - Order by`
- `-n, --limit <value> - Result limit`

### `sentry dashboard widget delete [<org/project>] <dashboard>`

Delete a widget from a dashboard

**Flags:**
- `--index <value> - Widget index (1-based)`
- `--title <value> - Match widget by title`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
