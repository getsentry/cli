

## Examples

### List issues

```bash
# List issues in a specific project
sentry issue list my-org/frontend

# All projects in an org
sentry issue list my-org/

# Search for a project across organizations
sentry issue list frontend
```

```
ID            SHORT ID    TITLE                           COUNT   USERS
123456789     FRONT-ABC   TypeError: Cannot read prop...  1.2k    234
987654321     FRONT-DEF   ReferenceError: x is not de...  456     89
```

**Filter by status and search:**

```bash
# Show only unresolved issues
sentry issue list my-org/frontend --query "is:unresolved"

# Show resolved issues
sentry issue list my-org/frontend --query "is:resolved"

# Sort by frequency
sentry issue list my-org/frontend --sort freq --limit 20

# Multiple filters (space-separated = implicit AND)
sentry issue list --query "is:unresolved level:error assigned:me"

# Negation and wildcards
sentry issue list --query "!browser:Chrome message:*timeout*"

# Match multiple values for one key (in-list syntax)
sentry issue list --query "browser:[Chrome,Firefox]"
```

:::caution[Search syntax]
Sentry search uses **implicit AND** — space-separated terms are all required.
**AND/OR operators are not supported** for issue search. Use alternatives:
- `key:[val1,val2]` — in-list syntax (matches val1 OR val2 for one key)
- Run separate queries for different terms
- `*term*` — wildcard matching

Full syntax reference: [Sentry Search Docs](https://docs.sentry.io/concepts/search/)
:::

### View an issue

```bash
sentry issue view FRONT-ABC
```

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

```bash
# Open in browser
sentry issue view FRONT-ABC -w
```

### Explain and plan with Seer AI

```bash
# Analyze root cause (may take a few minutes for new issues)
sentry issue explain 123456789

# By short ID with org prefix
sentry issue explain my-org/MYPROJECT-ABC

# Force a fresh analysis
sentry issue explain 123456789 --force

# Generate a fix plan (requires explain to be run first)
sentry issue plan 123456789

# Specify which root cause to plan for
sentry issue plan 123456789 --cause 0
```

**Requirements:**

- Seer AI enabled for your organization
- GitHub integration configured with repository access
- Code mappings set up to link stack frames to source files
- Root cause analysis must be completed (`sentry issue explain`) before generating a plan

### Resolve and reopen issues

```bash
# Resolve immediately (no regression tracking)
sentry issue resolve CLI-G5

# Resolve in a specific release — future events on newer releases are
# regression-flagged
sentry issue resolve CLI-G5 --in 0.26.1

# Monorepo-style releases work too (no special parsing)
sentry issue resolve CLI-G5 --in spotlight@1.2.3

# Resolve in the next release (tied to current HEAD)
sentry issue resolve CLI-G5 --in @next
sentry issue resolve CLI-G5 -i @next

# Resolve in the current git HEAD — auto-detects the Sentry repo from
# your git origin remote (hard-errors if it can't)
sentry issue resolve CLI-G5 --in @commit

# Explicit commit + repo (no git inspection; repo must be registered in Sentry)
sentry issue resolve CLI-G5 --in @commit:getsentry/cli@abc123def

# Reopen a resolved issue
sentry issue unresolve CLI-G5
sentry issue reopen CLI-G5   # alias
```

:::note[How `@commit` auto-detects]
`--in @commit` reads `HEAD` and the `origin` remote, parses the remote as
`owner/repo`, then looks it up in your org's Sentry repositories (cached
locally for 7 days). If any step fails, the command stops with a clear
error pointing you at `--in @commit:<repo>@<sha>` or `sentry repo list <org>/`
— no silent fallback to a different resolution mode.
:::

### Merge fragmented issues

Consolidate multiple issues (e.g. same logical error split by Sentry's
default stack-trace grouping) into a single canonical group:

```bash
# Let Sentry auto-pick the parent (typically the largest by event count)
sentry issue merge CLI-K9 CLI-15H CLI-15N

# Pin the canonical parent explicitly — accepts the same formats as
# positional args, including org-qualified and project-alias forms
sentry issue merge CLI-K9 CLI-15H CLI-15N --into CLI-K9
sentry issue merge my-org/CLI-K9 my-org/CLI-15H --into my-org/CLI-K9
sentry issue merge cli-k9 cli-15h --into cli-k9    # alias form

# Cross-org merges are rejected — all issues must share an organization
# Non-error issue types (performance, info, etc.) cannot be merged
```
