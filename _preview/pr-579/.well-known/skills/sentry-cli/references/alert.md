---
name: sentry-cli-alert
version: 0.29.0-dev.0
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

**Examples:**

```bash
# List issue alert rules for a project
sentry alert issues list my-org/my-project

# Filter rules by name
sentry alert issues list my-org/my-project --query "spike"
```

### `sentry alert issues view <org/project/rule-id-or-name>`

View an issue alert rule

**Flags:**
- `-w, --web - Open issue alert rules page in browser`

**Examples:**

```bash
# View by ID
sentry alert issues view my-org/my-project/12345

# View by name
sentry alert issues view my-org/my-project/"Error Spike"
```

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

### `sentry alert metrics list <org/project>`

List metric alert rules

**Flags:**
- `-w, --web - Open in browser`
- `-n, --limit <value> - Maximum number of metric alert rules to list - (default: "25")`
- `-q, --query <value> - Filter rules by name`
- `-c, --cursor <value> - Pagination cursor (use "next" for next page, "prev" for previous)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# List metric alert rules for an organization
sentry alert metrics list my-org/
```

### `sentry alert metrics view <org/rule-id-or-name>`

View a metric alert rule

**Flags:**
- `-w, --web - Open metric alert rules page in browser`

**Examples:**

```bash
# View by ID
sentry alert metrics view my-org/67890

# View by name
sentry alert metrics view my-org/"P95 latency alert"
```

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

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
