---
name: sentry-cli-issue
version: 0.35.0-dev.0
description: Manage Sentry issues
requires:
  bins: ["sentry"]
  auth: true
---

# Issue Commands

Manage Sentry issues

### `sentry issue list <org/project>`

List issues in a project

**Flags:**
- `-q, --query <value> - Search query (Sentry syntax, implicit AND, no OR operator)`
- `-n, --limit <value> - Maximum number of issues to list - (default: "25")`
- `-s, --sort <value> - Sort by: date, new, freq, user - (default: "date")`
- `-t, --period <value> - Time range: "7d", "2026-04-01..2026-05-01", ">=2026-04-01" - (default: "90d")`
- `-c, --cursor <value> - Pagination cursor (use "next" for next page, "prev" for previous)`
- `--compact - Single-line rows for compact output (auto-detects if omitted)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Numeric issue ID |
| `shortId` | string | Human-readable short ID (e.g. PROJ-ABC) |
| `title` | string | Issue title |
| `culprit` | string | Culprit string |
| `count` | string | Total event count |
| `userCount` | number | Number of affected users |
| `firstSeen` | string | First occurrence (ISO 8601) |
| `lastSeen` | string | Most recent occurrence (ISO 8601) |
| `level` | string | Severity level |
| `status` | string | Issue status |
| `permalink` | string | URL to the issue in Sentry |
| `project` | object | Project info |
| `metadata` | object | Issue metadata |
| `assignedTo` | object \| null | Assigned user or team |
| `priority` | string | Triage priority |
| `platform` | string | Platform |
| `substatus` | string \| null | Issue substatus |
| `isUnhandled` | boolean | Whether the issue is unhandled |
| `seerFixabilityScore` | number \| null | Seer AI fixability score (0-1) |

### `sentry issue events <issue>`

List events for a specific issue

**Flags:**
- `-n, --limit <value> - Number of events (1-1000) - (default: "25")`
- `-q, --query <value> - Search query (Sentry search syntax)`
- `--full - Include full event body (stacktraces)`
- `-t, --period <value> - Time range: "7d", "2026-04-01..2026-05-01", ">=2026-04-01" - (default: "7d")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Internal event ID |
| `event.type` | string | Event type (error, default, transaction) |
| `groupID` | string \| null | Group (issue) ID |
| `eventID` | string | UUID-format event ID |
| `projectID` | string | Project ID |
| `message` | string | Event message |
| `title` | string | Event title |
| `location` | string \| null | Source location (file:line) |
| `culprit` | string \| null | Culprit function/module |
| `user` | object \| null | User context |
| `tags` | array | Event tags |
| `platform` | string \| null | Platform (python, javascript, etc.) |
| `dateCreated` | string | ISO 8601 creation timestamp |
| `crashFile` | string \| null | Crash file URL |
| `metadata` | object \| null | Event metadata |

### `sentry issue explain <issue>`

Analyze an issue's root cause using Seer AI

**Flags:**
- `--force - Force new analysis even if one exists`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry issue plan <issue>`

Generate a solution plan using Seer AI

**Flags:**
- `--force - Force new plan even if one exists`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry issue view <issue>`

View details of a specific issue

**Flags:**
- `-w, --web - Open in browser`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry issue resolve <issue>`

Mark an issue as resolved

**Flags:**
- `-i, --in <value> - Resolve in a release, next release, or commit ('<version>' | '@next' | '@commit' | '@commit:<repo>@<sha>')`

### `sentry issue unresolve <issue>`

Reopen a resolved issue

### `sentry issue archive <issue>`

Archive (ignore) an issue

**Flags:**
- `-u, --until <value> - Condition for unarchival: forever, auto, 30m, 10x, 10u, 10x/5m, etc.`

### `sentry issue merge <issue...>`

Merge 2+ issues into a single canonical group

**Flags:**
- `-i, --into <value> - Prefer this issue as the canonical parent (must match one of the provided IDs)`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
