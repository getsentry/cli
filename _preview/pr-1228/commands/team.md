---
title: "team"
description: "Team commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1228/commands/team/"
---

# team

Work with Sentry teams

## Commands

[Section titled “Commands”](#commands)

### `sentry team list <org/project>`

[Section titled “sentry team list <org/project>”](#sentry-team-list-orgproject)

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

[Section titled “Examples”](#examples)
Terminal window

```
# List teamssentry team list my-org/
# Paginate through teamssentry team list my-org/ -c next
# Output as JSONsentry team list --json
```
