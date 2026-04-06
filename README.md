<p align="center">
  <img src=".github/assets/banner.png" alt="Sentry CLI" />
</p>

<p align="center">
  The command-line interface for Sentry. Built for developers and AI agents.
</p>

<p align="center">
  <a href="https://cli.sentry.dev">Documentation</a> |
  <a href="https://cli.sentry.dev/getting-started/">Getting Started</a> |
  <a href="https://cli.sentry.dev/commands/">Commands</a>
</p>

---

## Installation

### Install Script (Recommended)

```bash
curl https://cli.sentry.dev/install -fsS | bash
```

### Homebrew

```bash
brew install getsentry/tools/sentry
```

### Package Managers

```bash
npm install -g sentry
pnpm add -g sentry
bun add -g sentry
```

### Run Without Installing

```bash
npx sentry@latest
```

## Quick Start

```bash
# Authenticate with Sentry
sentry auth login

# List issues (auto-detects project from your codebase)
sentry issue list

# Get AI-powered root cause analysis
sentry issue explain PROJ-ABC

# Generate a fix plan
sentry issue plan PROJ-ABC
```

## Features

- **DSN Auto-Detection** - Automatically detects your project from `.env` files or source code. No flags needed.
- **Seer AI Integration** - Get root cause analysis and fix plans directly in your terminal.
- **Monorepo Support** - Works with multiple projects, generates short aliases for easy navigation.
- **JSON Output** - All commands support `--json` for scripting and pipelines.
- **Open in Browser** - Use `-w` flag to open any resource in your browser.

## Commands

| Command | Description |
|---------|-------------|
| `sentry auth` | Login, logout, check authentication status |
| `sentry org` | List and view organizations |
| `sentry project` | List, view, create, and delete projects |
| `sentry issue` | List, view, explain, plan issues, and list events |
| `sentry event` | View event details |
| `sentry trace` | List and view distributed traces |
| `sentry span` | List and view spans |
| `sentry log` | List and view logs (with streaming) |
| `sentry release` | Create, finalize, deploy, and manage releases |
| `sentry dashboard` | List, view, create dashboards and manage widgets |
| `sentry sourcemap` | Inject debug IDs and upload sourcemaps |
| `sentry team` | List teams in an organization |
| `sentry repo` | List repositories in an organization |
| `sentry trial` | List and start product trials |
| `sentry init` | Initialize Sentry in your project |
| `sentry schema` | Browse the Sentry API schema |
| `sentry api` | Make direct API requests |
| `sentry cli` | Upgrade, setup, fix, and send feedback |

For detailed documentation, visit [cli.sentry.dev](https://cli.sentry.dev).

## Configuration

Credentials are stored in `~/.sentry/` with restricted permissions (mode 600).

## Library Usage

Use Sentry CLI programmatically in Node.js (≥22) or Bun without spawning a subprocess:

```typescript
import createSentrySDK from "sentry";

const sdk = createSentrySDK({ token: "sntrys_..." });

// Typed methods for every CLI command
const orgs = await sdk.org.list();
const issues = await sdk.issue.list({ orgProject: "acme/frontend", limit: 5 });
const issue = await sdk.issue.view({ issue: "ACME-123" });

// Nested commands
await sdk.dashboard.widget.add({ display: "line", query: "count" }, "my-org/my-dashboard");

// Escape hatch for any CLI command
const version = await sdk.run("--version");
const text = await sdk.run("issue", "list", "-l", "5");
```

Options (all optional):
- `token` — Auth token. Falls back to `SENTRY_AUTH_TOKEN` / `SENTRY_TOKEN` env vars.
- `url` — Sentry instance URL for self-hosted (e.g., `"sentry.example.com"`).
- `org` — Default organization slug (avoids passing it on every call).
- `project` — Default project slug.
- `text` — Return human-readable string instead of parsed JSON (affects `run()` only).
- `cwd` — Working directory for DSN auto-detection. Defaults to `process.cwd()`.
- `signal` — `AbortSignal` to cancel streaming commands (`--follow`, `--refresh`).

Streaming commands return `AsyncIterable` — use `for await...of` and `break` to stop.

Errors are thrown as `SentryError` with `.exitCode` and `.stderr`.

---

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.0+

### Setup

```bash
git clone https://github.com/getsentry/cli.git
cd cli
bun install
```

### Running Locally

```bash
# Run CLI in development mode
bun run dev --help

# With environment variables
bun run --env-file=.env.local src/bin.ts --help
```

### Scripts

```bash
bun run build        # Build for current platform
bun run typecheck    # Type checking
bun run lint         # Check for issues
bun run lint:fix     # Auto-fix issues
bun test             # Run tests
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed setup and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

[FSL-1.1-Apache-2.0](LICENSE.md)
