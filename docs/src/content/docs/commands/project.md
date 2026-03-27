---
title: project
description: Project commands for the Sentry CLI
---

Work with Sentry projects

## Commands

### `sentry project create <name> <platform>`

Create a new project

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<name>` | Project name (supports org/name syntax) (optional) |
| `<platform>` | Project platform (e.g., node, python, javascript-nextjs) (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-t, --team <team>` | Team to create the project under |
| `-n, --dry-run` | Validate inputs and show what would be created without creating it |

### `sentry project delete <org/project>`

Delete a project

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project>` | &lt;org&gt;/&lt;project&gt; or &lt;project&gt; (search across orgs) |

**Options:**

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompt |
| `-f, --force` | Force deletion without confirmation |
| `-n, --dry-run` | Validate and show what would be deleted without deleting |

### `sentry project list <org/project>`

List projects

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project>` | &lt;org&gt;/ (all projects), &lt;org&gt;/&lt;project&gt;, or &lt;project&gt; (search) (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <limit>` | Maximum number of projects to list (default: "30") |
| `-p, --platform <platform>` | Filter by platform (e.g., javascript, python) |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry project view <org/project>`

View details of a project

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project>` | &lt;org&gt;/&lt;project&gt;, &lt;project&gt; (search), or omit for auto-detect (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# List all projects
sentry project list my-org/

# Filter by platform
sentry project list my-org/ --platform javascript

# View project details
sentry project view my-org/frontend

# Open project in browser
sentry project view my-org/frontend -w
```
