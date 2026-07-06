---
title: "api"
description: "API command for the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1201/commands/api/"
---

# api

Make an authenticated API request

## Usage

[Section titled “Usage”](#usage)

### `sentry api <endpoint>`

[Section titled “sentry api <endpoint>”](#sentry-api-endpoint)

Make an authenticated API request

**Arguments:**

| Argument | Description |
| --- | --- |
| `<endpoint>` | API endpoint relative to /api/0/ (e.g., organizations/) |

**Options:**

| Option | Description |
| --- | --- |
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

## Examples

[Section titled “Examples”](#examples)

Endpoints are relative to `/api/0/` — the prefix is added automatically.

### GET requests

[Section titled “GET requests”](#get-requests)
Terminal window

```
# List organizationssentry api organizations/
# Get a specific issuesentry api issues/123456789/
```


### POST requests

[Section titled “POST requests”](#post-requests)
Terminal window

```
# Create a releasesentry api organizations/my-org/releases/ \  -X POST -F version=1.0.0
# With inline JSON bodysentry api issues/123456789/ \  -X POST -d '{"status": "resolved"}'
```


### PUT requests

[Section titled “PUT requests”](#put-requests)
Terminal window

```
# Update an issue statussentry api issues/123456789/ \  -X PUT -F status=resolved
# Assign an issuesentry api issues/123456789/ \  -X PUT --field assignedTo="user@example.com"
```


### DELETE requests

[Section titled “DELETE requests”](#delete-requests)
Terminal window

```
sentry api projects/my-org/my-project/ -X DELETE
```


### Advanced usage

[Section titled “Advanced usage”](#advanced-usage)
Terminal window

```
# Add custom headerssentry api organizations/ -H "X-Custom: value"
# Read body from a filesentry api projects/my-org/my-project/releases/ -X POST --input release.json
# Verbose mode (shows full HTTP request/response)sentry api organizations/ --verbose
# Preview the request without sendingsentry api organizations/ --dry-run
```


### Dataset Names

[Section titled “Dataset Names”](#dataset-names)

When querying the Events API (`/events/` endpoint), valid dataset values are: `spans`, `transactions`, `logs`, `errors`, `discover`.

For full API documentation, see the [Sentry API Reference](https://docs.sentry.io/api/).
