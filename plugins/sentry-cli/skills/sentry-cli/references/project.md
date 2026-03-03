# Project Commands

Work with Sentry projects

## `sentry project list <org/project>`

List projects

**Flags:**
- `-n, --limit <value> - Maximum number of projects to list - (default: "30")`
- `--json - Output JSON`
- `-c, --cursor <value> - Pagination cursor (use "last" to continue from previous page)`
- `-p, --platform <value> - Filter by platform (e.g., javascript, python)`

**Examples:**

```bash
# List all projects
sentry project list

# List projects in a specific organization
sentry project list <org-slug>

# Filter by platform
sentry project list --platform javascript
```

**Expected output:**

```
ORG         SLUG           PLATFORM      TEAM
my-org      frontend       javascript    web-team
my-org      backend        python        api-team
my-org      mobile-ios     cocoa         mobile-team
```

## `sentry project view <org/project>`

View details of a project

**Flags:**
- `--json - Output as JSON`
- `-w, --web - Open in browser`

**Examples:**

```bash
# Auto-detect from DSN or config
sentry project view

# Explicit org and project
sentry project view <org>/<project>

# Find project across all orgs
sentry project view <project>

sentry project view my-org/frontend

sentry project view my-org/frontend -w
```

**Expected output:**

```
Project: frontend
Organization: my-org
Platform: javascript
Team: web-team
DSN: https://abc123@sentry.io/123456
```

## Shortcuts

- `sentry projects` → shortcut for `sentry project list` (accepts the same flags)

## JSON Recipes

- List project slugs: `sentry project list --json | jq '.[].slug'`
- Filter by platform: `sentry project list --platform python --json | jq '.[].name'`
