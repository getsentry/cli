---
title: issue
description: Issue commands for the Sentry CLI
---

Track and manage Sentry issues.

## Commands

### `sentry issue list`

List issues in a project.

```bash
sentry issue list --org <org-slug> --project <project-slug>
```

**Options:**

| Option | Description |
|--------|-------------|
| `--org <org-slug>` | Organization slug (required) |
| `--project <project-slug>` | Project slug (required) |
| `--query <query>` | Search query |
| `--status <status>` | Filter by status (unresolved, resolved, ignored) |
| `--limit <n>` | Maximum number of issues to return |
| `--json` | Output as JSON |

**Example:**

```bash
sentry issue list --org my-org --project frontend
```

```
ID            SHORT ID    TITLE                           COUNT   USERS
123456789     FRONT-ABC   TypeError: Cannot read prop...  1.2k    234
987654321     FRONT-DEF   ReferenceError: x is not de...  456     89
```

**With search query:**

```bash
sentry issue list --org my-org --project frontend --query "TypeError"
```

### `sentry issue view`

View details of a specific issue.

```bash
# By issue ID
sentry issue view <issue-id>

# By short ID
sentry issue view <short-id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<issue-id>` | The issue ID (numeric) or short ID (e.g., PROJ-ABC) |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `--json` | Output as JSON |

**Example:**

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

**Open in browser:**

```bash
sentry issue view FRONT-ABC -w
```
