

[Spotlight](https://spotlightjs.com) is "Sentry for Development" — a lightweight local proxy that ingests Sentry envelopes from SDKs running in your dev stack and surfaces them in real time. `sentry local` runs a minimal [Hono](https://hono.dev/) HTTP server that's wire-compatible with Spotlight's protocol, so your existing SDKs and the [Spotlight overlay](https://spotlightjs.com/about/) work without any changes.

No authentication is required — the server binds to `localhost` by default and is purely a development tool.

## Examples

```bash
# Start the server and tail events (default)
sentry local

# Run your app with Spotlight auto-enabled
sentry local run -- npm run dev
sentry local run -- python manage.py runserver

# Use a custom port
sentry local --port 9000

# Only show errors and logs (filter out transactions)
sentry local -f error -f log

# Run quietly (suppress per-envelope tail output)
sentry local --quiet
```

## `sentry local run`

Runs a command with `SENTRY_SPOTLIGHT` injected into the environment. The Sentry SDK automatically detects this variable and sends envelopes to the local server. No code changes needed.

Env vars injected into the child process:

| Variable | Value |
|----------|-------|
| `SENTRY_SPOTLIGHT` | `http://localhost:<port>/stream` |
| `NEXT_PUBLIC_SENTRY_SPOTLIGHT` | `http://localhost:<port>/stream` |
| `SENTRY_TRACES_SAMPLE_RATE` | `1` |

## Endpoints

| Method | Path                            | Description                                        |
|--------|---------------------------------|----------------------------------------------------|
| `POST` | `/stream`                       | Spotlight-compatible envelope ingest               |
| `POST` | `/api/{projectId}/envelope/`    | Sentry SDK ingest path                             |
| `GET`  | `/stream`                       | Server-Sent Events feed of incoming envelopes      |
| `GET`  | `/health`                       | Liveness check (returns `OK`)                      |

## Tail output

By default, incoming envelopes are pretty-printed to the terminal:

```
14:32:01 [ERROR]   [SERVER]  TypeError: x is not a function [app.ts:42:5] [handleRequest]
14:32:02 [TRACE]   [BROWSER] [http.client] GET /api/users [245ms] [3 spans]
14:32:03 [INFO]    [SERVER]  User logged in [user_id=1234] [region=us]
```

Errors show the exception type, message, and top stack frame. Transactions show the operation, duration, and span count. Logs show the severity level, message, and custom attributes.

Use `--filter` / `-f` to narrow the output to specific event types (repeatable):

```bash
sentry local -f error -f log    # only errors and logs
```

Use `--quiet` to suppress tail output entirely if you only need the SSE stream for the Spotlight overlay.
