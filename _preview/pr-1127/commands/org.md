---
title: "org"
description: "Org commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1127/commands/org/"
---

# org

Work with Sentry organizations

## Commands

[Section titled “Commands”](#commands)

### `sentry org list`

[Section titled “sentry org list”](#sentry-org-list)

List organizations

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Maximum number of organizations to list (default: "25") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry org view <org>`

[Section titled “sentry org view <org>”](#sentry-org-view-org)

View details of an organization

**Arguments:**

| Argument | Description |
| --- | --- |
| `<org>` | Organization slug (optional if auto-detected) |

**Options:**

| Option | Description |
| --- | --- |
| `-w, --web` | Open in browser |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

## Examples

[Section titled “Examples”](#examples)
Terminal window

```
# List organizationssentry org list
```


```
SLUG           NAME                 ROLEmy-org         My Organization      owneranother-org    Another Org          member
```


Terminal window

```
# View organization detailssentry org view my-org
```


```
Organization: My OrganizationSlug: my-orgRole: ownerProjects: 5Teams: 3Members: 12
```


Terminal window

```
# Open in browsersentry org view my-org -w
# JSON outputsentry org list --json
```
