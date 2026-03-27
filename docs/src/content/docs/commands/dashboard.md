---
title: dashboard
description: Dashboard commands for the Sentry CLI
---

Manage Sentry dashboards

## Commands

### `sentry dashboard list <org/title-filter...>`

List dashboards

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/title-filter...>` | [&lt;org/project&gt;] [&lt;name-glob&gt;] (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `-n, --limit <limit>` | Maximum number of dashboards to list (default: "30") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry dashboard view <args...>`

View a dashboard

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<args...>` | [&lt;org/project&gt;] &lt;dashboard-id-or-title&gt; (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-r, --refresh <refresh>` | Auto-refresh interval in seconds (default: 60, min: 10) |
| `-t, --period <period>` | Time period override (e.g., "24h", "7d", "14d") |

### `sentry dashboard create <args...>`

Create a dashboard

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<args...>` | [&lt;org/project&gt;] &lt;title&gt; (optional) |

### `sentry dashboard widget add <args...>`

Add a widget to a dashboard

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<args...>` | [&lt;org/project&gt;] &lt;dashboard&gt; &lt;title&gt; (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-d, --display <display>` | Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table) |
| `--dataset <dataset>` | Widget dataset (default: spans) |
| `-q, --query <query>...` | Aggregate expression (e.g. count, p95:span.duration) |
| `-w, --where <where>` | Search conditions filter (e.g. is:unresolved) |
| `-g, --group-by <group-by>...` | Group-by column (repeatable) |
| `-s, --sort <sort>` | Order by (prefix - for desc, e.g. -count) |
| `-n, --limit <limit>` | Result limit |

### `sentry dashboard widget edit <args...>`

Edit a widget in a dashboard

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<args...>` | [&lt;org/project&gt;] &lt;dashboard-id-or-title&gt; (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-i, --index <index>` | Widget index (0-based) |
| `-t, --title <title>` | Widget title to match |
| `--new-title <new-title>` | New widget title |
| `-d, --display <display>` | Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table) |
| `--dataset <dataset>` | Widget dataset (default: spans) |
| `-q, --query <query>...` | Aggregate expression (e.g. count, p95:span.duration) |
| `-w, --where <where>` | Search conditions filter (e.g. is:unresolved) |
| `-g, --group-by <group-by>...` | Group-by column (repeatable) |
| `-s, --sort <sort>` | Order by (prefix - for desc, e.g. -count) |
| `-n, --limit <limit>` | Result limit |

### `sentry dashboard widget delete <args...>`

Delete a widget from a dashboard

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<args...>` | [&lt;org/project&gt;] &lt;dashboard-id-or-title&gt; (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-i, --index <index>` | Widget index (0-based) |
| `-t, --title <title>` | Widget title to match |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

### List dashboards

```bash
# List all dashboards
sentry dashboard list

# Open in browser
sentry dashboard list -w

# Filter by name
sentry dashboard list "Backend*"
```

### View a dashboard

```bash
# View with live data
sentry dashboard view "Backend Performance"

# Auto-refresh every 30 seconds
sentry dashboard view "Backend Performance" --refresh 30

# Open in browser
sentry dashboard view "Backend Performance" -w
```

### Manage widgets

```bash
# Add a widget
sentry dashboard widget add "My Dashboard" -t "Error Count" -d line -q "count()"

# Edit a widget
sentry dashboard widget edit "My Dashboard" -i 0 --new-title "Updated Title"

# Delete a widget
sentry dashboard widget delete "My Dashboard" -i 0
```
