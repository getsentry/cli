# Init Commands

Initialize Sentry in your project

## `sentry init <directory>`

Initialize Sentry in your project

**Flags:**
- `--force - Continue even if Sentry is already installed`
- `-y, --yes - Non-interactive mode (accept defaults)`
- `--dry-run - Preview changes without applying them`
- `--features <value> - Comma-separated features: errors,tracing,logs,replay,metrics`

**Examples:**

```bash
# Run the wizard in the current directory
sentry init

# Target a subdirectory
sentry init ./my-app

# Preview what changes would be made
sentry init --dry-run

# Select specific features
sentry init --features errors,tracing,logs

# Non-interactive mode (accept all defaults)
sentry init --yes
```

## What the wizard does

1. **Detects your framework** — scans your project files to identify the platform and framework
2. **Installs the SDK** — adds the appropriate Sentry SDK package to your project
3. **Instruments your code** — configures error monitoring, tracing, and any selected features

## Supported platforms

The wizard currently supports:

- **JavaScript / TypeScript** — Next.js, Express, SvelteKit, React
- **Python** — Flask, FastAPI

More platforms and frameworks are coming soon.

## Workflows

### Set up a new project
1. Navigate to project: `cd my-app`
2. Authenticate: `sentry auth login`
3. Preview changes: `sentry init --dry-run`
4. Run the wizard: `sentry init`

### Non-interactive CI setup
1. `sentry auth login --token $SENTRY_TOKEN`
2. `sentry init --yes --features errors,tracing`
