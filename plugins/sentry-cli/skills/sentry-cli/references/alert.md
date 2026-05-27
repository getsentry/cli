---
name: sentry-cli-alert
version: 0.35.0-dev.0
description: Manage Sentry alert rules
requires:
  bins: ["sentry"]
  auth: true
---

# Alert Commands

Manage Sentry alert rules

### `sentry alert issues list <org/project>`

List issue alert rules

**Flags:**
- `-w, --web - Open in browser`
- `-n, --limit <value> - Maximum number of issue alert rules to list - (default: "25")`
- `-q, --query <value> - Filter rules by name`
- `-c, --cursor <value> - Pagination cursor (use "next" for next page, "prev" for previous)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry alert issues view <org/project/rule-id-or-name>`

View an issue alert rule

**Flags:**
- `-w, --web - Open issue alert rules page in browser`

### `sentry alert issues create <org/project>`

Create an issue alert rule

**Flags:**
- `--name <value> - Rule name`
- `-c, --condition <value>... - Condition object JSON (repeatable, or pass one JSON array)`
- `-a, --action <value>... - Action object JSON (repeatable, or pass one JSON array)`
- `-m, --action-match <value> - Condition/action match mode: all or any`
- `--frequency <value> - Frequency in minutes (default: 30) - (default: 30)`
- `--environment <value> - Environment filter`
- `--filter <value>... - Filter object JSON (repeatable, or pass one JSON array)`
- `--filter-match <value> - Filter match mode: all or any`
- `--owner <value> - Owner (team:user style value accepted by Sentry API)`
- `-n, --dry-run - Show what would happen without making changes`

### `sentry alert issues delete <org/project/rule-id-or-name>`

Delete an issue alert rule

**Flags:**
- `-y, --yes - Skip confirmation prompt`
- `-f, --force - Force the operation without confirmation`
- `-n, --dry-run - Show what would happen without making changes`

### `sentry alert issues edit <org/project/rule-id-or-name>`

Edit an issue alert rule

**Flags:**
- `--name <value> - New rule name`
- `--status <value> - Rule status: active or disabled`
- `-c, --condition <value>... - Condition object JSON (repeatable, or pass one JSON array)`
- `-a, --action <value>... - Action object JSON (repeatable, or pass one JSON array)`
- `-m, --action-match <value> - Condition/action match mode: all or any`
- `--frequency <value> - Frequency in minutes`
- `--environment <value> - Environment value (pass empty string to clear)`
- `--filter <value>... - Filter object JSON (repeatable, or pass one JSON array)`
- `--filter-match <value> - Filter match mode: all or any`
- `--owner <value> - Owner value (pass empty string to clear)`

### `sentry alert metrics list <org/project>`

List metric alert rules

**Flags:**
- `-w, --web - Open in browser`
- `-n, --limit <value> - Maximum number of metric alert rules to list - (default: "25")`
- `-q, --query <value> - Filter rules by name`
- `-c, --cursor <value> - Pagination cursor (use "next" for next page, "prev" for previous)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry alert metrics view <org/rule-id-or-name>`

View a metric alert rule

**Flags:**
- `-w, --web - Open metric alert rules page in browser`

### `sentry alert metrics create <org>`

Create a metric alert rule

**Flags:**
- `--name <value> - Rule name`
- `--query <value> - Metric query filter string`
- `--aggregate <value> - Aggregate expression (for example count(), p95(transaction.duration))`
- `--dataset <value> - Dataset (errors, transactions, sessions, events, spans, metrics)`
- `--time-window <value> - Evaluation window in minutes`
- `-t, --trigger <value>... - Trigger object JSON (repeatable, or pass one JSON array)`
- `-p, --project <value>... - Project slug filter (repeatable or comma-separated)`
- `--environment <value> - Environment filter`
- `--owner <value> - Owner value accepted by Sentry API`
- `-n, --dry-run - Show what would happen without making changes`

### `sentry alert metrics delete <org/rule-id-or-name>`

Delete a metric alert rule

**Flags:**
- `-y, --yes - Skip confirmation prompt`
- `-f, --force - Force the operation without confirmation`
- `-n, --dry-run - Show what would happen without making changes`

### `sentry alert metrics edit <org/rule-id-or-name>`

Edit a metric alert rule

**Flags:**
- `--name <value> - New rule name`
- `--status <value> - active or disabled`
- `--query <value> - Metric query filter`
- `--aggregate <value> - Aggregate expression`
- `--dataset <value> - Dataset (errors, transactions, sessions, events, spans, metrics)`
- `--time-window <value> - Evaluation window in minutes`
- `-t, --trigger <value>... - Trigger object JSON (repeatable, or pass one JSON array)`
- `-p, --project <value>... - Project slug filter (repeatable or comma-separated)`
- `--environment <value> - Environment value (pass empty string to clear)`
- `--owner <value> - Owner value (pass empty string to clear)`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
