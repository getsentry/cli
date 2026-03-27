---
title: api
description: API command for the Sentry CLI
---

Make an authenticated API request

## Usage

### `sentry api <endpoint>`

Make an authenticated API request

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<endpoint>` | API endpoint relative to /api/0/ (e.g., organizations/) |

**Options:**

| Option | Description |
|--------|-------------|
| `-X, --method <method>` | The HTTP method for the request (default: "GET") |
| `-d, --data <data>` | Inline JSON body for the request (like curl -d) |
| `-F, --field <field>...` | Add a typed parameter (key=value, key[sub]=value, key[]=value) |
| `-f, --raw-field <raw-field>...` | Add a string parameter without JSON parsing |
| `-H, --header <header>...` | Add a HTTP request header in key:value format |
| `--input <input>` | The file to use as body for the HTTP request (use "-" to read from standard input) |
| `--silent` | Do not print the response body |
| `--verbose` | Include full HTTP request and response in the output |
| `-n, --dry-run` | Show the resolved request without sending it |

All commands support `--json` for machine-readable output and `--fields` to select specific JSON fields.

<!-- GENERATED:END -->

## Examples

```bash
# GET request (default)
sentry api /api/0/organizations/

# POST with JSON body
sentry api /api/0/organizations/my-org/issues/ -X POST -d '{"status": "resolved"}'

# Pass individual fields (auto-encoded as JSON body)
sentry api /api/0/projects/my-org/my-project/ -X PUT -F name=new-name

# Add custom headers
sentry api /api/0/organizations/ -H "X-Custom: value"

# Read body from a file
sentry api /api/0/projects/my-org/my-project/releases/ -X POST -i release.json

# Preview the request without sending
sentry api /api/0/organizations/ --dry-run
```
