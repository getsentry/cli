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
| `<name>` | Project name (supports org/name syntax) |
| `<platform>` | Project platform (e.g., node, python, javascript-nextjs) |

**Options:**

| Option | Description |
|--------|-------------|
| `-t, --team <team>` | Team to create the project under |
| `-n, --dry-run` | Show what would happen without making changes |

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
| `-f, --force` | Force the operation without confirmation |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry project list <org/project>`

List projects

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org/project>` | &lt;org&gt;/ (all projects), &lt;org&gt;/&lt;project&gt;, or &lt;project&gt; (search) |

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
| `<org/project>` | &lt;org&gt;/&lt;project&gt;, &lt;project&gt; (search), or omit for auto-detect |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# List all projects in an org
sentry project list my-org/
```

```
ORG         SLUG           PLATFORM      TEAM
my-org      frontend       javascript    web-team
my-org      backend        python        api-team
my-org      mobile-ios     cocoa         mobile-team
```

```bash
# Filter by platform
sentry project list my-org/ --platform javascript

# View project details
sentry project view my-org/frontend
```

```
Project: frontend
Organization: my-org
Platform: javascript
Team: web-team
DSN: https://abc123@sentry.io/123456
```

```bash
# Open project in browser
sentry project view my-org/frontend -w
```

### Create a project

```bash
# Create a new project
sentry project create my-new-app javascript-nextjs

# Create under a specific org and team
sentry project create my-org/my-new-app python --team backend-team

# Preview without creating
sentry project create my-new-app node --dry-run
```

### Delete a project

```bash
# Delete a project (will prompt for confirmation)
sentry project delete my-org/old-project

# Delete without confirmation
sentry project delete my-org/old-project --yes
```
