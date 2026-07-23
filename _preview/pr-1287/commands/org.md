---
title: "org"
description: "Org commands for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1287/commands/org/"
---

# org

Work with Sentry organizations

## Commands

### `sentry org list`

List organizations

**Options:**

| Option | Description |
| --- | --- |
| `-n, --limit <limit>` | Maximum number of organizations to list (default: "25") |
| `-f, --fresh` | Bypass cache, re-detect projects, and fetch fresh data |

### `sentry org view <org>`

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

```bash
# List organizations
sentry org list
```


```plaintext
SLUG           NAME                 ROLE
my-org         My Organization      owner
another-org    Another Org          member
```


```bash
# View organization details
sentry org view my-org
```


```plaintext
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

## Navigation

- [Docs home](https://cli.sentry.dev/_preview/pr-1287/index.md)
- [Parent: Commands](https://cli.sentry.dev/_preview/pr-1287/commands.md)
- [Previous: monitor](https://cli.sentry.dev/_preview/pr-1287/commands/monitor.md)
- [Next: proguard](https://cli.sentry.dev/_preview/pr-1287/commands/proguard.md)
