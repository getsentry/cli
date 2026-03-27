---
title: issue
description: Issue commands for the Sentry CLI
---

Manage Sentry issues

## Commands

### `sentry issue list <org/project>`

List issues in a project

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project>` | &lt;org&gt;/ (all projects), &lt;org&gt;/&lt;project&gt;, or &lt;project&gt; (search) |

**Options:**

| Option | Description |
|--------|-------------|
| `-q, --query <query>` | Search query (Sentry search syntax) |
| `-n, --limit <limit>` | Maximum number of issues to list (default: "25") |
| `-s, --sort <sort>` | Sort by: date, new, freq, user (default: "date") |
| `-t, --period <period>` | Time period for issue activity (e.g. 24h, 14d, 90d) (default: "90d") |
| `-c, --cursor <cursor>` | Pagination cursor (use "next" for next page, "prev" for previous) |
| `--compact` | Single-line rows for compact output (auto-detects if omitted) |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry issue explain <issue>`

Analyze an issue's root cause using Seer AI

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<issue>` | Issue: @latest, @most_frequent, &lt;org&gt;/ID, &lt;project&gt;-suffix, ID, or suffix |

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Force new analysis even if one exists |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry issue plan <issue>`

Generate a solution plan using Seer AI

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<issue>` | Issue: @latest, @most_frequent, &lt;org&gt;/ID, &lt;project&gt;-suffix, ID, or suffix |

**Options:**

| Option | Description |
|--------|-------------|
| `--cause <cause>` | Root cause ID to plan (required if multiple causes exist) |
| `--force` | Force new plan even if one exists |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry issue view <issue>`

View details of a specific issue

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<issue>` | Issue: @latest, @most_frequent, &lt;org&gt;/ID, &lt;project&gt;-suffix, ID, or suffix |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `--spans <spans>` | Span tree depth limit (number, "all" for unlimited, "no" to disable) (default: "3") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

### List issues

```bash
# List issues in a specific project
sentry issue list my-org/frontend

# All projects in an org
sentry issue list my-org/

# Search for a project across organizations
sentry issue list frontend
```

```
ID            SHORT ID    TITLE                           COUNT   USERS
123456789     FRONT-ABC   TypeError: Cannot read prop...  1.2k    234
987654321     FRONT-DEF   ReferenceError: x is not de...  456     89
```

**Filter by status:**

```bash
# Show only unresolved issues
sentry issue list my-org/frontend --query "is:unresolved"

# Show resolved issues
sentry issue list my-org/frontend --query "is:resolved"

# Sort by frequency
sentry issue list my-org/frontend --sort freq --limit 20
```

### View an issue

```bash
sentry issue view FRONT-ABC
```

```
Issue: TypeError: Cannot read property 'foo' of undefined
Short ID: FRONT-ABC
Status: unresolved
First seen: 2024-01-15 10:30:00
Last seen: 2024-01-20 14:22:00
Events: 1,234
Users affected: 234

Latest event:
  Browser: Chrome 120
  OS: Windows 10
  URL: https://example.com/app
```

```bash
# Open in browser
sentry issue view FRONT-ABC -w
```

### Explain and plan with Seer AI

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

**Requirements:**

- Seer AI enabled for your organization
- GitHub integration configured with repository access
- Code mappings set up to link stack frames to source files
- Root cause analysis must be completed (`sentry issue explain`) before generating a plan
