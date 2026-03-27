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

### GET requests

```bash
# List organizations
sentry api /api/0/organizations/

# Get a specific issue
sentry api /api/0/issues/123456789/
```

### POST requests

```bash
# Create a release
sentry api /api/0/organizations/my-org/releases/ \
  -X POST -F version=1.0.0

# With inline JSON body
sentry api /api/0/organizations/my-org/issues/ \
  -X POST -d '{"status": "resolved"}'
```

### PUT requests

```bash
# Update an issue status
sentry api /issues/123456789/ \
  -X PUT -F status=resolved

# Assign an issue
sentry api /issues/123456789/ \
  -X PUT --field assignedTo="user@example.com"
```

### DELETE requests

```bash
sentry api /projects/my-org/my-project/ -X DELETE
```

### Advanced usage

```bash
# Add custom headers
sentry api /api/0/organizations/ -H "X-Custom: value"

# Read body from a file
sentry api /api/0/projects/my-org/my-project/releases/ -X POST --input release.json

# Verbose mode (shows full HTTP request/response)
sentry api /api/0/organizations/ --verbose

# Preview the request without sending
sentry api /api/0/organizations/ --dry-run
```

For full API documentation, see the [Sentry API Reference](https://docs.sentry.io/api/).
