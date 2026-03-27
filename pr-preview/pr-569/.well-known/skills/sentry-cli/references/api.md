---
name: sentry-cli-api
version: 0.21.0-dev.0
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

All commands also support `--json`, `--fields`, `--help`, `--log-level`, and `--verbose` flags.
