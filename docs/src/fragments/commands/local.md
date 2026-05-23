

`sentry local` runs a local development server that captures Sentry SDK envelopes from your dev stack and surfaces errors, traces, and logs in real time — right in your terminal. No authentication required.

If a server is already running on the port, the command attaches as an SSE consumer instead of starting a duplicate.

## Examples

```bash
# Start the server and tail events (default)
sentry local

# Run your app with the local server auto-enabled
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
| `POST` | `/stream`                       | Envelope ingest                                    |
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

Use `--quiet` to suppress tail output entirely if you only need the SSE stream.

## Agent monitoring

`sentry local` shows rich output for AI agent spans when your SDK instruments with [OpenTelemetry semantic attributes](https://opentelemetry.io/docs/specs/semconv/gen-ai/):

```
14:32:01 [TRACE]   [SERVER]  [gen_ai] chat anthropic/claude-4-sonnet [1200ms] [5 spans]
14:32:02 [TRACE]   [SERVER]  [mcp] tools/call search_files [320ms]
14:32:03 [TRACE]   [SERVER]  [db] SELECT users [postgresql] [12ms]
14:32:04 [ERROR]   [SERVER]  RateLimitError: API quota exceeded [api_client.py:42]
```

GenAI operations show the model name, MCP tool calls show the tool being invoked, and database queries show the system and query summary. This works automatically when your Sentry SDK is configured with AI/LLM integrations.

## JSON output

Use `--format json` (or `-F json`) for machine-readable NDJSON output, one JSON object per envelope item:

```bash
sentry local --format json
```

```json
{"type":"transaction","timestamp":1700000001,"op":"gen_ai","label":"chat anthropic/claude-4-sonnet","duration_ms":1200,"span_count":5,"source":"server"}
{"type":"error","timestamp":1700000002,"error_type":"RateLimitError","message":"API quota exceeded","source":"server"}
{"type":"log","timestamp":1700000003,"level":"info","message":"User logged in","attributes":{"user_id":1234},"source":"server"}
```

This is useful for AI coding agents and automation tools that need to consume Sentry events programmatically.
