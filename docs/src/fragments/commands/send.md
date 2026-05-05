

## Examples

### Send an event from flags

```bash
# Send an error event (default level)
sentry send event -m "Something went wrong"

# Specify level, release, and environment
sentry send event -m "Deploy check" -l info -r 1.0.0 -E production

# Add tags and extra data
sentry send event -m "Payment failed" --tag env:prod --tag region:us-east --extra amount:99.99

# Set user context
sentry send event -m "Login error" --user id:42 --user email:alice@example.com

# Custom fingerprint to group related events together
sentry send event -m "DB timeout" --fingerprint db-timeout --fingerprint {{ default }}
```

### Send an event from a JSON file

```bash
# Send a serialized Sentry Event object
sentry send event ./crash.json

# Send without re-parsing (raw mode)
sentry send event --raw ./crash.json
```

### Send a pre-built envelope

```bash
# Send a captured Sentry envelope file
sentry send envelope ./captured.envelope

# Send without validation (raw mode)
sentry send envelope --raw ./binary.envelope

# Send multiple envelope files
sentry send envelope ./a.envelope ./b.envelope
```

## DSN authentication

`sentry send` commands authenticate via a **DSN** rather than a user token.
No `sentry auth login` is required.

The DSN is resolved in priority order:

1. `--dsn <value>` flag (explicit)
2. `SENTRY_DSN` environment variable
3. Auto-detected from `.env` files and project source code

```bash
# Explicit DSN
sentry send event -m "Test" --dsn "https://key@o123.ingest.us.sentry.io/456"

# Via environment variable
export SENTRY_DSN="https://key@o123.ingest.us.sentry.io/456"
sentry send event -m "Test"
```

## Backward compatibility

The old sentry-cli top-level commands are available as hidden aliases:

```bash
sentry send-event    # same as: sentry send event
sentry send-envelope # same as: sentry send envelope
```
