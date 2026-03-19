---
name: sentry-cli-organizations
version: 0.18.1
description: List and view Sentry organizations
requires:
  bins: ["sentry"]
  auth: true
---

# Organization Commands

Work with Sentry organizations

### `sentry org list`

List organizations

**Flags:**
- `-n, --limit <value> - Maximum number of organizations to list - (default: "30")`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
sentry org list

sentry org list --json
```

### `sentry org view <org>`

View details of an organization

**Flags:**
- `-w, --web - Open in browser`
- `-f, --fresh - Bypass cache, re-detect projects, and fetch fresh data`

**Examples:**

```bash
sentry org view <org-slug>

sentry org view my-org

sentry org view my-org -w
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
