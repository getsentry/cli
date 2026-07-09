---
title: "Contributing"
description: "How to contribute to the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1212/contributing/"
---

# Contributing

We welcome contributions to the Sentry CLI! This guide will help you get started.

## Development Setup

[Section titled “Development Setup”](#development-setup)

### Prerequisites

[Section titled “Prerequisites”](#prerequisites)

- [Node.js](https://nodejs.org) (v22.15 or later)
- [pnpm](https://pnpm.io) (v10.11 or later)

- Git

### Getting Started

[Section titled “Getting Started”](#getting-started)
Terminal window

```
# Clone the repositorygit clone https://github.com/getsentry/cli.gitcd cli
# Install dependenciespnpm install
# Run CLI in development modepnpm run cli -- --help
# Run testspnpm run test
```


### Environment Variables

[Section titled “Environment Variables”](#environment-variables)

Create a `.env.local` file for development:

Terminal window

```
cp .env.example .env.local
```


Edit `.env.local` with your development credentials.

## Project Structure

[Section titled “Project Structure”](#project-structure)

```
cli/├── src/│   ├── bin.ts          # Entry point│   ├── app.ts          # Stricli application setup│   ├── context.ts      # Dependency injection context│   ├── commands/       # CLI commands│   │   ├── alert/       # create, delete, edit, list, view│   │   ├── auth/        # login, logout, refresh, status, token, whoami│   │   ├── build/       # download, upload│   │   ├── cli/         # defaults, feedback, fix, import, setup, uninstall, upgrade│   │   ├── code-mappings/# upload│   │   ├── dart-symbol-map/# upload│   │   ├── dashboard/   # add, create, delete, edit, list, restore, revisions, view│   │   ├── debug-files/ # bundle-jvm, bundle-sources, check, find, print-sources, upload│   │   ├── event/       # list, send, view│   │   ├── issue/       # archive, events, explain, list, merge, plan, resolve, unresolve, view│   │   ├── local/       # run, serve│   │   ├── log/         # list, view│   │   ├── monitor/     # list, run│   │   ├── org/         # list, view│   │   ├── proguard/    # upload, uuid│   │   ├── project/     # create, delete, list, view│   │   ├── react-native/# gradle, xcode│   │   ├── release/     # archive, create, delete, deploy, deploys, finalize, list, propose-version, restore, set-commits, view│   │   ├── replay/      # list, view│   │   ├── repo/        # list│   │   ├── snapshots/   # diff, download, upload│   │   ├── sourcemap/   # inject, resolve, upload│   │   ├── span/        # list, view│   │   ├── team/        # list│   │   ├── trace/       # list, logs, view│   │   ├── trial/       # list, start│   │   ├── api.ts       # Make an authenticated API request│   │   ├── explore.ts   # Query aggregate event data (Explore)│   │   ├── help.ts      # Help command│   │   ├── info.ts      # Print configuration and verify authentication│   │   ├── init.ts      # Initialize Sentry in your project (experimental)│   │   └── schema.ts    # Browse the Sentry API schema│   ├── lib/            # Shared utilities│   └── types/          # TypeScript types and Zod schemas├── test/               # Test files (mirrors src/ structure)├── script/             # Build and utility scripts├── plugins/            # Agent skill files└── docs/               # Documentation site (Astro + Starlight)
```


## Building

[Section titled “Building”](#building)
Terminal window

```
# Build for current platform (uses esbuild + fossilize for Node SEA packaging)pnpm run build
# Build for all platformspnpm run build:all
# Create npm bundlepnpm run bundle
```


## Testing

[Section titled “Testing”](#testing)
Terminal window

```
# Run all testspnpm run test
# Run specific test filepnpm run test -- test/path/to/test.ts
# Run with watch modepnpm run test -- --watch
# Run with coveragepnpm run test -- --coverage
```


## Code Style

[Section titled “Code Style”](#code-style)

The project uses [Ultracite](https://github.com/getsentry/ultracite) for linting and formatting:

Terminal window

```
# Check for issuespnpm run lint
# Auto-fix issuespnpm run lint:fix
# Type checkingpnpm run typecheck
```


## Submitting Changes

[Section titled “Submitting Changes”](#submitting-changes)

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests and linting: `pnpm run test && pnpm run lint`
5. Commit with [conventional commits](https://www.conventionalcommits.org/): `git commit -m "feat: add new feature"`
6. Push and create a pull request

## Conventional Commits

[Section titled “Conventional Commits”](#conventional-commits)

We use conventional commits for automatic changelog generation:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test changes
- `chore:` - Maintenance tasks

## Getting Help

[Section titled “Getting Help”](#getting-help)

- [GitHub Issues](https://github.com/getsentry/cli/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/getsentry/cli/discussions) - Questions and discussions
