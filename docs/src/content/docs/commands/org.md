---
title: org
description: Org commands for the Sentry CLI
---

Work with Sentry organizations

## Commands

### `sentry org list`

List organizations

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <limit>` | Maximum number of organizations to list (default: "30") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry org view <org>`

View details of an organization

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org>` | Organization slug (optional if auto-detected) (optional) |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# List organizations
sentry org list
```

```
SLUG           NAME                 ROLE
my-org         My Organization      owner
another-org    Another Org          member
```

```bash
# View organization details
sentry org view my-org
```

```
Organization: My Organization
Slug: my-org
Role: owner
Projects: 5
Teams: 3
Members: 12
```

```bash
# Open in browser
sentry org view my-org -w

# JSON output
sentry org list --json
```
