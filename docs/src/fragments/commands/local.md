

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

# Open the SSE endpoint in a browser on startup
sentry local --open
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

By default, every envelope received is logged as a single line:

```
14:32:01.456 • event+attachment
```

The label is the joined list of envelope item types (`event`, `transaction`, `log`, `attachment`, etc.). Use `--quiet` to suppress this output if you only need the SSE stream for the Spotlight overlay.
