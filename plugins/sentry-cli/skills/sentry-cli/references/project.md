---
name: sentry-cli-project
version: 0.35.0-dev.0
description: Work with Sentry projects
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
- `-n, --dry-run - Show what would happen without making changes`

### `sentry project delete <org/project>`

Delete a project

**Flags:**
- `-y, --yes - Skip confirmation prompt`
- `-f, --force - Force the operation without confirmation`
- `-n, --dry-run - Show what would happen without making changes`

### `sentry project list <org/project>`

List projects

**Flags:**
- `-n, --limit <value> - Maximum number of projects to list - (default: "25")`
- `-p, --platform <value> - Filter by platform (e.g., javascript, python)`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

### `sentry project view <org/project>`

View details of a project

**Flags:**
- `-w, --web - Open in browser`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
