---
title: api
description: Direct API access for the Sentry CLI
---

Make direct API calls to Sentry's REST API.

## Commands

### `sentry api`

Execute an API request.

```bash
sentry api <endpoint> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<endpoint>` | API endpoint path (e.g., `/organizations/`) |

**Options:**

| Option | Description |
|--------|-------------|
| `--method <method>` | HTTP method (GET, POST, PUT, DELETE). Default: GET |
| `--field <key=value>` | Add a field to the request body (can be used multiple times) |
| `--header <key:value>` | Add a custom header (can be used multiple times) |
| `--include` | Include response headers in output |
| `--paginate` | Automatically paginate through all results |

## Examples

### GET Request

```bash
# List organizations
sentry api /organizations/

# Get a specific organization
sentry api /organizations/my-org/

# Get project details
sentry api /projects/my-org/my-project/
```

### POST Request

```bash
# Create a new project
sentry api /teams/my-org/my-team/projects/ \
  --method POST \
  --field name="New Project" \
  --field platform=javascript
```

### PUT Request

```bash
# Update an issue status
sentry api /issues/123456789/ \
  --method PUT \
  --field status=resolved

# Assign an issue
sentry api /issues/123456789/ \
  --method PUT \
  --field assignedTo="user@example.com"
```

### DELETE Request

```bash
# Delete a project
sentry api /projects/my-org/my-project/ \
  --method DELETE
```

### With Headers

```bash
sentry api /organizations/ \
  --header "X-Custom-Header:value"
```

### Show Response Headers

```bash
sentry api /organizations/ --include
```

```
HTTP/2 200
content-type: application/json
x-sentry-rate-limit-remaining: 95

[{"slug": "my-org", ...}]
```

### Pagination

```bash
# Get all issues (automatically follows pagination)
sentry api /projects/my-org/my-project/issues/ --paginate
```

## API Documentation

For full API documentation, see the [Sentry API Reference](https://docs.sentry.io/api/).
