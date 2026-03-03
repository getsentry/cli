# Org Commands

Work with Sentry organizations

## `sentry org list`

List organizations

List all organizations you have access to.

**Flags:**
- `-n, --limit <value> - Maximum number of organizations to list - (default: "30")`
- `--json - Output JSON`

**Examples:**

```bash
sentry org list

sentry org list --json
```

**Expected output:**

```
SLUG           NAME                 ROLE
my-org         My Organization      owner
another-org    Another Org          member
```

## `sentry org view <org>`

View details of an organization

**Flags:**
- `--json - Output as JSON`
- `-w, --web - Open in browser`

**Examples:**

```bash
sentry org view <org-slug>

sentry org view my-org

sentry org view my-org -w
```

**Expected output:**

```
Organization: My Organization
Slug: my-org
Role: owner
Projects: 5
Teams: 3
Members: 12
```

## Shortcuts

- `sentry orgs` → shortcut for `sentry org list` (accepts the same flags)

## JSON Recipes

- Get org slugs: `sentry org list --json | jq '.[].slug'`
