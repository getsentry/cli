---
title: org
description: Organization commands for the Sentry CLI
---

Manage Sentry organizations.

## Commands

### `sentry org list`

List all organizations you have access to.

```bash
sentry org list
```

**Options:**

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

**Example output:**

```
SLUG           NAME                 ROLE
my-org         My Organization      owner
another-org    Another Org          member
```

**JSON output:**

```bash
sentry org list --json
```

```json
[
  {
    "slug": "my-org",
    "name": "My Organization",
    "role": "owner"
  }
]
```

### `sentry org view`

View details of a specific organization.

```bash
sentry org view <org-slug>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<org-slug>` | The organization slug |

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --web` | Open in browser |
| `--json` | Output as JSON |

**Example:**

```bash
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

**Open in browser:**

```bash
sentry org view my-org -w
```
