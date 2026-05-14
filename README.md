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

Requires **Node.js 22.12+** for npm/pnpm/yarn installs.

```bash
npm install -g sentry
pnpm add -g sentry
yarn global add sentry
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

Run `sentry --help` to see all available commands, or browse the [command reference](https://cli.sentry.dev/commands/).

## Configuration

Credentials are stored in `~/.sentry/` with restricted permissions (mode 600).

## Library Usage

<!-- GENERATED:START library-prereq -->
Use Sentry CLI programmatically in Node.js (≥22.12) or Bun without spawning a subprocess:
<!-- GENERATED:END library-prereq -->

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

<!-- GENERATED:START dev-prereq -->
- [Bun](https://bun.sh) v1.3+
<!-- GENERATED:END dev-prereq -->

### Setup

```bash
git clone https://github.com/getsentry/cli.git
cd cli
bun install
```

### Running Locally

```bash
# Run CLI in development mode
bun run cli --help

# With environment variables
bun run --env-file=.env.local cli --help
```

### Scripts

<!-- GENERATED:START dev-scripts -->
```bash
bun run build         # Build for current platform
bun run typecheck     # Type checking
bun run lint          # Check for issues
bun run lint:fix      # Auto-fix issues
bun run test:unit     # Run unit tests
bun run test:e2e      # Run end-to-end tests
bun run generate:docs # Regenerate command docs and skills
```
<!-- GENERATED:END dev-scripts -->

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed setup and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

[FSL-1.1-Apache-2.0](LICENSE.md)
