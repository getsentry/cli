---
title: dashboard
description: Dashboard commands for the Sentry CLI
---

View and manage dashboards in your Sentry organization.

## Commands

### `sentry dashboard list`

List dashboards in an organization.

```bash
# Auto-detect org from config
sentry dashboard list

# Explicit org
sentry dashboard list my-org/

# Explicit org and project
sentry dashboard list my-org/my-project
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>/` | Organization slug (optional — auto-detected from config if omitted) |
| `<org>/<project>` | Organization and project to scope the dashboard list |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `-n, --limit <n>` | Maximum number of dashboards to list (default: 30) |
| `-f, --fresh` | Bypass cache and fetch fresh data |
| `--json` | Output as JSON |

**Examples:**

```bash
sentry dashboard list
```

```
ID      TITLE                   WIDGETS  CREATED
12345   General                 4        2024-01-15
12346   Frontend Performance    6        2024-02-20
12347   Backend Errors          3        2024-03-10
```

**Open dashboard list in browser:**

```bash
sentry dashboard list -w
```

### `sentry dashboard view`

View details of a specific dashboard, including its widgets.

```bash
# By numeric ID
sentry dashboard view <id>

# By title
sentry dashboard view '<title>'

# With explicit org
sentry dashboard view <org>/ <id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<id>` or `<title>` | Dashboard ID (numeric) or title (case-insensitive) |
| `<org>/` | Organization slug (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache and fetch fresh data |
| `--json` | Output as JSON |

**Examples:**

```bash
sentry dashboard view 12345
```

```
Dashboard: Frontend Performance (ID: 12345)
URL: https://my-org.sentry.io/dashboard/12345/

Widgets:
  #0  Error Count          big_number   count()
  #1  Errors Over Time     line         count()
  #2  Errors by Browser    bar          count() group by browser.name
  #3  Top Endpoints        table        count(), p95(span.duration) group by transaction
```

**View by title:**

```bash
sentry dashboard view 'Frontend Performance'
```

**Open in browser:**

```bash
sentry dashboard view 12345 -w
```

### `sentry dashboard create`

Create a new dashboard.

```bash
# Auto-detect org
sentry dashboard create '<title>'

# Explicit org
sentry dashboard create <org>/ '<title>'

# Explicit org and project
sentry dashboard create <org>/<project> '<title>'
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<title>` | Dashboard title |
| `<org>/` or `<org>/<project>` | Organization and optional project (auto-detected if omitted) |

**Examples:**

```bash
sentry dashboard create 'Frontend Performance'
```

```
Created dashboard: Frontend Performance (ID: 12348)
URL: https://my-org.sentry.io/dashboard/12348/
```

**Add widgets after creation:**

```bash
sentry dashboard widget add 'Frontend Performance' "Error Count" --display big_number --query count
```

### `sentry dashboard widget add`

Add a widget to an existing dashboard.

```bash
sentry dashboard widget add <dashboard> '<widget-title>' --display <type> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<dashboard>` | Dashboard ID (numeric) or title |
| `<widget-title>` | Title for the new widget |
| `<org>/` | Organization slug (optional, prepend before dashboard) |

**Options:**

| Option | Description |
|--------|-------------|
| `-d, --display <type>` | Display type: `line`, `bar`, `table`, `big_number`, `area`, `top_n` (required) |
| `--dataset <dataset>` | Widget dataset (default: `spans`). Also accepts `discover` |
| `-q, --query <expr>` | Aggregate expression (repeatable for multiple columns) |
| `-w, --where <filter>` | Search conditions filter |
| `-g, --group-by <col>` | Group-by column (repeatable) |
| `-s, --sort <expr>` | Sort order (prefix `-` for descending) |
| `-n, --limit <n>` | Result row limit |
| `--json` | Output as JSON |

**Query shorthand:**

The `--query` flag supports shorthand for aggregate functions:

| Input | Expands to |
|-------|-----------|
| `count` | `count()` |
| `p95:span.duration` | `p95(span.duration)` |
| `avg:span.duration` | `avg(span.duration)` |
| `count()` | `count()` (passthrough) |

**Sort shorthand:**

| Input | Meaning |
|-------|---------|
| `count` | Sort by `count()` ascending |
| `-count` | Sort by `count()` descending |

**Examples:**

```bash
# Simple counter widget
sentry dashboard widget add 'My Dashboard' "Error Count" \
  --display big_number --query count
```

```bash
# Line chart with group-by
sentry dashboard widget add 'My Dashboard' "Errors by Browser" \
  --display line --query count --group-by browser.name
```

```bash
# Table with multiple aggregates, sorted descending
sentry dashboard widget add 'My Dashboard' "Top Endpoints" \
  --display table \
  --query count --query p95:span.duration \
  --group-by transaction \
  --sort -count --limit 10
```

```bash
# With search filter
sentry dashboard widget add 'My Dashboard' "Slow Requests" \
  --display bar --query p95:span.duration \
  --where "span.op:http.client" \
  --group-by span.description
```

### `sentry dashboard widget edit`

Edit an existing widget in a dashboard. Only provided flags are changed — omitted values are preserved.

```bash
# Identify widget by title
sentry dashboard widget edit <dashboard> --title '<widget-title>' [options]

# Identify widget by index (0-based)
sentry dashboard widget edit <dashboard> --index <n> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<dashboard>` | Dashboard ID (numeric) or title |
| `<org>/` | Organization slug (optional, prepend before dashboard) |

**Options:**

| Option | Description |
|--------|-------------|
| `-i, --index <n>` | Widget index (0-based) |
| `-t, --title <title>` | Match widget by title (case-insensitive) |
| `--new-title <title>` | Rename the widget |
| `-d, --display <type>` | Change display type |
| `--dataset <dataset>` | Change widget dataset |
| `-q, --query <expr>` | Replace aggregate expression(s) |
| `-w, --where <filter>` | Replace search conditions |
| `-g, --group-by <col>` | Replace group-by column(s) |
| `-s, --sort <expr>` | Replace sort order |
| `-n, --limit <n>` | Change result limit |
| `--json` | Output as JSON |

**Examples:**

```bash
# Change display type
sentry dashboard widget edit 12345 --title 'Error Count' --display bar
```

```bash
# Rename a widget
sentry dashboard widget edit 'My Dashboard' --index 0 --new-title 'Total Errors'
```

```bash
# Change the query
sentry dashboard widget edit 12345 --title 'Error Rate' --query p95:span.duration
```

### `sentry dashboard widget delete`

Remove a widget from a dashboard.

```bash
# Delete by title
sentry dashboard widget delete <dashboard> --title '<widget-title>'

# Delete by index (0-based)
sentry dashboard widget delete <dashboard> --index <n>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<dashboard>` | Dashboard ID (numeric) or title |
| `<org>/` | Organization slug (optional, prepend before dashboard) |

**Options:**

| Option | Description |
|--------|-------------|
| `-i, --index <n>` | Widget index (0-based) |
| `-t, --title <title>` | Match widget by title (case-insensitive) |
| `--json` | Output as JSON |

**Examples:**

```bash
# Delete by title
sentry dashboard widget delete 'My Dashboard' --title 'Error Count'
```

```bash
# Delete by index
sentry dashboard widget delete 12345 --index 2
```

### `sentry dashboard widget types`

Show available widget display types with default grid sizes, datasets, and aggregate functions.

Sentry dashboards use a 6-column grid. This command helps you understand the available options and how widgets fit into the layout.

```bash
# Human-readable table
sentry dashboard widget types

# Machine-readable JSON (recommended for agents)
sentry dashboard widget types --json
```

Display types are categorized as:

| Category | Types | When to use |
|----------|-------|------------|
| common | `big_number`, `line`, `area`, `bar`, `table` | General-purpose dashboards |
| specialized | `stacked_area`, `top_n`, `categorical_bar`, `text` | Specific use cases |
| internal | `details`, `wheel`, `rage_and_dead_clicks`, `server_tree`, `agents_traces_table` | Sentry-internal, rarely used directly |
