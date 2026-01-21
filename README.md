# sentry

A gh-like CLI for Sentry.

## Setup

```bash
# Login via OAuth (device flow)
sentry auth login
```

You'll be given a URL and a code to enter. Once you authorize, the CLI will automatically receive your token.

Or use an API token directly:

```bash
sentry auth login --token YOUR_SENTRY_API_TOKEN
```

## Commands

### Auth

```bash
sentry auth login      # Login via OAuth device flow
sentry auth logout     # Logout
sentry auth status     # Check auth status
```

### Organizations

```bash
sentry org list                 # List all orgs
sentry org list --json          # Output as JSON
```

### Projects

```bash
sentry project list                        # List all projects
sentry project list my-org                 # List projects in org
sentry project list --platform javascript  # Filter by platform
```

### Issues

```bash
sentry issue list --org my-org --project my-project     # List issues
sentry issue list --org my-org --project my-project --json
sentry issue get 123456789                              # Get issue by ID
sentry issue get 123456789 --event                      # Include latest event
```

### API

```bash
sentry api /organizations/                              # GET request
sentry api /issues/123/ --method PUT --field status=resolved
sentry api /organizations/ --include                    # Show headers
```

## Development

```bash
bun install
bun run --env-file=.env.local src/bin.ts --help    # Run CLI in dev mode
bun run build                                       # Build binary
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed development instructions.

## Config

Stored in `~/.sentry-cli-next/config.json` (mode 600).
