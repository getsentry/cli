---
name: sentry-cli-issues
version: 0.22.0
description: List, view, and analyze Sentry issues with AI
requires:
  bins: ["sentry"]
  auth: true
---

# Issue Commands

Manage Sentry issues

### `sentry issue list <org/project>`

List issues in a project

**Flags:**
- `-q, --query <value> - Search query (Sentry search syntax)`
- `-n, --limit <value> - Maximum number of issues to list - (default: "25")`
- `-s, --sort <value> - Sort by: date, new, freq, user - (default: "date")`
- `-t, --period <value> - Time period for issue activity (e.g. 24h, 14d, 90d) - (default: "90d")`
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
| `firstSeen` | string \| null | First occurrence (ISO 8601) |
| `lastSeen` | string \| null | Most recent occurrence (ISO 8601) |
| `level` | string | Severity level |
| `status` | string | Issue status |
| `priority` | string | Triage priority |
| `platform` | string | Platform |
| `permalink` | string | URL to the issue in Sentry |
| `project` | object | Project info |
| `metadata` | object | Issue metadata |
| `assignedTo` | unknown \| null | Assigned user or team |
| `substatus` | string \| null | Issue substatus |
| `isUnhandled` | boolean | Whether the issue is unhandled |
| `seerFixabilityScore` | number \| null | Seer AI fixability score (0-1) |

**Examples:**

```bash
# List issues in a specific project
sentry issue list my-org/frontend

# All projects in an org
sentry issue list my-org/

# Search for a project across organizations
sentry issue list frontend

# Show only unresolved issues
sentry issue list my-org/frontend --query "is:unresolved"

# Show resolved issues
sentry issue list my-org/frontend --query "is:resolved"

# Sort by frequency
sentry issue list my-org/frontend --sort freq --limit 20
```

### `sentry issue explain <issue>`

Analyze an issue's root cause using Seer AI

**Flags:**
- `--force - Force new analysis even if one exists`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# Analyze root cause (may take a few minutes for new issues)
sentry issue explain 123456789

# By short ID with org prefix
sentry issue explain my-org/MYPROJECT-ABC

# Force a fresh analysis
sentry issue explain 123456789 --force

# Generate a fix plan (requires explain to be run first)
sentry issue plan 123456789

# Specify which root cause to plan for
sentry issue plan 123456789 --cause 0
```

### `sentry issue plan <issue>`

Generate a solution plan using Seer AI

**Flags:**
- `--cause <value> - Root cause ID to plan (required if multiple causes exist)`
- `--force - Force new plan even if one exists`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

### `sentry issue view <issue>`

View details of a specific issue

**Flags:**
- `-w, --web - Open in browser`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
sentry issue view FRONT-ABC

# Open in browser
sentry issue view FRONT-ABC -w
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
