# Team Commands

Work with Sentry teams

## `sentry team list <org/project>`

List teams

**Flags:**
- `-n, --limit <value> - Maximum number of teams to list - (default: "30")`
- `--json - Output JSON`
- `-c, --cursor <value> - Pagination cursor (use "last" to continue from previous page)`

**Examples:**

```bash
# Auto-detect organization or list all
sentry team list

# List teams in a specific organization
sentry team list <org-slug>

# Limit results
sentry team list --limit 10

sentry team list --json
```

**Expected output:**

```
ORG         SLUG        NAME              MEMBERS
my-org      backend     Backend Team            8
my-org      frontend    Frontend Team           5
my-org      mobile      Mobile Team             3
```

## Shortcuts

- `sentry teams` → shortcut for `sentry team list` (accepts the same flags)

## Workflows

### Find teams and their projects
1. List teams: `sentry team list`
2. Get team details via API: `sentry api /teams/<org>/<team>/`
3. List team projects: `sentry api /teams/<org>/<team>/projects/`

## JSON Recipes

- Get team slugs: `sentry team list --json | jq '.[].slug'`
- Count teams: `sentry team list --json | jq 'length'`
