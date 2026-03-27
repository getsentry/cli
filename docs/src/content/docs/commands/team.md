---
title: team
description: Team commands for the Sentry CLI
---

Work with Sentry teams

## Commands

### `sentry team list <org/project>`

List teams

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project>` | &lt;org&gt;/ (all projects), &lt;org&gt;/&lt;project&gt;, or &lt;project&gt; (search) |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <limit>` | Maximum number of teams to list (default: "30") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# List teams
sentry team list my-org/

# Paginate through teams
sentry team list my-org/ -c next

# Output as JSON
sentry team list --json
```
