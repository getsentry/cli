---
title: "team"
description: "Team commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-main/commands/team/"
---

# team

Work with Sentry teams

## Commands

### `sentry team list <org/project>`

List teams

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/ (all projects), <org>/<project>, or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Maximum number of teams to list (default: "25") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

```bash
# List teams
sentry team list my-org/


# Paginate through teams
sentry team list my-org/ -c next


# Output as JSON
sentry team list --json
```

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-main/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-main/commands.md)
- [Previous: span](https://cli.sentry.dev/_preview/pr-main/commands/span.md)
- [Next: trace](https://cli.sentry.dev/_preview/pr-main/commands/trace.md)
