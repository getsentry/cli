---
name: sentry-cli-teams
version: 0.18.1
description: List teams and repositories in a Sentry organization
requires:
  bins: ["sentry"]
  auth: true
---

# Team & Repository Commands

Work with Sentry repositories

Work with Sentry teams

### `sentry repo list <org/project>`

List repositories

**Flags:**
- `-n, --limit <value> - Maximum number of repositories to list - (default: "30")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Pagination cursor (use "last" to continue from previous page)`

### `sentry team list <org/project>`

List teams

**Flags:**
- `-n, --limit <value> - Maximum number of teams to list - (default: "30")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Pagination cursor (use "last" to continue from previous page)`

**Examples:**

```bash
# Auto-detect organization or list all
sentry team list

# List teams in a specific organization
sentry team list <org-slug>

# Limit results
sentry team list --limit 10

sentry team list --json
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
