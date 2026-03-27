---
name: sentry-cli-teams
version: 0.22.0
description: List teams and repositories in a Sentry organization
requires:
  bins: ["sentry"]
  auth: true
---

# Team & Repository Commands

Work with Sentry repositories

Work with Sentry teams

### `sentry repo list <org/project>`

List repositories

**Flags:**
- `-n, --limit <value> - Maximum number of repositories to list - (default: "30")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Repository ID |
| `name` | string | Repository name |
| `url` | string \| null | Repository URL |
| `provider` | object | Version control provider |
| `status` | string | Integration status |
| `dateCreated` | string | Creation date (ISO 8601) |
| `integrationId` | string | Integration ID |
| `externalSlug` | string \| null | External slug (e.g. org/repo) |
| `externalId` | string \| null | External ID |

**Examples:**

```bash
# List repositories (auto-detect org)
sentry repo list

# List repos in a specific org with pagination
sentry repo list my-org/ -c next

# Output as JSON
sentry repo list --json
```

### `sentry team list <org/project>`

List teams

**Flags:**
- `-n, --limit <value> - Maximum number of teams to list - (default: "30")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`
- `-c, --cursor <value> - Navigate pages: "next", "prev", "first" (or raw cursor string)`

**JSON Fields** (use `--json --fields` to select specific fields):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Team ID |
| `slug` | string | Team slug |
| `name` | string | Team name |
| `dateCreated` | string | Creation date (ISO 8601) |
| `isMember` | boolean | Whether you are a member |
| `teamRole` | string \| null | Your role in the team |
| `memberCount` | number | Number of members |

**Examples:**

```bash
# List teams
sentry team list my-org/

# Paginate through teams
sentry team list my-org/ -c next

# Output as JSON
sentry team list --json
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
