---
title: issue
description: Issue commands for the Sentry CLI
---

Track and manage Sentry issues.

## Commands

### `sentry issue list`

List issues in a project.

```bash
# Explicit org and project
sentry issue list <org>/<project>

# All projects in an organization
sentry issue list <org>/

# Search for project across all accessible orgs
sentry issue list <project>

# Auto-detect from DSN or config
sentry issue list
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>/<project>` | Explicit organization and project (e.g., `my-org/frontend`) |
| `<org>/` | All projects in the specified organization |
| `<project>` | Search for project by name across all accessible organizations |

**Options:**

| Option | Description |
|--------|-------------|
| `--query <query>` | Search query (Sentry search syntax) |
| `--sort <sort>` | Sort by: date, new, freq, user (default: date) |
| `--limit <n>` | Maximum number of issues to return (default: 10) |
| `--json` | Output as JSON |

**Examples:**

```bash
# List issues in a specific project
sentry issue list my-org/frontend
```

```
ID            SHORT ID    TITLE                           COUNT   USERS
123456789     FRONT-ABC   TypeError: Cannot read prop...  1.2k    234
987654321     FRONT-DEF   ReferenceError: x is not de...  456     89
```

**List issues from all projects in an org:**

```bash
sentry issue list my-org/
```

**Search for a project across organizations:**

```bash
sentry issue list frontend
```

**With search query:**

```bash
sentry issue list my-org/frontend --query "TypeError"
```

**Sort by frequency:**

```bash
sentry issue list my-org/frontend --sort freq --limit 20
```

### `sentry issue view`

View details of a specific issue.

```bash
# By issue ID
sentry issue view <issue-id>

# By short ID
sentry issue view <short-id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<issue-id>` | The issue ID (numeric) or short ID (e.g., PROJ-ABC) |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `--json` | Output as JSON |

**Example:**

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

**Open in browser:**

```bash
sentry issue view FRONT-ABC -w
```

### `sentry issue explain`

Analyze an issue's root cause using Seer AI.

```bash
sentry issue explain <issue-id>
```

This command analyzes the issue and provides:
- Identified root causes
- Reproduction steps
- Relevant code locations

The analysis may take a few minutes for new issues.

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<issue-id>` | The issue ID (numeric), short ID (e.g., PROJ-ABC), or short suffix |

**Options:**

| Option | Description |
|--------|-------------|
| `--org <org-slug>` | Organization slug (required for short IDs if not auto-detected) |
| `--project <project-slug>` | Project slug (required for short suffixes if not auto-detected) |
| `--force` | Force new analysis even if one already exists |
| `--json` | Output as JSON |

**Examples:**

```bash
# By numeric issue ID
sentry issue explain 123456789

# By short ID
sentry issue explain MYPROJECT-ABC --org my-org

# By short suffix (requires project context)
sentry issue explain G --org my-org --project my-project

# Force a fresh analysis
sentry issue explain 123456789 --force
```

**Requirements:**

- Seer AI enabled for your organization
- GitHub integration configured with repository access
- Code mappings set up to link stack frames to source files

### `sentry issue plan`

Generate a solution plan for a Sentry issue using Seer AI.

```bash
sentry issue plan <issue-id>
```

This command requires that `sentry issue explain` has been run first to identify the root cause. It generates a solution plan with specific implementation steps to fix the issue.

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<issue-id>` | The issue ID (numeric), short ID (e.g., PROJ-ABC), or short suffix |

**Options:**

| Option | Description |
|--------|-------------|
| `--org <org-slug>` | Organization slug (required for short IDs if not auto-detected) |
| `--project <project-slug>` | Project slug (required for short suffixes if not auto-detected) |
| `--cause <n>` | Root cause ID to plan (required if multiple causes were identified) |
| `--json` | Output as JSON |

**Examples:**

```bash
# After running explain, create a plan
sentry issue plan 123456789

# Specify which root cause to plan for (if multiple were found)
sentry issue plan 123456789 --cause 0

# By short ID
sentry issue plan MYPROJECT-ABC --org my-org --cause 1
```

**Requirements:**

- Root cause analysis must be completed first (`sentry issue explain`)
- GitHub integration configured for your organization
- Code mappings set up for your project