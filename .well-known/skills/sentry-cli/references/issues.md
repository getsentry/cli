---
name: sentry-cli-issues
version: 0.18.1
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
- `-c, --cursor <value> - Pagination cursor for <org>/ or multi-target modes (use "last" to continue)`
- `--compact - Single-line rows for compact output (auto-detects if omitted)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# Explicit org and project
sentry issue list <org>/<project>

# All projects in an organization
sentry issue list <org>/

# Search for project across all accessible orgs
sentry issue list <project>

# Auto-detect from DSN or config
sentry issue list

# List issues in a specific project
sentry issue list my-org/frontend

sentry issue list my-org/

sentry issue list frontend

sentry issue list my-org/frontend --query "TypeError"

sentry issue list my-org/frontend --sort freq --limit 20

# Show only unresolved issues
sentry issue list my-org/frontend --query "is:unresolved"

# Show resolved issues
sentry issue list my-org/frontend --query "is:resolved"

# Combine with other search terms
sentry issue list my-org/frontend --query "is:unresolved TypeError"
```

### `sentry issue explain <issue>`

Analyze an issue's root cause using Seer AI

**Flags:**
- `--force - Force new analysis even if one exists`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
sentry issue explain <issue-id>

# By numeric issue ID
sentry issue explain 123456789

# By short ID with org prefix
sentry issue explain my-org/MYPROJECT-ABC

# By project-suffix format
sentry issue explain myproject-G

# Force a fresh analysis
sentry issue explain 123456789 --force
```

### `sentry issue plan <issue>`

Generate a solution plan using Seer AI

**Flags:**
- `--cause <value> - Root cause ID to plan (required if multiple causes exist)`
- `--force - Force new plan even if one exists`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
sentry issue plan <issue-id>

# After running explain, create a plan
sentry issue plan 123456789

# Specify which root cause to plan for (if multiple were found)
sentry issue plan 123456789 --cause 0

# By short ID with org prefix
sentry issue plan my-org/MYPROJECT-ABC --cause 1

# By project-suffix format
sentry issue plan myproject-G --cause 0
```

### `sentry issue view <issue>`

View details of a specific issue

**Flags:**
- `-w, --web - Open in browser`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# By issue ID
sentry issue view <issue-id>

# By short ID
sentry issue view <short-id>

sentry issue view FRONT-ABC

sentry issue view FRONT-ABC -w
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
