# Repo Commands

Work with Sentry repositories

## `sentry repo list <org/project>`

List repositories

**Flags:**
- `-n, --limit <value> - Maximum number of repositories to list - (default: "30")`
- `--json - Output JSON`
- `-c, --cursor <value> - Pagination cursor (use "last" to continue from previous page)`

## Shortcuts

- `sentry repos` → shortcut for `sentry repo list` (accepts the same flags)

## Workflows

### Check linked repositories
1. List repos: `sentry repo list`
2. Get details as JSON: `sentry repo list --json`
3. Use the API for more details: `sentry api /organizations/<org>/repos/`

## JSON Recipes

- Get repo names: `sentry repo list --json | jq '.[].name'`
- Get repo providers: `sentry repo list --json | jq '.[] | {name, provider}'`
