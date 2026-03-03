# Issue Commands

Manage Sentry issues

## `sentry issue list <org/project>`

List issues in a project

**Flags:**
- `-q, --query <value> - Search query (Sentry search syntax)`
- `-n, --limit <value> - Maximum number of issues to list - (default: "25")`
- `-s, --sort <value> - Sort by: date, new, freq, user - (default: "date")`
- `-t, --period <value> - Time period for issue activity (e.g. 24h, 14d, 90d) - (default: "90d")`
- `--json - Output JSON`
- `-c, --cursor <value> - Pagination cursor for <org>/ or multi-target modes (use "last" to continue)`

**Examples:**

```bash
# Explicit org and project
sentry issue list <org>/<project>

# All projects in an organization
sentry issue list <org>/

# Search for project across all accessible orgs
sentry issue list <project>

# Auto-detect from DSN or config
sentry issue list

# List issues in a specific project
sentry issue list my-org/frontend

sentry issue list my-org/

sentry issue list frontend

sentry issue list my-org/frontend --query "TypeError"

sentry issue list my-org/frontend --sort freq --limit 20

# Show only unresolved issues
sentry issue list my-org/frontend --query "is:unresolved"

# Show resolved issues
sentry issue list my-org/frontend --query "is:resolved"

# Combine with other search terms
sentry issue list my-org/frontend --query "is:unresolved TypeError"
```

**Expected output:**

```
ID            SHORT ID    TITLE                           COUNT   USERS
123456789     FRONT-ABC   TypeError: Cannot read prop...  1.2k    234
987654321     FRONT-DEF   ReferenceError: x is not de...  456     89
```

## `sentry issue explain <issue>`

Analyze an issue's root cause using Seer AI

**Requirements:**

- Seer AI enabled for your organization
- GitHub integration configured with repository access
- Code mappings set up to link stack frames to source files

**Flags:**
- `--json - Output as JSON`
- `--force - Force new analysis even if one exists`

**Examples:**

```bash
sentry issue explain <issue-id>

# By numeric issue ID
sentry issue explain 123456789

# By short ID with org prefix
sentry issue explain my-org/MYPROJECT-ABC

# By project-suffix format
sentry issue explain myproject-G

# Force a fresh analysis
sentry issue explain 123456789 --force
```

## `sentry issue plan <issue>`

Generate a solution plan using Seer AI

Generate a solution plan for a Sentry issue using Seer AI.

**Requirements:**

- Root cause analysis must be completed first (`sentry issue explain`)
- GitHub integration configured for your organization
- Code mappings set up for your project

**Flags:**
- `--cause <value> - Root cause ID to plan (required if multiple causes exist)`
- `--json - Output as JSON`
- `--force - Force new plan even if one exists`

**Examples:**

```bash
sentry issue plan <issue-id>

# After running explain, create a plan
sentry issue plan 123456789

# Specify which root cause to plan for (if multiple were found)
sentry issue plan 123456789 --cause 0

# By short ID with org prefix
sentry issue plan my-org/MYPROJECT-ABC --cause 1

# By project-suffix format
sentry issue plan myproject-G --cause 0
```

## `sentry issue view <issue>`

View details of a specific issue

**Flags:**
- `--json - Output as JSON`
- `-w, --web - Open in browser`
- `--spans <value> - Span tree depth limit (number, "all" for unlimited, "no" to disable) - (default: "3")`

**Examples:**

```bash
# By issue ID
sentry issue view <issue-id>

# By short ID
sentry issue view <short-id>

sentry issue view FRONT-ABC

sentry issue view FRONT-ABC -w
```

**Expected output:**

```
Issue: TypeError: Cannot read property 'foo' of undefined
Short ID: FRONT-ABC
Status: unresolved
First seen: 2024-01-15 10:30:00
Last seen: 2024-01-20 14:22:00
Events: 1,234
Users affected: 234

Latest event:
  Browser: Chrome 120
  OS: Windows 10
  URL: https://example.com/app
```

## Shortcuts

- `sentry issues` → shortcut for `sentry issue list` (accepts the same flags)

## Workflows

### Diagnose a production issue
1. Find the issue: `sentry issue list <org>/<project> --query "is:unresolved" --sort freq`
2. View details: `sentry issue view <issue-id>`
3. Get AI root cause: `sentry issue explain <issue-id>`
4. Get fix plan: `sentry issue plan <issue-id>`
5. Open in browser for full context: `sentry issue view <issue-id> -w`

### Triage recent regressions
1. List new issues: `sentry issue list <org>/<project> --sort new --period 24h`
2. Check frequency: `sentry issue list <org>/<project> --sort freq --limit 5`
3. Investigate top issue: `sentry issue view <issue-id>`
4. Explain root cause: `sentry issue explain <issue-id>`

## Common Queries

- Unresolved errors: `--query "is:unresolved"`
- Specific error type: `--query "TypeError"`
- By environment: `--query "environment:production"`
- Assigned to me: `--query "assigned:me"`
- Recent issues: `--period 24h`
- Most frequent: `--sort freq --limit 10`
- Combined: `--query "is:unresolved environment:production" --sort freq`

## JSON Recipes

- Extract issue titles: `sentry issue list <org>/<project> --json | jq '.[].title'`
- Get issue counts: `sentry issue list <org>/<project> --json | jq '.[].count'`
- List unresolved as CSV: `sentry issue list <org>/<project> --json --query "is:unresolved" | jq -r '.[] | [.shortId, .title, .count] | @csv'`
