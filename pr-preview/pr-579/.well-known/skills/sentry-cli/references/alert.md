---
name: sentry-cli-alert
version: 0.21.0-dev.0
description: Sentry CLI alert commands
requires:
  bins: ["sentry"]
  auth: true
---

# alert Commands

Manage Sentry alert rules

### `sentry alert issues list <org/project>`

List issue alert rules

**Flags:**
- `-w, --web - Open in browser`
- `-n, --limit <value> - Maximum number of issue alert rules to list - (default: "30")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

### `sentry alert metrics list <org/>`

List metric alert rules

**Flags:**
- `-w, --web - Open in browser`
- `-n, --limit <value> - Maximum number of metric alert rules to list - (default: "30")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
