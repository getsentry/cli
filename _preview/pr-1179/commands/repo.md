---
title: "repo"
description: "Repo commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1179/commands/repo/"
---

# repo

Work with Sentry repositories

## Commands

[Section titled “Commands”](#commands)

### `sentry repo list <org/project>`

[Section titled “sentry repo list <org/project>”](#sentry-repo-list-orgproject)

List repositories

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/ (all projects), <org>/<project>, or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Maximum number of repositories to list (default: "25") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# List repositories (auto-detect org)sentry repo list
# List repos in a specific org with paginationsentry repo list my-org/ -c next
# Output as JSONsentry repo list --json
```
