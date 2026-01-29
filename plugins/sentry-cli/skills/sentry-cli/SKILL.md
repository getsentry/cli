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
# Install script
curl https://cli.sentry.dev/install -fsS | bash

# Or use npm/pnpm/bun
npm install -g sentry
```

### Authentication

```bash
sentry auth login
sentry auth login --token YOUR_SENTRY_API_TOKEN
sentry auth status
sentry auth logout
```

## Available Commands

### Auth

Authenticate with Sentry

#### `sentry auth login`

Authenticate with Sentry

**Flags:**
- `--token <value> - Authenticate using an API token instead of OAuth`
- `--timeout <value> - Timeout for OAuth flow in seconds (default: 900) - (default: "900")`

**Examples:**

```bash
# OAuth device flow (recommended)
sentry auth login

# Using an API token
sentry auth login --token YOUR_TOKEN
```

#### `sentry auth logout`

Log out of Sentry

**Examples:**

```bash
sentry auth logout
```

#### `sentry auth refresh`

Refresh your authentication token

**Flags:**
- `--json - Output result as JSON`
- `--force - Force refresh even if token is still valid`

**Examples:**

```bash
sentry auth refresh
```

#### `sentry auth status`

View authentication status

**Flags:**
- `--showToken - Show the stored token (masked by default)`

**Examples:**

```bash
sentry auth status
```

### Org

Work with Sentry organizations

#### `sentry org list`

List organizations

**Flags:**
- `--limit <value> - Maximum number of organizations to list - (default: "30")`
- `--json - Output JSON`

**Examples:**

```bash
sentry org list

sentry org list --json
```

#### `sentry org view <arg0>`

View details of an organization

**Flags:**
- `--json - Output as JSON`
- `-w, --web - Open in browser`

**Examples:**

```bash
sentry org view <org-slug>

sentry org view my-org

sentry org view my-org -w
```

### Project

Work with Sentry projects

#### `sentry project list`

List projects

**Flags:**
- `--org <value> - Organization slug`
- `--limit <value> - Maximum number of projects to list - (default: "30")`
- `--json - Output JSON`
- `--platform <value> - Filter by platform (e.g., javascript, python)`

**Examples:**

```bash
# List all projects
sentry project list

# List projects in a specific organization
sentry project list <org-slug>

# Filter by platform
sentry project list --platform javascript
```

#### `sentry project view <arg0>`

View details of a project

**Flags:**
- `--org <value> - Organization slug`
- `--json - Output as JSON`
- `-w, --web - Open in browser`

**Examples:**

```bash
sentry project view <project-slug>

sentry project view frontend --org my-org

sentry project view frontend -w
```

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

**Examples:**

```bash
sentry issue list --org <org-slug> --project <project-slug>

sentry issue list --org my-org --project frontend

sentry issue list --org my-org --project frontend --query "TypeError"
```

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

**Examples:**

```bash
# By issue ID
sentry issue view <issue-id>

# By short ID
sentry issue view <short-id>

sentry issue view FRONT-ABC

sentry issue view FRONT-ABC -w
```

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

**Examples:**

```bash
sentry event view <event-id>

sentry event view abc123def456

sentry event view abc123def456 -w
```

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

**Examples:**

```bash
sentry api <endpoint> [options]

# List organizations
sentry api /organizations/

# Get a specific organization
sentry api /organizations/my-org/

# Get project details
sentry api /projects/my-org/my-project/

# Create a new project
sentry api /teams/my-org/my-team/projects/ \
  --method POST \
  --field name="New Project" \
  --field platform=javascript

# Update an issue status
sentry api /issues/123456789/ \
  --method PUT \
  --field status=resolved

# Assign an issue
sentry api /issues/123456789/ \
  --method PUT \
  --field assignedTo="user@example.com"

# Delete a project
sentry api /projects/my-org/my-project/ \
  --method DELETE

sentry api /organizations/ \
  --header "X-Custom-Header:value"

sentry api /organizations/ --include

# Get all issues (automatically follows pagination)
sentry api /projects/my-org/my-project/issues/ --paginate
```

## Output Formats

### JSON Output

Most list and view commands support `--json` flag for JSON output, making it easy to integrate with other tools:

```bash
sentry org list --json | jq '.[] | .slug'
```

### Opening in Browser

View commands support `-w` or `--web` flag to open the resource in your browser:

```bash
sentry issue view PROJ-123 -w
```
