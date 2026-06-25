---
title: "project"
description: "Project commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1141/commands/project/"
---

# project

Work with Sentry projects

## Commands

[Section titled “Commands”](#commands)

### `sentry project create <name> <platform>`

[Section titled “sentry project create <name> <platform>”](#sentry-project-create-name-platform)

Create a new project

**Arguments:**

| Argument | Description |
| --- | --- |
| `<name>` | Project name (supports org/name syntax) |
| `<platform>` | Project platform (e.g., node, python, javascript-nextjs) |

**Options:**

| Option | Description |
| --- | --- |
| `-t, --team <team>` | Team to create the project under |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry project delete <org/project>`

[Section titled “sentry project delete <org/project>”](#sentry-project-delete-orgproject)

Delete a project

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/<project> or <project> (search across orgs) |

**Options:**

| Option | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation prompt |
| `-f, --force` | Force the operation without confirmation |
| `-n, --dry-run` | Show what would happen without making changes |

### `sentry project list <org/project>`

[Section titled “sentry project list <org/project>”](#sentry-project-list-orgproject)

List projects

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/ (all projects), <org>/<project>, or <project> (search) |

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Maximum number of projects to list (default: "25") |
| `-p, --platform <platform>` | Filter by platform (e.g., javascript, python) |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |
| `-c, --cursor <cursor>` | Navigate pages: "next", "prev", "first" (or raw cursor string) |

### `sentry project view <org/project>`

[Section titled “sentry project view <org/project>”](#sentry-project-view-orgproject)

View details of a project

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org/project>` | <org>/<project>, <project> (search), or omit for auto-detect |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# List all projects in an orgsentry project list my-org/
```


```
ORG         SLUG           PLATFORM      TEAMmy-org      frontend       javascript    web-teammy-org      backend        python        api-teammy-org      mobile-ios     cocoa         mobile-team
```


Terminal window

```
# Filter by platformsentry project list my-org/ --platform javascript
# View project detailssentry project view my-org/frontend
```


```
Project: frontendOrganization: my-orgPlatform: javascriptTeam: web-teamDSN: https://abc123@sentry.io/123456
```


Terminal window

```
# Open project in browsersentry project view my-org/frontend -w
```


### Create a project

[Section titled “Create a project”](#create-a-project)
Terminal window

```
# Create a new projectsentry project create my-new-app javascript-nextjs
# Create under a specific org and teamsentry project create my-org/my-new-app python --team backend-team
# Preview without creatingsentry project create my-new-app node --dry-run
```


### Delete a project

[Section titled “Delete a project”](#delete-a-project)
Terminal window

```
# Delete a project (will prompt for confirmation)sentry project delete my-org/old-project
# Delete without confirmationsentry project delete my-org/old-project --yes
```
