---
title: repo
description: Repo commands for the Sentry CLI
---

Work with Sentry repositories

## Commands

### `sentry repo list <org/project>`

List repositories

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project>` | &lt;org&gt;/ (all projects), &lt;org&gt;/&lt;project&gt;, or &lt;project&gt; (search) |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <limit>` | Maximum number of repositories to list (default: "25") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# List repositories (auto-detect org)
sentry repo list

# List repos in a specific org with pagination
sentry repo list my-org/ -c next

# Output as JSON
sentry repo list --json
```
