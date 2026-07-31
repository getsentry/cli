---
title: "replay"
description: "Replay commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-main/commands/replay/"
---

# replay

Search and inspect Session Replays

## Commands

### `sentry replay list <org/project>`

List recent Session Replays

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/, <org>/<project>, or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Number of replays (1-1000) (default: "25") |
| `-q, --query <query>` | Search query (Sentry replay search syntax) |
| `-e, --environment <environment>...` | Filter by environment (repeatable, comma-separated) |
| `-s, --sort <sort>` | Sort by: date, oldest, duration, errors, activity, or a raw replay sort field (default: "date") |
| `-t, --period <period>` | Time range: "7d", "2026-06-01..2026-07-01", ">=2026-06-01" (default: "7d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry replay view <replay-id-or-url...>`

View a Session Replay

**Arguments:**

| Argument | Description |
| --- | --- |
| `<replay-id-or-url...>` | [<org>/<project>] <replay-id> or <replay-url> |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

### List replays

```bash
# List recent replays for a project
sentry replay list my-org/frontend


# Search across all projects in an org
sentry replay list my-org/ --query "environment:production"


# Change the time window and sort
sentry replay list my-org/frontend --period 24h --sort errors


# Paginate through results
sentry replay list my-org/frontend -c next
sentry replay list my-org/frontend -c prev


# Output machine-readable data
sentry replay list my-org/frontend --json
```


### View a replay

```bash
# View a replay by ID using auto-detected org/project context
sentry replay view 346789a703f6454384f1de473b8b9fcc


# View a replay with an explicit org
sentry replay view my-org/346789a703f6454384f1de473b8b9fcc


# View a replay with explicit org/project context
sentry replay view my-org/frontend/346789a703f6454384f1de473b8b9fcc


# Open a replay in the browser
sentry replay view my-org/346789a703f6454384f1de473b8b9fcc --web
```

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-main/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-main/commands.md)
- [Previous: release](https://cli.sentry.dev/_preview/pr-main/commands/release.md)
- [Next: repo](https://cli.sentry.dev/_preview/pr-main/commands/repo.md)
