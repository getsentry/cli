---
name: sentry-cli
description: Guide for using the Sentry CLI to interact with Sentry from the command line. Use when the user asks about viewing issues, events, projects, organizations, making API calls, or authenticating with Sentry via CLI.
---

# Sentry CLI Usage Guide

Help users interact with Sentry from the command line using the `sentry` CLI.

## Prerequisites

The CLI must be installed and authenticated before use.

### Installation

```bash
curl https://cli.sentry.dev/install -fsS | bash
curl https://cli.sentry.dev/install -fsS | bash -s -- --version nightly
brew install getsentry/tools/sentry

# Or install via npm/pnpm/bun
npm install -g sentry
```

### Authentication

```bash
sentry auth login
sentry auth login --token YOUR_SENTRY_API_TOKEN
sentry auth status
sentry auth logout
```

## Available Commands

| Command | Description | Reference |
|---------|-------------|-----------|
| `sentry auth` | Authenticate with Sentry | [Auth commands](references/auth.md) |
| `sentry org` | Work with Sentry organizations | [Org commands](references/org.md) |
| `sentry project` | Work with Sentry projects | [Project commands](references/project.md) |
| `sentry issue` | Manage Sentry issues | [Issue commands](references/issue.md) |
| `sentry event` | View Sentry events | [Event commands](references/event.md) |
| `sentry api` | Make an authenticated API request | [Api commands](references/api.md) |
| `sentry cli` | CLI-related commands | [Cli commands](references/cli.md) |
| `sentry repo` | Work with Sentry repositories | [Repo commands](references/repo.md) |
| `sentry team` | Work with Sentry teams | [Team commands](references/team.md) |
| `sentry log` | View Sentry logs | [Log commands](references/log.md) |
| `sentry trace` | View distributed traces | [Trace commands](references/trace.md) |
| `sentry init` | Initialize Sentry in your project | [Init commands](references/init.md) |

## Output Formats

### JSON Output

Most list and view commands support `--json` flag for JSON output, making it easy to integrate with other tools:

```bash
sentry org list --json | jq '.[] | .slug'
```

### Opening in Browser

View commands support `-w` or `--web` flag to open the resource in your browser:

```bash
sentry issue view PROJ-123 -w
```
