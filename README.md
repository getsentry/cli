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
sentry org view my-org          # View organization details
sentry org view my-org -w       # Open organization in browser
```

### Projects

```bash
sentry project list                        # List all projects
sentry project list my-org                 # List projects in org
sentry project list --platform javascript  # Filter by platform
sentry project view my-project             # View project details
sentry project view my-project -w          # Open project in browser
```

### Issues

```bash
sentry issue list --org my-org --project my-project     # List issues
sentry issue list --org my-org --project my-project --json
sentry issue view 123456789                             # View issue by ID
sentry issue view PROJ-ABC                              # View issue by short ID
sentry issue view 123456789 -w                          # Open issue in browser
```

### Events

```bash
sentry event view abc123def                              # View event by ID
sentry event view abc123def -w                           # Open event in browser
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

Stored in `~/.sentry/config.json` (mode 600).
