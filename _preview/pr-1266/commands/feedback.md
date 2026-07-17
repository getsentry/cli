---
title: "feedback"
description: "Feedback commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1266/commands/feedback/"
---

# feedback

Search and inspect User Feedback

## Commands

[Section titled “Commands”](#commands)

### `sentry feedback list <org/project>`

[Section titled “sentry feedback list <org/project>”](#sentry-feedback-list-orgproject)

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
| `-t, --period <period>` | Time range: "7d", "2026-06-01..2026-07-01", ">=2026-06-01" (default: "14d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry feedback view <org/project/feedback-id>`

[Section titled “sentry feedback view <org/project/feedback-id>”](#sentry-feedback-view-orgprojectfeedback-id)

View a User Feedback item

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project/feedback-id>` | Feedback ID: numeric ID, short ID, <org>/SHORT-ID, or <org>/<project>/<suffix> |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

### List User Feedback

[Section titled “List User Feedback”](#list-user-feedback)

Modern User Feedback is stored as Feedback issues. The command always limits issue searches to `issue.category:feedback`; it does not use the legacy User Reports API.

Terminal window

```
# Auto-detect the organization from the current projectsentry feedback list
# List Feedback for one projectsentry feedback list my-org/frontend
# List Feedback across every project in an organizationsentry feedback list my-org/
# Search for a project across accessible organizationssentry feedback list frontend
```


The unresolved inbox from the last 14 days is shown by default. Select another mailbox or expand the time range with flags:

Terminal window

```
sentry feedback list my-org/frontend --status resolvedsentry feedback list my-org/frontend --status spamsentry feedback list my-org/frontend --status all --period 90dsentry feedback list my-org/frontend --query "message:*checkout*"
```


Use `--json` for the standard paginated envelope. Navigate pages in either direction with `--cursor next` and `--cursor prev`.

### View User Feedback

[Section titled “View User Feedback”](#view-user-feedback)
Terminal window

```
# Short ID or numeric IDsentry feedback view FRONTEND-2SDJsentry feedback view 5146636313
# Explicit organizationsentry feedback view my-org/FRONTEND-2SDJ
# `view` is the default command; `show` is an aliassentry feedback my-org/FRONTEND-2SDJsentry feedback show my-org/FRONTEND-2SDJ
# Open the Feedback item in Sentrysentry feedback view my-org/FRONTEND-2SDJ --web
```


The detail view includes the complete message and, when available, its latest event, linked error, Session Replays, and attachment metadata. If the supplied ID belongs to another issue category, use `sentry issue view` instead.
