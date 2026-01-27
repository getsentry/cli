---
title: Contributing
description: How to contribute to the Sentry CLI
---

We welcome contributions to the Sentry CLI! This guide will help you get started.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0 or later)
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/getsentry/cli.git
cd cli

# Install dependencies
bun install

# Run CLI in development mode
bun run --env-file=.env.local src/bin.ts --help

# Run tests
bun test
```

### Environment Variables

Create a `.env.local` file for development:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your development credentials.

## Project Structure

```
cli/
├── src/
│   ├── bin.ts          # Entry point
│   ├── app.ts          # Stricli application setup
│   ├── context.ts      # Dependency injection context
│   ├── commands/       # CLI commands
│   │   ├── auth/       # Authentication commands
│   │   ├── org/        # Organization commands
│   │   ├── project/    # Project commands
│   │   ├── issue/      # Issue commands
│   │   └── event/      # Event commands
│   ├── lib/            # Shared utilities
│   └── types/          # TypeScript types and Zod schemas
├── test/               # Test files
├── script/             # Build scripts
└── docs/               # Documentation site
```

## Building

```bash
# Build for current platform
bun run build

# Build for all platforms
bun run build:all

# Create npm bundle
bun run bundle
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test test/path/to/test.ts

# Run with watch mode
bun test --watch

# Run with coverage
bun test --coverage
```

## Code Style

The project uses [Ultracite](https://github.com/getsentry/ultracite) for linting and formatting:

```bash
# Check for issues
bun run lint

# Auto-fix issues
bun run lint:fix

# Type checking
bun run typecheck
```

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests and linting: `bun test && bun run lint`
5. Commit with [conventional commits](https://www.conventionalcommits.org/): `git commit -m "feat: add new feature"`
6. Push and create a pull request

## Conventional Commits

We use conventional commits for automatic changelog generation:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test changes
- `chore:` - Maintenance tasks

## Getting Help

- [GitHub Issues](https://github.com/getsentry/cli/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/getsentry/cli/discussions) - Questions and discussions
