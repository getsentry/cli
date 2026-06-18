---
title: "dashboard"
description: "Dashboard commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1112/commands/dashboard/"
---

# dashboard

Manage Sentry dashboards

## Commands

[Section titled “Commands”](#commands)

### `sentry dashboard list <org/title-filter...>`

[Section titled “sentry dashboard list <org/title-filter...>”](#sentry-dashboard-list-orgtitle-filter)

List dashboards

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/title-filter...>` | [<org/project>] [<name-glob>] |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `-n, --limit <limit>` | Maximum number of dashboards to list (default: "25") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry dashboard view <org/project/dashboard...>`

[Section titled “sentry dashboard view <org/project/dashboard...>”](#sentry-dashboard-view-orgprojectdashboard)

View a dashboard

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/dashboard...>` | [<org/project>] <dashboard-id-or-title> |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-r, --refresh <refresh>` | Auto-refresh interval in seconds (default: 60, min: 10) |
| `-t, --period <period>` | Time range: "7d", "2026-05-01..2026-06-01", ">=2026-05-01" |

### `sentry dashboard create <org/project/title...>`

[Section titled “sentry dashboard create <org/project/title...>”](#sentry-dashboard-create-orgprojecttitle)

Create a dashboard

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/title...>` | [<org/project>] <title> |

### `sentry dashboard widget add <org/project/dashboard/title...>`

[Section titled “sentry dashboard widget add <org/project/dashboard/title...>”](#sentry-dashboard-widget-add-orgprojectdashboardtitle)

Add a widget to a dashboard

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/dashboard/title...>` | [<org/project>] <dashboard> <title> |

**Options:**

| Option | Description |
| --- | --- |
| `-d, --display <display>` | Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table) |
| `--dataset <dataset>` | Widget dataset (default: spans). Accepts canonical names and API synonyms: spans, error-events/errors, transaction-like/transactions, tracemetrics/metrics, logs, issue, discover |
| `-q, --query <query>...` | Aggregate expression (e.g. count, p95:span.duration) |
| `-w, --where <where>` | Search conditions filter (e.g. is:unresolved) |
| `-g, --group-by <group-by>...` | Group-by column (repeatable) |
| `-s, --sort <sort>` | Order by (prefix - for desc, e.g. -count) |
| `-n, --limit <limit>` | Result limit |
| `-x, --col <col>` | Grid column position (0-based, 0–5) |
| `-y, --row <row>` | Grid row position (0-based) |
| `--width <width>` | Widget width in grid columns (1–6) |
| `--height <height>` | Widget height in grid rows (min 1) |
| `-l, --layout <layout>` | Layout mode: sequential (append in order) or dense (fill gaps) (default: "sequential") |

### `sentry dashboard widget edit <org/project/dashboard...>`

[Section titled “sentry dashboard widget edit <org/project/dashboard...>”](#sentry-dashboard-widget-edit-orgprojectdashboard)

Edit a widget in a dashboard

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/dashboard...>` | [<org/project>] <dashboard-id-or-title> |

**Options:**

| Option | Description |
| --- | --- |
| `-i, --index <index>` | Widget index (0-based) |
| `-t, --title <title>` | Widget title to match |
| `--new-title <new-title>` | New widget title |
| `-d, --display <display>` | Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table) |
| `--dataset <dataset>` | Widget dataset (default: spans). Accepts canonical names and API synonyms: spans, error-events/errors, transaction-like/transactions, tracemetrics/metrics, logs, issue, discover |
| `-q, --query <query>...` | Aggregate expression (e.g. count, p95:span.duration) |
| `-w, --where <where>` | Search conditions filter (e.g. is:unresolved) |
| `-g, --group-by <group-by>...` | Group-by column (repeatable) |
| `-s, --sort <sort>` | Order by (prefix - for desc, e.g. -count) |
| `-n, --limit <limit>` | Result limit |
| `-x, --col <col>` | Grid column position (0-based, 0–5) |
| `-y, --row <row>` | Grid row position (0-based) |
| `--width <width>` | Widget width in grid columns (1–6) |
| `--height <height>` | Widget height in grid rows (min 1) |

### `sentry dashboard widget delete <org/project/dashboard...>`

[Section titled “sentry dashboard widget delete <org/project/dashboard...>”](#sentry-dashboard-widget-delete-orgprojectdashboard)

Delete a widget from a dashboard

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/dashboard...>` | [<org/project>] <dashboard-id-or-title> |

**Options:**

| Option | Description |
| --- | --- |
| `-i, --index <index>` | Widget index (0-based) |
| `-t, --title <title>` | Widget title to match |
| `-y, --yes` | Skip confirmation prompt |
| `-f, --force` | Force the operation without confirmation |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry dashboard revisions <org/dashboard...>`

[Section titled “sentry dashboard revisions <org/dashboard...>”](#sentry-dashboard-revisions-orgdashboard)

List dashboard revisions

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/dashboard...>` | [<org/project>] <dashboard-id-or-title> |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Maximum number of revisions to list (default: "25") |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry dashboard restore <org/dashboard...>`

[Section titled “sentry dashboard restore <org/dashboard...>”](#sentry-dashboard-restore-orgdashboard)

Restore a dashboard revision

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/dashboard...>` | [<org/project>] <dashboard-id-or-title> |

**Options:**

| Option | Description |
| --- | --- |
| `-r, --revision <revision>` | Revision ID to restore |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### List dashboards

[Section titled “List dashboards”](#list-dashboards)
Terminal window

```
# List all dashboardssentry dashboard list
# Filter by name patternsentry dashboard list "Backend*"
# Open dashboard list in browsersentry dashboard list -w
```


```
ID      TITLE                   WIDGETS  CREATED12345   General                 4        2024-01-1512346   Frontend Performance    6        2024-02-2012347   Backend Errors          3        2024-03-10
```


### View a dashboard

[Section titled “View a dashboard”](#view-a-dashboard)
Terminal window

```
# View by titlesentry dashboard view 'Frontend Performance'
# View by IDsentry dashboard view 12345
# Auto-refresh every 30 secondssentry dashboard view "Backend Performance" --refresh 30
# Open in browsersentry dashboard view 12345 -w
```


```
Dashboard: Frontend Performance (ID: 12345)URL: https://my-org.sentry.io/dashboard/12345/
Widgets:  #0  Error Count          big_number   count()  #1  Errors Over Time     line         count()  #2  Errors by Browser    bar          count() group by browser.name  #3  Top Endpoints        table        count(), p95(span.duration) group by transaction
```


### Create a dashboard

[Section titled “Create a dashboard”](#create-a-dashboard)
Terminal window

```
sentry dashboard create 'Frontend Performance'
```


```
Created dashboard: Frontend Performance (ID: 12348)URL: https://my-org.sentry.io/dashboard/12348/
```


### Add widgets

[Section titled “Add widgets”](#add-widgets)
Terminal window

```
# Simple counter widgetsentry dashboard widget add 'My Dashboard' "Error Count" \  --display big_number --query count
# Line chart with group-bysentry dashboard widget add 'My Dashboard' "Errors by Browser" \  --display line --query count --group-by browser.name
# Table with multiple aggregates, sorted descendingsentry dashboard widget add 'My Dashboard' "Top Endpoints" \  --display table \  --query count --query p95:span.duration \  --group-by transaction \  --sort -count --limit 10
# With search filtersentry dashboard widget add 'My Dashboard' "Slow Requests" \  --display bar --query p95:span.duration \  --where "span.op:http.client" \  --group-by span.description
```


### Edit widgets

[Section titled “Edit widgets”](#edit-widgets)
Terminal window

```
# Change display typesentry dashboard widget edit 12345 --title 'Error Count' --display bar
# Rename a widgetsentry dashboard widget edit 'My Dashboard' --index 0 --new-title 'Total Errors'
# Change the querysentry dashboard widget edit 12345 --title 'Error Rate' --query p95:span.duration
```


### Delete widgets

[Section titled “Delete widgets”](#delete-widgets)
Terminal window

```
# Delete by titlesentry dashboard widget delete 'My Dashboard' --title 'Error Count'
# Delete by indexsentry dashboard widget delete 12345 --index 2
```


### View revision history

[Section titled “View revision history”](#view-revision-history)
Terminal window

```
# List revisions by dashboard titlesentry dashboard revisions 'Frontend Performance'
# List revisions by dashboard IDsentry dashboard revisions 12345
# With explicit orgsentry dashboard revisions my-org 12345
```


### Restore a previous revision

[Section titled “Restore a previous revision”](#restore-a-previous-revision)
Terminal window

```
# Restore by dashboard title and revision numbersentry dashboard restore 'Frontend Performance' --revision 3
# Restore by dashboard IDsentry dashboard restore 12345 --revision 1
# With explicit orgsentry dashboard restore my-org 12345 --revision 1
```


Tip

Use `sentry dashboard revisions` to find the revision number before restoring.

## Query Shorthand

[Section titled “Query Shorthand”](#query-shorthand)

The `--query` flag supports shorthand for aggregate functions:

| Input | Expands to |
| --- | --- |
| `count` | `count()` |
| `p95:span.duration` | `p95(span.duration)` |
| `avg:span.duration` | `avg(span.duration)` |
| `count()` | `count()` (passthrough) |

## Sort Shorthand

[Section titled “Sort Shorthand”](#sort-shorthand)

| Input | Meaning |
| --- | --- |
| `count` | Sort by `count()` ascending |
| `-count` | Sort by `count()` descending |
