---
name: sentry-cli-projects
version: 0.22.0
description: Create, list, and manage Sentry projects
requires:
  bins: ["sentry"]
  auth: true
---

# Project Commands

Work with Sentry projects

### `sentry project create <name> <platform>`

Create a new project

**Flags:**
- `-t, --team <value> - Team to create the project under`
- `-n, --dry-run - Validate inputs and show what would be created without creating it`

### `sentry project delete <org/project>`

Delete a project

**Flags:**
- `-y, --yes - Skip confirmation prompt`
- `-f, --force - Force deletion without confirmation`
- `-n, --dry-run - Validate and show what would be deleted without deleting`

### `sentry project list <org/project>`

List projects

**Flags:**
- `-n, --limit <value> - Maximum number of projects to list - (default: "30")`
- `-p, --platform <value> - Filter by platform (e.g., javascript, python)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

### `sentry project view <org/project>`

View details of a project

**Flags:**
- `-w, --web - Open in browser`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
# List all projects in an org
sentry project list my-org/

# Filter by platform
sentry project list my-org/ --platform javascript

# View project details
sentry project view my-org/frontend

# Open project in browser
sentry project view my-org/frontend -w
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
