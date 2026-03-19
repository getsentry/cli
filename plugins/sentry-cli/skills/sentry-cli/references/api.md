---
name: sentry-cli-api
version: 0.18.1
description: Make arbitrary Sentry API requests
requires:
  bins: ["sentry"]
  auth: true
---

# API Command

Make an authenticated API request

### `sentry api <endpoint>`

Make an authenticated API request

**Flags:**
- `-X, --method <value> - The HTTP method for the request - (default: "GET")`
- `-d, --data <value> - Inline JSON body for the request (like curl -d)`
- `-F, --field <value>... - Add a typed parameter (key=value, key[sub]=value, key[]=value)`
- `-f, --raw-field <value>... - Add a string parameter without JSON parsing`
- `-H, --header <value>... - Add a HTTP request header in key:value format`
- `--input <value> - The file to use as body for the HTTP request (use "-" to read from standard input)`
- `--silent - Do not print the response body`
- `--verbose - Include full HTTP request and response in the output`
- `-n, --dry-run - Show the resolved request without sending it`

**Examples:**

```bash
sentry api <endpoint> [options]

# List organizations
sentry api /organizations/

# Get a specific organization
sentry api /organizations/my-org/

# Get project details
sentry api /projects/my-org/my-project/

# Create a new project
sentry api /teams/my-org/my-team/projects/ \
  --method POST \
  --field name="New Project" \
  --field platform=javascript

# Update an issue status
sentry api /issues/123456789/ \
  --method PUT \
  --field status=resolved

# Assign an issue
sentry api /issues/123456789/ \
  --method PUT \
  --field assignedTo="user@example.com"

# Delete a project
sentry api /projects/my-org/my-project/ \
  --method DELETE

sentry api /organizations/ \
  --header "X-Custom-Header:value"

sentry api /organizations/ --verbose

# Get all issues (automatically follows pagination)
sentry api /projects/my-org/my-project/issues/ --paginate
```

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
