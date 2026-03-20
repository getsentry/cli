---
name: sentry-cli-dashboards
version: 0.19.0
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

**Examples:**

```bash
# Auto-detect org from config
sentry dashboard list

# Explicit org
sentry dashboard list my-org/

# Explicit org and project
sentry dashboard list my-org/my-project

sentry dashboard list

sentry dashboard list -w
```

### `sentry dashboard view <args...>`

View a dashboard

**Flags:**
- `-w, --web - Open in browser`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# By numeric ID
sentry dashboard view <id>

# By title
sentry dashboard view '<title>'

# With explicit org
sentry dashboard view <org>/ <id>

sentry dashboard view 12345

sentry dashboard view 'Frontend Performance'

sentry dashboard view 12345 -w
```

### `sentry dashboard create <args...>`

Create a dashboard

**Examples:**

```bash
# Auto-detect org
sentry dashboard create '<title>'

# Explicit org
sentry dashboard create <org>/ '<title>'

# Explicit org and project
sentry dashboard create <org>/<project> '<title>'

sentry dashboard create 'Frontend Performance'

sentry dashboard widget add 'Frontend Performance' "Error Count" --display big_number --query count
```

### `sentry dashboard widget add <args...>`

Add a widget to a dashboard

**Flags:**
- `-d, --display <value> - Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table)`
- `--dataset <value> - Widget dataset (default: spans)`
- `-q, --query <value>... - Aggregate expression (e.g. count, p95:span.duration)`
- `-w, --where <value> - Search conditions filter (e.g. is:unresolved)`
- `-g, --group-by <value>... - Group-by column (repeatable)`
- `-s, --sort <value> - Order by (prefix - for desc, e.g. -count)`
- `-n, --limit <value> - Result limit`

### `sentry dashboard widget edit <args...>`

Edit a widget in a dashboard

**Flags:**
- `-i, --index <value> - Widget index (0-based)`
- `-t, --title <value> - Widget title to match`
- `--new-title <value> - New widget title`
- `-d, --display <value> - Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table)`
- `--dataset <value> - Widget dataset (default: spans)`
- `-q, --query <value>... - Aggregate expression (e.g. count, p95:span.duration)`
- `-w, --where <value> - Search conditions filter (e.g. is:unresolved)`
- `-g, --group-by <value>... - Group-by column (repeatable)`
- `-s, --sort <value> - Order by (prefix - for desc, e.g. -count)`
- `-n, --limit <value> - Result limit`

### `sentry dashboard widget delete <args...>`

Delete a widget from a dashboard

**Flags:**
- `-i, --index <value> - Widget index (0-based)`
- `-t, --title <value> - Widget title to match`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
