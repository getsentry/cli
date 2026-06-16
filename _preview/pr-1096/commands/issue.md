---
title: "issue"
description: "Issue commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1096/commands/issue/"
---

# issue

Manage Sentry issues

## Commands

[Section titled “Commands”](#commands)

### `sentry issue list <org/project>`

[Section titled “sentry issue list <org/project>”](#sentry-issue-list-orgproject)

List issues in a project

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/ (all projects), <org>/<project>, or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `-q, --query <query>` | Search query (Sentry syntax, implicit AND, no OR operator) |
| `-n, --limit <limit>` | Maximum number of issues to list (default: "25") |
| `-s, --sort <sort>` | Sort by: date, new, freq, user (default: "date") |
| `-t, --period <period>` | Time range: "7d", "2026-05-01..2026-06-01", ">=2026-05-01" (default: "90d") |
| `-c, --cursor <cursor>` | Pagination cursor (use "next" for next page, "prev" for previous) |
| `--compact` | Single-line rows for compact output (auto-detects if omitted) |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry issue events <issue>`

[Section titled “sentry issue events <issue>”](#sentry-issue-events-issue)

List events for a specific issue

**Arguments:**

| Argument | Description |
| --- | --- |
| `<issue>` | Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Number of events (1-1000) (default: "25") |
| `-q, --query <query>` | Search query (Sentry search syntax) |
| `--full` | Include full event body (stacktraces) |
| `-t, --period <period>` | Time range: "7d", "2026-05-01..2026-06-01", ">=2026-05-01" (default: "7d") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry issue explain <issue>`

[Section titled “sentry issue explain <issue>”](#sentry-issue-explain-issue)

Analyze an issue's root cause using Seer AI

**Arguments:**

| Argument | Description |
| --- | --- |
| `<issue>` | Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix |

**Options:**

| Option | Description |
| --- | --- |
| `--force` | Force new analysis even if one exists |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry issue plan <issue>`

[Section titled “sentry issue plan <issue>”](#sentry-issue-plan-issue)

Generate a solution plan using Seer AI

**Arguments:**

| Argument | Description |
| --- | --- |
| `<issue>` | Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix |

**Options:**

| Option | Description |
| --- | --- |
| `--force` | Force new plan even if one exists |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry issue view <issue>`

[Section titled “sentry issue view <issue>”](#sentry-issue-view-issue)

View details of a specific issue

**Arguments:**

| Argument | Description |
| --- | --- |
| `<issue>` | Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `--spans <spans>` | Span tree depth limit (number, "all" for unlimited, "no" to disable) (default: "3") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry issue resolve <issue>`

[Section titled “sentry issue resolve <issue>”](#sentry-issue-resolve-issue)

Mark an issue as resolved

**Arguments:**

| Argument | Description |
| --- | --- |
| `<issue>` | Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix |

**Options:**

| Option | Description |
| --- | --- |
| `-i, --in <in>` | Resolve in a release, next release, or commit ('' |

### `sentry issue unresolve <issue>`

[Section titled “sentry issue unresolve <issue>”](#sentry-issue-unresolve-issue)

Reopen a resolved issue

**Arguments:**

| Argument | Description |
| --- | --- |
| `<issue>` | Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix |

### `sentry issue archive <issue>`

[Section titled “sentry issue archive <issue>”](#sentry-issue-archive-issue)

Archive (ignore) an issue

**Arguments:**

| Argument | Description |
| --- | --- |
| `<issue>` | Issue: @latest, @most_frequent, <org>/ID, <org>/<project>#ID, <project>-suffix, ID, or suffix |

**Options:**

| Option | Description |
| --- | --- |
| `-u, --until <until>` | Condition for unarchival: forever, auto, 30m, 10x, 10u, 10x/5m, etc. |

### `sentry issue merge <issue...>`

[Section titled “sentry issue merge <issue...>”](#sentry-issue-merge-issue)

Merge 2+ issues into a single canonical group

**Arguments:**

| Argument | Description |
| --- | --- |
| `<issue...>` | Issue IDs to merge (2 or more required) |

**Options:**

| Option | Description |
| --- | --- |
| `-i, --into <into>` | Prefer this issue as the canonical parent (must match one of the provided IDs) |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)

### List issues

[Section titled “List issues”](#list-issues)
Terminal window

```
# List issues in a specific projectsentry issue list my-org/frontend
# All projects in an orgsentry issue list my-org/
# Search for a project across organizationssentry issue list frontend
```


```
ID            SHORT ID    TITLE                           COUNT   USERS123456789     FRONT-ABC   TypeError: Cannot read prop...  1.2k    234987654321     FRONT-DEF   ReferenceError: x is not de...  456     89
```


**Filter by status and search:**

Terminal window

```
# Show only unresolved issuessentry issue list my-org/frontend --query "is:unresolved"
# Show resolved issuessentry issue list my-org/frontend --query "is:resolved"
# Sort by frequencysentry issue list my-org/frontend --sort freq --limit 20
# Multiple filters (space-separated = implicit AND)sentry issue list --query "is:unresolved level:error assigned:me"
# Negation and wildcardssentry issue list --query "!browser:Chrome message:*timeout*"
# Match multiple values for one key (in-list syntax)sentry issue list --query "browser:[Chrome,Firefox]"
```


Search syntax

Sentry search uses **implicit AND** — space-separated terms are all required. **AND/OR operators are not supported** for issue search. Use alternatives:

- `key:[val1,val2]` — in-list syntax (matches val1 OR val2 for one key)
- Run separate queries for different terms
- `*term*` — wildcard matching

Full syntax reference: [Sentry Search Docs](https://docs.sentry.io/concepts/search/)

### Magic selectors

[Section titled “Magic selectors”](#magic-selectors)

Use `@latest` and `@most_frequent` to target issues without knowing their ID:

Terminal window

```
# View the most recent issuesentry issue view @latest
# Explain the most frequently occurring issuesentry issue explain @most_frequent
# Generate a fix plan for the latest issuesentry issue plan @latest
```


### List events for an issue

[Section titled “List events for an issue”](#list-events-for-an-issue)
Terminal window

```
# List recent events for an issuesentry issue events FRONT-ABC
# Filter events by search querysentry issue events FRONT-ABC --query "browser:Chrome"
# Show full event detailssentry issue events FRONT-ABC --full
# Limit results and filter by time periodsentry issue events FRONT-ABC --limit 50 --period 24h
# Paginate through resultssentry issue events FRONT-ABC -c next
```


### View an issue

[Section titled “View an issue”](#view-an-issue)
Terminal window

```
sentry issue view FRONT-ABC
```


```
Issue: TypeError: Cannot read property 'foo' of undefinedShort ID: FRONT-ABCStatus: unresolvedFirst seen: 2024-01-15 10:30:00Last seen: 2024-01-20 14:22:00Events: 1,234Users affected: 234
Latest event:  Browser: Chrome 120  OS: Windows 10  URL: https://example.com/app
```


Terminal window

```
# Open in browsersentry issue view FRONT-ABC -w
```


Terminal window

```
# GitHub-style identifiers work too (the "#" replaces the final slash)sentry issue view my-org/my-project#FRONT-ABCsentry issue view my-project#FRONT-ABC
```


### Explain and plan with Seer AI

[Section titled “Explain and plan with Seer AI”](#explain-and-plan-with-seer-ai)
Terminal window

```
# Analyze root cause (may take a few minutes for new issues)sentry issue explain 123456789
# By short ID with org prefixsentry issue explain my-org/MYPROJECT-ABC
# Force a fresh analysissentry issue explain 123456789 --force
# Generate a fix plan (automatically runs explain if needed)sentry issue plan 123456789
# Force a fresh plan even if one already existssentry issue plan 123456789 --force
```


**Requirements:**

- Seer AI enabled for your organization
- GitHub integration configured with repository access
- Code mappings set up to link stack frames to source files
- Root cause analysis is run automatically if needed (the `plan` command triggers `explain` first)

### Resolve and reopen issues

[Section titled “Resolve and reopen issues”](#resolve-and-reopen-issues)
Terminal window

```
# Resolve immediately (no regression tracking)sentry issue resolve CLI-G5
# Resolve in a specific release — future events on newer releases are# regression-flaggedsentry issue resolve CLI-G5 --in 0.26.1
# Monorepo-style releases work too (no special parsing)sentry issue resolve CLI-G5 --in spotlight@1.2.3
# Resolve in the next release (tied to current HEAD)sentry issue resolve CLI-G5 --in @nextsentry issue resolve CLI-G5 -i @next
# Resolve in the current git HEAD — auto-detects the Sentry repo from# your git origin remote (hard-errors if it can't)sentry issue resolve CLI-G5 --in @commit
# Explicit commit + repo (no git inspection; repo must be registered in Sentry)sentry issue resolve CLI-G5 --in @commit:getsentry/cli@abc123def
# Reopen a resolved issuesentry issue unresolve CLI-G5sentry issue reopen CLI-G5   # alias
```


How `@commit` auto-detects

`--in @commit` reads `HEAD` and the `origin` remote, parses the remote as `owner/repo`, then looks it up in your org's Sentry repositories (cached locally for 7 days). If any step fails, the command stops with a clear error pointing you at `--in @commit:<repo>@<sha>` or `sentry repo list <org>/` — no silent fallback to a different resolution mode.

### Merge fragmented issues

[Section titled “Merge fragmented issues”](#merge-fragmented-issues)

Consolidate multiple issues (e.g. same logical error split by Sentry's default stack-trace grouping) into a single canonical group:

Terminal window

```
# Let Sentry auto-pick the parent (typically the largest by event count)sentry issue merge CLI-K9 CLI-15H CLI-15N
# Pin the canonical parent explicitly — accepts the same formats as# positional args, including org-qualified and project-alias formssentry issue merge CLI-K9 CLI-15H CLI-15N --into CLI-K9sentry issue merge my-org/CLI-K9 my-org/CLI-15H --into my-org/CLI-K9sentry issue merge cli-k9 cli-15h --into cli-k9    # alias form
# Cross-org merges are rejected — all issues must share an organization# Non-error issue types (performance, info, etc.) cannot be merged
```


### Archive and ignore issues

[Section titled “Archive and ignore issues”](#archive-and-ignore-issues)

Archive an issue to suppress alerts. Without `--until`, the issue is archived forever. Use `--until` to set a condition for automatic unarchival:

Terminal window

```
# Archive forever (fully silenced)sentry issue archive CLI-G5
# Smart detection — unarchives when Sentry detects a spike in event frequencysentry issue archive CLI-G5 --until auto
# Duration-basedsentry issue archive CLI-G5 --until 1h    # 1 hoursentry issue archive CLI-G5 --until 7d    # 7 dayssentry issue archive CLI-G5 --until 2026-12-31  # specific date
# Count-based — unarchive after N more eventssentry issue archive CLI-G5 --until 100x
# User-based — unarchive after N more users affectedsentry issue archive CLI-G5 --until 10u
# Compound — count within a time windowsentry issue archive CLI-G5 --until 100x/1h   # 100 events within 1 hoursentry issue archive CLI-G5 --until 10u/1d    # 10 users within 1 day
# Verbose forms also worksentry issue archive CLI-G5 --until 10events/2hours
# 'ignore' is an alias for 'archive'sentry issue ignore CLI-G5 --until auto
```


`--until` syntax reference

| Format | Meaning |
| --- | --- |
| `auto` | Unarchive on event frequency spike (recommended) |
| `30m`, `1h`, `7d`, `1w` | Duration (minutes, hours, days, weeks) |
| `2026-05-15` | Absolute date (computed as time delta) |
| `10x` or `10events` | After 10 more events |
| `10u` or `10users` | After 10 more users affected |
| `10x/5m` | 10 events within 5 minutes |
| `10users/2hours` | 10 users within 2 hours |
| _(omitted)_ | Archive forever |
