---
title: "alert"
description: "Alert commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1172/commands/alert/"
---

# alert

Manage Sentry alert rules

## Commands

[Section titled “Commands”](#commands)

### `sentry alert issues list <org/project>`

[Section titled “sentry alert issues list <org/project>”](#sentry-alert-issues-list-orgproject)

List issue alert rules

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/ (all projects), <org>/<project>, or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `-n, --limit <limit>` | Maximum number of issue alert rules to list (default: "25") |
| `-q, --query <query>` | Filter rules by name |
| `-c, --cursor <cursor>` | Pagination cursor (use "next" for next page, "prev" for previous) |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry alert issues view <org/project/rule-id-or-name>`

[Section titled “sentry alert issues view <org/project/rule-id-or-name>”](#sentry-alert-issues-view-orgprojectrule-id-or-name)

View an issue alert rule

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/rule-id-or-name>` | Issue alert rule ID or name |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open issue alert rules page in browser |

### `sentry alert issues create <target>`

[Section titled “sentry alert issues create <target>”](#sentry-alert-issues-create-target)

Create an issue alert rule

**Arguments:**

| Argument | Description |
| --- | --- |
| `<target>` | <org>/<project>, auto-detected project, or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `--name <name>` | Rule name |
| `-c, --condition <condition>...` | Condition object JSON (repeatable, or pass one JSON array) |
| `-a, --action <action>...` | Action object JSON (repeatable, or pass one JSON array) |
| `-m, --action-match <action-match>` | Condition/action match mode: all or any |
| `--frequency <frequency>` | Frequency in minutes (default: 30) |
| `--environment <environment>` | Environment filter |
| `--filter <filter>...` | Filter object JSON (repeatable, or pass one JSON array) |
| `--filter-match <filter-match>` | Filter match mode: all or any |
| `--owner <owner>` | Owner (team:user style value accepted by Sentry API) |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry alert issues delete <org/project/rule-id-or-name>`

[Section titled “sentry alert issues delete <org/project/rule-id-or-name>”](#sentry-alert-issues-delete-orgprojectrule-id-or-name)

Delete an issue alert rule

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/rule-id-or-name>` | Rule id or name (same as view) |

**Options:**

| Option | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation prompt |
| `-f, --force` | Force the operation without confirmation |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry alert issues edit <org/project/rule-id-or-name>`

[Section titled “sentry alert issues edit <org/project/rule-id-or-name>”](#sentry-alert-issues-edit-orgprojectrule-id-or-name)

Edit an issue alert rule

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/rule-id-or-name>` | Rule id or name (same as view) |

**Options:**

| Option | Description |
| --- | --- |
| `--name <name>` | New rule name |
| `--status <status>` | Rule status: active or disabled |
| `-c, --condition <condition>...` | Condition object JSON (repeatable, or pass one JSON array) |
| `-a, --action <action>...` | Action object JSON (repeatable, or pass one JSON array) |
| `-m, --action-match <action-match>` | Condition/action match mode: all or any |
| `--frequency <frequency>` | Frequency in minutes |
| `--environment <environment>` | Environment value (pass empty string to clear) |
| `--filter <filter>...` | Filter object JSON (repeatable, or pass one JSON array) |
| `--filter-match <filter-match>` | Filter match mode: all or any |
| `--owner <owner>` | Owner value (pass empty string to clear) |

### `sentry alert metrics list <target>`

[Section titled “sentry alert metrics list <target>”](#sentry-alert-metrics-list-target)

List metric alert rules

**Arguments:**

| Argument | Description |
| --- | --- |
| `<target>` | <org>/, <org>/<project> (project ignored), or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `-n, --limit <limit>` | Maximum number of metric alert rules to list (default: "25") |
| `-q, --query <query>` | Filter rules by name |
| `-c, --cursor <cursor>` | Pagination cursor (use "next" for next page, "prev" for previous) |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry alert metrics view <org/rule-id-or-name>`

[Section titled “sentry alert metrics view <org/rule-id-or-name>”](#sentry-alert-metrics-view-orgrule-id-or-name)

View a metric alert rule

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/rule-id-or-name>` | Metric alert rule ID or name |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open metric alert rules page in browser |

### `sentry alert metrics create <org>`

[Section titled “sentry alert metrics create <org>”](#sentry-alert-metrics-create-org)

Create a metric alert rule

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org>` | Target organization |

**Options:**

| Option | Description |
| --- | --- |
| `--name <name>` | Rule name |
| `--query <query>` | Metric query filter string |
| `--aggregate <aggregate>` | Aggregate expression (for example count(), p95(transaction.duration)) |
| `--dataset <dataset>` | Dataset (errors, transactions, sessions, events, spans, metrics) |
| `--time-window <time-window>` | Evaluation window in minutes |
| `-t, --trigger <trigger>...` | Trigger object JSON (repeatable, or pass one JSON array) |
| `-p, --project <project>...` | Project slug filter (repeatable or comma-separated) |
| `--environment <environment>` | Environment filter |
| `--owner <owner>` | Owner value accepted by Sentry API |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry alert metrics delete <org/rule-id-or-name>`

[Section titled “sentry alert metrics delete <org/rule-id-or-name>”](#sentry-alert-metrics-delete-orgrule-id-or-name)

Delete a metric alert rule

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/rule-id-or-name>` | Rule id or name (same as view) |

**Options:**

| Option | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation prompt |
| `-f, --force` | Force the operation without confirmation |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry alert metrics edit <org/rule-id-or-name>`

[Section titled “sentry alert metrics edit <org/rule-id-or-name>”](#sentry-alert-metrics-edit-orgrule-id-or-name)

Edit a metric alert rule

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/rule-id-or-name>` | Rule id or name (same as view) |

**Options:**

| Option | Description |
| --- | --- |
| `--name <name>` | New rule name |
| `--status <status>` | active or disabled |
| `--query <query>` | Metric query filter |
| `--aggregate <aggregate>` | Aggregate expression |
| `--dataset <dataset>` | Dataset (errors, transactions, sessions, events, spans, metrics) |
| `--time-window <time-window>` | Evaluation window in minutes |
| `-t, --trigger <trigger>...` | Trigger object JSON (repeatable, or pass one JSON array) |
| `-p, --project <project>...` | Project slug filter (repeatable or comma-separated) |
| `--environment <environment>` | Environment value (pass empty string to clear) |
| `--owner <owner>` | Owner value (pass empty string to clear) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### Create an issue alert rule

[Section titled “Create an issue alert rule”](#create-an-issue-alert-rule)
Terminal window

```
# Create an issue alert rule with inline JSON condition/actionsentry alert issues create my-org/my-project \  --name "Error Spike" \  --condition '{"id":"sentry.rules.conditions.first_seen_event.FirstSeenEventCondition"}' \  --action '{"id":"sentry.mail.actions.NotifyEmailAction","targetType":"Team","targetIdentifier":1}' \  --action-match any
```


### List issue alert rules

[Section titled “List issue alert rules”](#list-issue-alert-rules)
Terminal window

```
# List issue alert rules for a projectsentry alert issues list my-org/my-project
# Filter rules by namesentry alert issues list my-org/my-project --query "spike"
```


### View an issue alert rule

[Section titled “View an issue alert rule”](#view-an-issue-alert-rule)
Terminal window

```
# View by IDsentry alert issues view my-org/my-project/12345
# View by namesentry alert issues view my-org/my-project/"Error Spike"
```


### Edit an issue alert rule

[Section titled “Edit an issue alert rule”](#edit-an-issue-alert-rule)
Terminal window

```
# Edit issue alert name/statussentry alert issues edit my-org/my-project/12345 --name "Prod Error Spike" --status disabled
```


### Delete an issue alert rule

[Section titled “Delete an issue alert rule”](#delete-an-issue-alert-rule)
Terminal window

```
# Delete with previewsentry alert issues delete my-org/my-project/12345 --dry-run
```


### Create a metric alert rule

[Section titled “Create a metric alert rule”](#create-a-metric-alert-rule)
Terminal window

```
# Create an organization metric alert rulesentry alert metrics create my-org \  --name "P95 Latency" \  --query "environment:prod" \  --aggregate "p95(transaction.duration)" \  --dataset transactions \  --time-window 5 \  --trigger '{"alertThreshold":500,"actions":[{"id":"sentry.mail.actions.NotifyEmailAction","targetType":"Team","targetIdentifier":1}]}'
```


### List metric alert rules

[Section titled “List metric alert rules”](#list-metric-alert-rules)
Terminal window

```
# List metric alert rules for an organizationsentry alert metrics list my-org/
```


### View a metric alert rule

[Section titled “View a metric alert rule”](#view-a-metric-alert-rule)
Terminal window

```
# View by IDsentry alert metrics view my-org/67890
# View by namesentry alert metrics view my-org/"P95 latency alert"
```


### Edit a metric alert rule

[Section titled “Edit a metric alert rule”](#edit-a-metric-alert-rule)
Terminal window

```
# Edit metric alert query/windowsentry alert metrics edit my-org/67890 --query "environment:prod event.type:error" --time-window 15
```


### Delete a metric alert rule

[Section titled “Delete a metric alert rule”](#delete-a-metric-alert-rule)
Terminal window

```
# Delete without promptsentry alert metrics delete my-org/67890 --yes
```
