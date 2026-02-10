---
title: project
description: Project commands for the Sentry CLI
---

Manage Sentry projects.

## Commands

### `sentry project list`

List projects you have access to.

```bash
# List all projects
sentry project list

# List projects in a specific organization
sentry project list <org-slug>

# Filter by platform
sentry project list --platform javascript
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[org-slug]` | Optional organization slug to filter by |

**Options:**

| Option | Description |
|--------|-------------|
| `--platform <platform>` | Filter by platform (e.g., javascript, python) |
| `--json` | Output as JSON |

**Example output:**

```
ORG         SLUG           PLATFORM      TEAM
my-org      frontend       javascript    web-team
my-org      backend        python        api-team
my-org      mobile-ios     cocoa         mobile-team
```

### `sentry project view`

View details of a specific project.

```bash
# Auto-detect from DSN or config
sentry project view

# Explicit org and project
sentry project view <org>/<project>

# Find project across all orgs
sentry project view <project>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[target]` | Optional: `<org>/<project>`, `<project>`, or omit for auto-detect |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `--json` | Output as JSON |

**Example:**

```bash
sentry project view my-org/frontend
```

```
Project: frontend
Organization: my-org
Platform: javascript
Team: web-team
DSN: https://abc123@sentry.io/123456
```

**Open in browser:**

```bash
sentry project view my-org/frontend -w
```
