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

### `sentry alert metrics list <org/project>`

List metric alert rules

**Flags:**
- `-w, --web - Open in browser`
- `-n, --limit <value> - Maximum number of metric alert rules to list - (default: "25")`
- `-q, --query <value> - Filter rules by name`
- `-c, --cursor <value> - Pagination cursor (use "next" for next page, "prev" for previous)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
