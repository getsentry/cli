---
name: sentry-cli
description: Guide for using the Sentry CLI to interact with Sentry from the command line. Use when the user asks about viewing issues, events, projects, organizations, making API calls, or authenticating with Sentry via CLI.
---

# Sentry CLI Usage Guide

Help users interact with Sentry from the command line using the `sentry` CLI.

## Prerequisites

The CLI must be installed and authenticated before use.

### Installation

```bash
# npm
npm install -g sentry

# pnpm
pnpm add -g sentry

# bun
bun add -g sentry

# Or run without installing
npx sentry --help
```

### Authentication

```bash
# OAuth login (recommended)
sentry auth login

# Or use an API token
sentry auth login --token YOUR_SENTRY_API_TOKEN

# Check auth status
sentry auth status
```

## Available Commands

### Auth

Authenticate with Sentry

#### `sentry auth login`

Authenticate with Sentry

**Flags:**
- `--token <value> - Authenticate using an API token instead of OAuth`
- `--timeout <value> - Timeout for OAuth flow in seconds (default: 900) - (default: "900")`

#### `sentry auth logout`

Log out of Sentry

#### `sentry auth refresh`

Refresh your authentication token

**Flags:**
- `--json - Output result as JSON`
- `--force - Force refresh even if token is still valid`

#### `sentry auth status`

View authentication status

**Flags:**
- `--showToken - Show the stored token (masked by default)`

### Org

Work with Sentry organizations

#### `sentry org list`

List organizations

**Flags:**
- `--limit <value> - Maximum number of organizations to list - (default: "30")`
- `--json - Output JSON`

#### `sentry org view <arg0>`

View details of an organization

**Flags:**
- `--json - Output as JSON`
- `-w, --web - Open in browser`

### Project

Work with Sentry projects

#### `sentry project list`

List projects

**Flags:**
- `--org <value> - Organization slug`
- `--limit <value> - Maximum number of projects to list - (default: "30")`
- `--json - Output JSON`
- `--platform <value> - Filter by platform (e.g., javascript, python)`

#### `sentry project view <arg0>`

View details of a project

**Flags:**
- `--org <value> - Organization slug`
- `--json - Output as JSON`
- `-w, --web - Open in browser`

### Issue

Manage Sentry issues

#### `sentry issue list`

List issues in a project

**Flags:**
- `--org <value> - Organization slug`
- `--project <value> - Project slug`
- `--query <value> - Search query (Sentry search syntax)`
- `--limit <value> - Maximum number of issues to return - (default: "10")`
- `--sort <value> - Sort by: date, new, freq, user - (default: "date")`
- `--json - Output as JSON`

#### `sentry issue explain <arg0>`

Analyze an issue's root cause using Seer AI

**Flags:**
- `--org <value> - Organization slug (required for short IDs if not auto-detected)`
- `--project <value> - Project slug (required for short suffixes if not auto-detected)`
- `--json - Output as JSON`
- `--force - Force new analysis even if one exists`

#### `sentry issue plan <arg0>`

Generate a solution plan using Seer AI

**Flags:**
- `--org <value> - Organization slug (required for short IDs if not auto-detected)`
- `--project <value> - Project slug (required for short suffixes if not auto-detected)`
- `--cause <value> - Root cause ID to plan (required if multiple causes exist)`
- `--json - Output as JSON`

#### `sentry issue view <arg0>`

View details of a specific issue

**Flags:**
- `--org <value> - Organization slug (required for short IDs if not auto-detected)`
- `--project <value> - Project slug (required for short suffixes if not auto-detected)`
- `--json - Output as JSON`
- `-w, --web - Open in browser`
- `--spans <value> - Show span tree with N levels of nesting depth`

### Event

View Sentry events

#### `sentry event view <arg0>`

View details of a specific event

**Flags:**
- `--org <value> - Organization slug`
- `--project <value> - Project slug`
- `--json - Output as JSON`
- `-w, --web - Open in browser`
- `--spans <value> - Show span tree from the event's trace`

### Api

Make an authenticated API request

#### `sentry api <endpoint>`

Make an authenticated API request

**Flags:**
- `-X, --method <value> - The HTTP method for the request - (default: "GET")`
- `-F, --field <value>... - Add a typed parameter (key=value, key[sub]=value, key[]=value)`
- `-f, --raw-field <value>... - Add a string parameter without JSON parsing`
- `-H, --header <value>... - Add a HTTP request header in key:value format`
- `--input <value> - The file to use as body for the HTTP request (use "-" to read from standard input)`
- `-i, --include - Include HTTP response status line and headers in the output`
- `--silent - Do not print the response body`
- `--verbose - Include full HTTP request and response in the output`

## Context Auto-Detection

The CLI automatically detects organization and project context from:

1. **CLI flags**: `--org` and `--project`
2. **Environment variables**: `SENTRY_DSN`
3. **Source code scanning**: Finds DSNs in your codebase

This means in most projects, you can simply run:

```bash
sentry issue list    # Uses auto-detected org/project
sentry project view  # Shows detected project(s)
```

## Monorepo Support

The CLI detects multiple Sentry projects in monorepos:

```bash
# Lists issues from all detected projects
sentry issue list

# Shows details for all detected projects
sentry project view
```

In multi-project mode, issues are displayed with aliases (e.g., `f-G`) for disambiguation.
Use these aliases with commands like `sentry issue view f-G`.

## Common Workflows

### Investigate an Issue

```bash
# List recent unresolved issues
sentry issue list --query "is:unresolved" --sort date

# View issue details
sentry issue view PROJ-ABC

# Get AI root cause analysis
sentry issue explain PROJ-ABC

# Open in browser for full context
sentry issue view PROJ-ABC -w
```

### Check Project Health

```bash
# View project configuration
sentry project view my-project --json

# List recent issues sorted by frequency
sentry issue list --sort freq --limit 10
```

### Resolve Issues via API

```bash
# Resolve a single issue
sentry api issues/123/ -X PUT -F status=resolved

# Ignore an issue
sentry api issues/123/ -X PUT -F status=ignored -F statusDetails[ignoreDuration]=10080
```

### Export Data

```bash
# Export issues to JSON
sentry issue list --json > issues.json

# Export organization data
sentry org view my-org --json > org.json
```

## Output Formats

All commands support multiple output formats:

- **Default**: Human-readable formatted output
- **`--json`**: JSON output for scripting/automation
- **`-w, --web`**: Open in browser (where supported)

## Error Resolution

**"Not authenticated"**: Run `sentry auth login`

**"Organization not found"**: Specify with `--org` flag or check `sentry org list`

**"Project not found"**: Specify with `--project` flag or check `sentry project list`

**"No project detected"**: The CLI couldn't find a Sentry DSN in your codebase. Use explicit flags: `--org my-org --project my-project`
