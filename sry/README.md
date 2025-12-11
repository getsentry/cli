# sry

A gh-like CLI for Sentry.

## Setup

```bash
# Set OAuth credentials
export SRY_CLIENT_ID="your-client-id"
export SRY_CLIENT_SECRET="your-client-secret"

# Login
sry auth login
```

Or use an API token:

```bash
sry auth login --token YOUR_SENTRY_API_TOKEN
```

## Commands

### Auth

```bash
sry auth login      # Login via OAuth
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

### DSN Detection

```bash
sry dsn detect       # Find Sentry DSN in current project
```

## Build

```bash
bun install
bun run dev --help                    # Run in dev mode
npx fossilize src/bin.ts              # Build binary
codesign --sign - dist-bin/bin-*      # Sign for macOS
```

## Config

Stored in `~/.sry/config.json` (mode 600).
