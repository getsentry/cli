---
title: "Installation"
description: "How to install and set up the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1218/getting-started/"
---

# Installation

## Install Script

Install the latest stable release:

```bash
curl https://cli.sentry.dev/install -fsS | bash
```

Install the nightly build (built from `main`, updated on every commit):

```bash
curl https://cli.sentry.dev/install -fsS | bash -s -- --version nightly
```

You can also use the `SENTRY_VERSION` environment variable to pin a version,
which is especially useful in CI/CD pipelines and Dockerfiles:

```bash
# Pin to a specific stable version
SENTRY_VERSION=0.19.0 curl https://cli.sentry.dev/install -fsS | bash

# Pin to nightly
SENTRY_VERSION=nightly curl https://cli.sentry.dev/install -fsS | bash
```

The `--version` flag takes precedence over `SENTRY_VERSION` if both are set.
The chosen channel is persisted so that `sentry cli upgrade` automatically
tracks the same channel on future updates.

### Supported Platforms

{/* GENERATED:START platform-support */}

      OS
      Architectures
      Notes
    
      macOS
      x64, arm64 (Apple Silicon)
      
      Linux
      x64, arm64
      glibc and musl (Alpine)
    
      Windows
      x64
      Via Git Bash, MSYS2, or WSL
    
{/* GENERATED:END platform-support */}

## Homebrew

```bash
brew install getsentry/tools/sentry
```

## Package Managers

Install globally with your preferred package manager (the npm/pnpm/yarn packages require **Node.js 22.15+**):

<PackageManagerCode
  npm="npm install -g sentry"
  pnpm="pnpm add -g sentry"
  yarn="yarn global add sentry"
  bun="bun add -g sentry"
/>

Unlike the install script and Homebrew, package manager installs don't set up shell completions or agent skills. Run `sentry cli setup` once to enable them:

```bash
sentry cli setup
```

Or run directly without installing:

<PackageManagerCode
  npm="npx sentry --help"
  pnpm="pnpm dlx sentry --help"
  yarn="yarn dlx sentry --help"
  bun="bunx sentry --help"
/>

## Authentication

### OAuth Device Flow (Recommended)

The easiest way to authenticate is via OAuth device flow:

```bash
sentry auth login
```

You'll be given a URL and a code to enter. Once you authorize the application in your browser, the CLI will automatically receive your token.

### API Token

Alternatively, you can use an API token directly:

```bash
sentry auth login --token YOUR_SENTRY_API_TOKEN
```

You can create API tokens in your [Sentry account settings](https://sentry.io/settings/account/api/auth-tokens/).

### Check Auth Status

Verify your authentication status:

```bash
sentry auth status
```

### Logout

To remove stored credentials:

```bash
sentry auth logout
```

## Self-Hosted Sentry

Using a self-hosted Sentry instance? Set `SENTRY_URL` to point at it:

```bash
SENTRY_URL=https://sentry.example.com sentry auth login
```

See the [Self-Hosted](https://cli.sentry.dev/_preview/pr-1218/self-hosted.md) guide for full setup details.

## Configuration

Credentials are stored in a SQLite database at `~/.sentry/` with restricted file permissions (mode 600) for security. See [Configuration](https://cli.sentry.dev/_preview/pr-1218/configuration.md) for environment variables and customization options.

## Next Steps

Once authenticated, you can start using the CLI:

- [Initialize Sentry](https://cli.sentry.dev/_preview/pr-1218/commands/init.md) - Set up Sentry in your project with the guided wizard
- [Organization commands](https://cli.sentry.dev/_preview/pr-1218/commands/org.md) - List and view organizations
- [Project commands](https://cli.sentry.dev/_preview/pr-1218/commands/project.md) - Manage projects
- [Issue commands](https://cli.sentry.dev/_preview/pr-1218/commands/issue.md) - Track and manage issues
- [Event commands](https://cli.sentry.dev/_preview/pr-1218/commands/event.md) - Inspect events
- [API commands](https://cli.sentry.dev/_preview/pr-1218/commands/api.md) - Direct API access
- [Agentic Usage](https://cli.sentry.dev/_preview/pr-1218/agentic-usage.md) - Enable AI coding agents to use the CLI
