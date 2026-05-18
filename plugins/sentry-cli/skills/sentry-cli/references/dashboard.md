---
name: sentry-cli-dashboard
version: 0.35.0-dev.0
description: Manage Sentry dashboards
requires:
  bins: ["sentry"]
  auth: true
---

# Dashboard Commands

Manage Sentry dashboards

### `sentry dashboard list <org/title-filter...>`

List dashboards

**Flags:**
- `-w, --web - Open in browser`
- `-n, --limit <value> - Maximum number of dashboards to list - (default: "25")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

### `sentry dashboard view <org/project/dashboard...>`

View a dashboard

**Flags:**
- `-w, --web - Open in browser`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-r, --refresh <value> - Auto-refresh interval in seconds (default: 60, min: 10)`
- `-t, --period <value> - Time range: "7d", "2026-04-01..2026-05-01", ">=2026-04-01"`

### `sentry dashboard create <org/project/title...>`

Create a dashboard

### `sentry dashboard widget add <org/project/dashboard/title...>`

Add a widget to a dashboard

**Flags:**
- `-d, --display <value> - Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table)`
- `--dataset <value> - Widget dataset (default: spans). Accepts canonical names and API synonyms: spans, error-events/errors, transaction-like/transactions, tracemetrics/metrics, logs, issue, discover`
- `-q, --query <value>... - Aggregate expression (e.g. count, p95:span.duration)`
- `-w, --where <value> - Search conditions filter (e.g. is:unresolved)`
- `-g, --group-by <value>... - Group-by column (repeatable)`
- `-s, --sort <value> - Order by (prefix - for desc, e.g. -count)`
- `-n, --limit <value> - Result limit`
- `-x, --col <value> - Grid column position (0-based, 0–5)`
- `-y, --row <value> - Grid row position (0-based)`
- `--width <value> - Widget width in grid columns (1–6)`
- `--height <value> - Widget height in grid rows (min 1)`
- `-l, --layout <value> - Layout mode: sequential (append in order) or dense (fill gaps) - (default: "sequential")`

### `sentry dashboard widget edit <org/project/dashboard...>`

Edit a widget in a dashboard

**Flags:**
- `-i, --index <value> - Widget index (0-based)`
- `-t, --title <value> - Widget title to match`
- `--new-title <value> - New widget title`
- `-d, --display <value> - Display type (big_number, line, area, bar, table, stacked_area, top_n, text, categorical_bar, details, wheel, rage_and_dead_clicks, server_tree, agents_traces_table)`
- `--dataset <value> - Widget dataset (default: spans). Accepts canonical names and API synonyms: spans, error-events/errors, transaction-like/transactions, tracemetrics/metrics, logs, issue, discover`
- `-q, --query <value>... - Aggregate expression (e.g. count, p95:span.duration)`
- `-w, --where <value> - Search conditions filter (e.g. is:unresolved)`
- `-g, --group-by <value>... - Group-by column (repeatable)`
- `-s, --sort <value> - Order by (prefix - for desc, e.g. -count)`
- `-n, --limit <value> - Result limit`
- `-x, --col <value> - Grid column position (0-based, 0–5)`
- `-y, --row <value> - Grid row position (0-based)`
- `--width <value> - Widget width in grid columns (1–6)`
- `--height <value> - Widget height in grid rows (min 1)`

### `sentry dashboard widget delete <org/project/dashboard...>`

Delete a widget from a dashboard

**Flags:**
- `-i, --index <value> - Widget index (0-based)`
- `-t, --title <value> - Widget title to match`
- `-y, --yes - Skip confirmation prompt`
- `-f, --force - Force the operation without confirmation`
- `-n, --dry-run - Show what would happen without making changes`

### `sentry dashboard revisions <org/dashboard...>`

List dashboard revisions

**Flags:**
- `-n, --limit <value> - Maximum number of revisions to list - (default: "25")`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

### `sentry dashboard restore <org/dashboard...>`

Restore a dashboard revision

**Flags:**
- `-r, --revision <value> - Revision ID to restore`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
