---
title: team
description: Team commands for the Sentry CLI
---

Manage Sentry teams.

## Commands

### `sentry team list`

List teams in an organization.

```bash
# Auto-detect organization or list all
sentry team list

# List teams in a specific organization
sentry team list <org-slug>

# Limit results
sentry team list --limit 10
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[org-slug]` | Optional organization slug to filter by |

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <number>` | Maximum number of teams to list (default: 30) |
| `--json` | Output as JSON |

**Example output:**

```
ORG         SLUG        NAME              MEMBERS
my-org      backend     Backend Team            8
my-org      frontend    Frontend Team           5
my-org      mobile      Mobile Team             3
```

**JSON output:**

```bash
sentry team list --json
```

```json
[
  {
    "id": "100",
    "slug": "backend",
    "name": "Backend Team",
    "memberCount": 8
  }
]
```
