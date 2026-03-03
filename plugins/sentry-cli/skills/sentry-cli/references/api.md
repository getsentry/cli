# Api Commands

Make an authenticated API request

## `sentry api <endpoint>`

Make an authenticated API request

**Flags:**
- `-X, --method <value> - The HTTP method for the request - (default: "GET")`
- `-d, --data <value> - Inline JSON body for the request (like curl -d)`
- `-F, --field <value>... - Add a typed parameter (key=value, key[sub]=value, key[]=value)`
- `-f, --raw-field <value>... - Add a string parameter without JSON parsing`
- `-H, --header <value>... - Add a HTTP request header in key:value format`
- `--input <value> - The file to use as body for the HTTP request (use "-" to read from standard input)`
- `-i, --include - Include HTTP response status line and headers in the output`
- `--silent - Do not print the response body`
- `--verbose - Include full HTTP request and response in the output`

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

sentry api /organizations/ --include

# Get all issues (automatically follows pagination)
sentry api /projects/my-org/my-project/issues/ --paginate
```

**Expected output:**

```
HTTP/2 200
content-type: application/json
x-sentry-rate-limit-remaining: 95

[{"slug": "my-org", ...}]
```

## Workflows

### Bulk update issues
1. Find issues: `sentry api /projects/<org>/<project>/issues/?query=is:unresolved --paginate`
2. Update status: `sentry api /issues/<id>/ --method PUT --field status=resolved`
3. Assign issue: `sentry api /issues/<id>/ --method PUT --field assignedTo="user@example.com"`

### Explore the API
1. List organizations: `sentry api /organizations/`
2. List projects: `sentry api /organizations/<org>/projects/`
3. Check rate limits: `sentry api /organizations/ --include`

## JSON Recipes

- Get organization slugs: `sentry api /organizations/ | jq '.[].slug'`
- List project slugs: `sentry api /organizations/<org>/projects/ | jq '.[].slug'`
- Count issues by status: `sentry api /projects/<org>/<project>/issues/?query=is:unresolved | jq 'length'`
