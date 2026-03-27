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
| `<org/title-filter...>` | [&lt;org/project&gt;] [&lt;name-glob&gt;] |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `-n, --limit <limit>` | Maximum number of dashboards to list (default: "30") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry dashboard view <org/project/dashboard...>`

View a dashboard

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project/dashboard...>` | [&lt;org/project&gt;] &lt;dashboard-id-or-title&gt; |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-r, --refresh <refresh>` | Auto-refresh interval in seconds (default: 60, min: 10) |
| `-t, --period <period>` | Time period override (e.g., "24h", "7d", "14d") |

### `sentry dashboard create <org/project/title...>`

Create a dashboard

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project/title...>` | [&lt;org/project&gt;] &lt;title&gt; |

### `sentry dashboard widget add <org/project/dashboard/title...>`

Add a widget to a dashboard

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project/dashboard/title...>` | [&lt;org/project&gt;] &lt;dashboard&gt; &lt;title&gt; |

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

### `sentry dashboard widget edit <org/project/dashboard...>`

Edit a widget in a dashboard

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project/dashboard...>` | [&lt;org/project&gt;] &lt;dashboard-id-or-title&gt; |

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

### `sentry dashboard widget delete <org/project/dashboard...>`

Delete a widget from a dashboard

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project/dashboard...>` | [&lt;org/project&gt;] &lt;dashboard-id-or-title&gt; |

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

# Filter by name pattern
sentry dashboard list "Backend*"

# Open dashboard list in browser
sentry dashboard list -w
```

```
ID      TITLE                   WIDGETS  CREATED
12345   General                 4        2024-01-15
12346   Frontend Performance    6        2024-02-20
12347   Backend Errors          3        2024-03-10
```

### View a dashboard

```bash
# View by title
sentry dashboard view 'Frontend Performance'

# View by ID
sentry dashboard view 12345

# Auto-refresh every 30 seconds
sentry dashboard view "Backend Performance" --refresh 30

# Open in browser
sentry dashboard view 12345 -w
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

### Create a dashboard

```bash
sentry dashboard create 'Frontend Performance'
```

```
Created dashboard: Frontend Performance (ID: 12348)
URL: https://my-org.sentry.io/dashboard/12348/
```

### Add widgets

```bash
# Simple counter widget
sentry dashboard widget add 'My Dashboard' "Error Count" \
  --display big_number --query count

# Line chart with group-by
sentry dashboard widget add 'My Dashboard' "Errors by Browser" \
  --display line --query count --group-by browser.name

# Table with multiple aggregates, sorted descending
sentry dashboard widget add 'My Dashboard' "Top Endpoints" \
  --display table \
  --query count --query p95:span.duration \
  --group-by transaction \
  --sort -count --limit 10

# With search filter
sentry dashboard widget add 'My Dashboard' "Slow Requests" \
  --display bar --query p95:span.duration \
  --where "span.op:http.client" \
  --group-by span.description
```

### Edit widgets

```bash
# Change display type
sentry dashboard widget edit 12345 --title 'Error Count' --display bar

# Rename a widget
sentry dashboard widget edit 'My Dashboard' --index 0 --new-title 'Total Errors'

# Change the query
sentry dashboard widget edit 12345 --title 'Error Rate' --query p95:span.duration
```

### Delete widgets

```bash
# Delete by title
sentry dashboard widget delete 'My Dashboard' --title 'Error Count'

# Delete by index
sentry dashboard widget delete 12345 --index 2
```

## Query Shorthand

The `--query` flag supports shorthand for aggregate functions:

| Input | Expands to |
|-------|-----------|
| `count` | `count()` |
| `p95:span.duration` | `p95(span.duration)` |
| `avg:span.duration` | `avg(span.duration)` |
| `count()` | `count()` (passthrough) |

## Sort Shorthand

| Input | Meaning |
|-------|---------|
| `count` | Sort by `count()` ascending |
| `-count` | Sort by `count()` descending |
