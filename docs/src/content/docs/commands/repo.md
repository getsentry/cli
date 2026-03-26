---
title: repo
description: Repo commands for the Sentry CLI
---

List repositories connected to a Sentry organization.

## Commands

### `sentry repo list`

List repositories in an organization.

```bash
# Auto-detect from DSN or config
sentry repo list

# Explicit org
sentry repo list <org>/

# Org inferred from project context
sentry repo list <org>/<project>

# Bare org slug
sentry repo list <org>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>/` | Organization slug (trailing slash enables pagination) |
| `<org>/<project>` | Organization and project (lists repos for that org) |
| `<org>` | Bare organization slug |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <n>` | Number of repositories to show |
| `-c, --cursor <dir>` | Pagination cursor (`next` or `prev`) |
| `--json` | Output as JSON |

**Examples:**

```bash
# List repositories (auto-detect org)
sentry repo list

# List repos in a specific org with pagination
sentry repo list my-org/ -c next

# Output as JSON
sentry repo list --json
```
