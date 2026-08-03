---
title: "feedback"
description: "Feedback commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1343/commands/feedback/"
---

# feedback

Search and inspect User Feedback

## Commands

### `sentry feedback list <org/project>`

List and search User Feedback

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/, <org>/<project>, or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `--status <status>` | Mailbox: unresolved, resolved, spam, or all (default: "unresolved") |
| `-n, --limit <limit>` | Number of feedback items (1-1000) (default: "25") |
| `-q, --query <query>` | Search query (Sentry issue search syntax) |
| `-t, --period <period>` | Time range: "7d", "2026-07-01..2026-08-01", ">=2026-07-01" (default: "14d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry feedback view <feedback>`

View a User Feedback item

**Arguments:**

| Argument | Description |
| --- | --- |
| `<feedback>` | Feedback: @latest, numeric ID, short ID, <org>/SHORT-ID, or <org>/<project>/<suffix> |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

### List User Feedback

Modern User Feedback is stored as Feedback issues. The command always limits issue searches to `issue.category:feedback`; it does not use the legacy User Reports API.

```bash
# Auto-detect the organization from the current project
sentry feedback list


# List Feedback for one project
sentry feedback list my-org/frontend


# List Feedback across every project in an organization
sentry feedback list my-org/


# Search for a project across accessible organizations
sentry feedback list frontend
```


The unresolved inbox from the last 14 days is shown by default. Select another mailbox or expand the time range with flags:

```bash
sentry feedback list my-org/frontend --status resolved
sentry feedback list my-org/frontend --status spam
sentry feedback list my-org/frontend --status all --period 90d
sentry feedback list my-org/frontend --query "message:*checkout*"
```


Use `--json` for the standard paginated envelope. Navigate pages in either direction with `--cursor next` and `--cursor prev`.

### View User Feedback

```bash
# Most recent unresolved Feedback, with detected or explicit organization
sentry feedback view @latest
sentry feedback view my-org/@latest


# Short ID or numeric ID
sentry feedback view FRONTEND-2SDJ
sentry feedback view 5146636313


# Explicit organization
sentry feedback view my-org/FRONTEND-2SDJ


# `view` is the default command; `show` is an alias
sentry feedback my-org/FRONTEND-2SDJ
sentry feedback show my-org/FRONTEND-2SDJ


# Open the Feedback item in Sentry
sentry feedback view my-org/FRONTEND-2SDJ --web
```


`@latest` selects the most recently active unresolved Feedback.

The detail view includes the complete message and, when available, its latest event, linked error, Session Replays, and attachment metadata. If the supplied ID belongs to another issue category, use `sentry issue view` instead.

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-1343/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-1343/commands.md)
- [Previous: explore](https://cli.sentry.dev/_preview/pr-1343/commands/explore.md)
- [Next: info](https://cli.sentry.dev/_preview/pr-1343/commands/info.md)
