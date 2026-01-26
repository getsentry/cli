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

### Organizations

```bash
sentry org list                 # List all accessible organizations
sentry org list --json          # Output as JSON
sentry org view my-org          # View organization details
sentry org view my-org -w       # Open in browser
```

### Projects

```bash
sentry project list                        # List all projects
sentry project list --org my-org           # List projects in specific org
sentry project list --platform javascript  # Filter by platform
sentry project view my-project             # View project details
sentry project view my-project -w          # Open in browser
```

### Issues

```bash
# List issues
sentry issue list --org my-org --project my-project
sentry issue list --query "is:unresolved"
sentry issue list --sort freq --limit 20
sentry issue list --json

# View issue details
sentry issue view 123456789                 # By numeric ID
sentry issue view PROJ-ABC                  # By short ID
sentry issue view 123456789 -w              # Open in browser
```

**Issue ID formats supported:**
- Numeric ID: `123456789`
- Full short ID: `PROJ-ABC`
- Short suffix: `ABC` (when project is auto-detected)

### Events

```bash
sentry event view abc123def456              # View event by ID
sentry event view abc123def456 -w           # Open in browser
sentry event view abc123def456 --json       # Output as JSON
```

### API (Raw Requests)

Make direct API calls to Sentry's API (similar to `gh api`):

```bash
# GET requests
sentry api organizations/
sentry api projects/my-org/my-project/

# POST/PUT with fields
sentry api issues/123/ -X PUT -F status=resolved
sentry api teams/my-org/my-team/members/ -F user[email]=user@example.com

# Nested fields
sentry api projects/my-org/my-project/ -F options[sampleRate]=0.5

# Show response headers
sentry api organizations/ --include

# Verbose output (full request/response)
sentry api organizations/ --verbose
```

**API command flags:**
- `-X, --method`: HTTP method (GET, POST, PUT, DELETE, PATCH)
- `-F, --field`: Add typed field (supports JSON parsing, arrays, nested objects)
- `-f, --raw-field`: Add string field without JSON parsing
- `-H, --header`: Add HTTP header
- `--input`: Read body from file (use `-` for stdin)
- `-i, --include`: Include response headers
- `--silent`: Don't print response body
- `--verbose`: Show full request/response

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

## Common Workflows

### Investigate an Issue

```bash
# List recent unresolved issues
sentry issue list --query "is:unresolved" --sort date

# View issue details
sentry issue view PROJ-ABC

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
