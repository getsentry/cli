# sry

A gh-like CLI for Sentry.

## Setup

```bash
# Login via OAuth (device flow)
sry auth login
```

You'll be given a URL and a code to enter. Once you authorize, the CLI will automatically receive your token.

Or use an API token directly:

```bash
sry auth login --token YOUR_SENTRY_API_TOKEN
```

## Commands

### Auth

```bash
sry auth login      # Login via OAuth device flow
sry auth logout     # Logout
sry auth status     # Check auth status
```

### Organizations

```bash
sry org list                 # List all orgs
sry org list --json          # Output as JSON
```

### Projects

```bash
sry project list                        # List all projects
sry project list my-org                 # List projects in org
sry project list --platform javascript  # Filter by platform
```

### Issues

```bash
sry issue list --org my-org --project my-project     # List issues
sry issue list --org my-org --project my-project --json
sry issue get 123456789                              # Get issue by ID
sry issue get 123456789 --event                      # Include latest event
```

### API

```bash
sry api /organizations/                              # GET request
sry api /issues/123/ --method PUT --field status=resolved
sry api /organizations/ --include                    # Show headers
```

## Development

This is a Turborepo monorepo with:
- `packages/cli` - The sry CLI
- `apps/oauth-proxy` - OAuth proxy server (deployed on Vercel)

```bash
bun install
bun run dev --help                    # Run CLI in dev mode

# Build
cd packages/cli
bun run build                         # Build binary
```

## Config

Stored in `~/.sry/config.json` (mode 600).
