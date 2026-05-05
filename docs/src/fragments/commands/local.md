

[Spotlight](https://spotlightjs.com) is "Sentry for Development" — a lightweight local proxy that ingests Sentry envelopes from SDKs running in your dev stack and surfaces them in real time. `sentry local` runs a minimal [Hono](https://hono.dev/) HTTP server that's wire-compatible with Spotlight's sidecar protocol, so your existing SDKs and the [Spotlight overlay](https://spotlightjs.com/about/) work without any changes.

No authentication is required — the sidecar binds to `localhost` by default and is purely a development tool.

## Examples

```bash
# Start the sidecar on the default port (8969)
sentry local

# Use a custom port and bind to all interfaces
sentry local --port 9000 --host 0.0.0.0

# Run quietly (suppress per-envelope tail output)
sentry local --quiet

# Only show errors and logs (filter out transactions)
sentry local -f error -f log
```

## Endpoints

| Method | Path                            | Description                                        |
|--------|---------------------------------|----------------------------------------------------|
| `POST` | `/stream`                       | Spotlight-compatible envelope ingest               |
| `POST` | `/api/{projectId}/envelope/`    | Sentry SDK ingest path                             |
| `GET`  | `/stream`                       | Server-Sent Events feed of incoming envelopes      |
| `GET`  | `/health`                       | Liveness check (returns `OK`)                      |

## Pointing your SDK at the sidecar

Set a localhost DSN that resolves to the sidecar's port — the public key and project ID can be any non-empty value because the sidecar accepts everything:

```bash
SENTRY_DSN=http://public@localhost:8969/1
```

Or configure your SDK's transport explicitly to send envelopes to `http://localhost:8969/stream`.

## Tail output

By default, incoming envelopes are pretty-printed to the terminal:

```
14:32:01  error  server   TypeError: x is not a function [app.ts:42:5] [handleRequest]
14:32:02  trace  browser  [http.client] GET /api/users [245ms] [3 spans]
14:32:03  info   server   User logged in [user_id=1234]
```

Errors show the exception type, message, and top stack frame. Transactions show the operation, duration, and span count. Logs show the severity level, message, and custom attributes.

Use `--filter` / `-f` to narrow the output to specific event types (repeatable):

```bash
sentry local -f error -f log    # only errors and logs
```

Use `--quiet` to suppress tail output entirely if you only need the SSE stream for the Spotlight overlay.
