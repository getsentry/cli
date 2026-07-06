---
title: "Features"
description: "Advanced features of the Sentry CLI"
url: "https://cli.sentry.dev/_preview/pr-1203/features/"
---

# Features

The Sentry CLI includes several features designed to streamline your workflow, especially in complex project setups.

## DSN Auto-Detection

[Section titled “DSN Auto-Detection”](#dsn-auto-detection)

The CLI automatically detects your Sentry project from your codebase, eliminating the need to specify the target for every command. DSN detection is one part of the [resolution priority chain](https://cli.sentry.dev/_preview/pr-1203/features/configuration.md#resolution-priority) — it runs after checking for explicit arguments, environment variables, and `.sentryclirc` config files.

### How It Works

[Section titled “How It Works”](#how-it-works)

DSN detection follows this priority order (highest first):

1. **Source code** - Explicit DSN in `Sentry.init()` calls
2. **Environment files** - `.env.local`, `.env`, etc.
3. **Environment variable** - `SENTRY_DSN`

When a DSN is found, the CLI resolves it to your organization and project, then caches the result for fast subsequent lookups.

Tip

For monorepos or when DSN detection picks up the wrong project, use a [`.sentryclirc` config file](https://cli.sentry.dev/_preview/pr-1203/features/configuration.md#configuration-file-sentryclirc) to pin your org/project explicitly.

### Supported Languages

[Section titled “Supported Languages”](#supported-languages)

The CLI can detect DSNs from source code in these languages:

| Language | File Extensions | Detection Pattern |
| --- | --- | --- |
| JavaScript/TypeScript | `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs` | `Sentry.init({ dsn: "..." })` |
| Python | `.py` | `sentry_sdk.init(dsn="...")` |
| Go | `.go` | `sentry.Init(sentry.ClientOptions{Dsn: "..."})` |
| Java | `.java` | `Sentry.init(options -> options.setDsn("..."))` |
| Ruby | `.rb` | `Sentry.init { |
| PHP | `.php` | `\\Sentry\\init(['dsn' => '...'])` |

### Caching

[Section titled “Caching”](#caching)

To avoid scanning your codebase on every command, the CLI caches:

- **DSN location** - Which file contains the DSN
- **Resolved project** - The org/project slugs from the API

The cache is validated on each run by checking if the source file still contains the same DSN. If the DSN changes or the file is deleted, a full scan is triggered.

### Usage

[Section titled “Usage”](#usage)

Once your project has a DSN configured, commands automatically use it:

Terminal window

```
# Instead of:sentry issue list my-org/my-project
# Just run:sentry issue list
```


The CLI will show which project was detected:

```
Detected project: my-app (from .env)
ID          SHORT ID    TITLE                           COUNT123456789   MYAPP-ABC   TypeError: Cannot read prop...  142
```


## Monorepo Support & Alias System

[Section titled “Monorepo Support & Alias System”](#monorepo-support--alias-system)

In monorepos with multiple Sentry projects, the CLI generates short aliases for each project, making it easy to work with issues across projects.

### How Aliases Work

[Section titled “How Aliases Work”](#how-aliases-work)

When you run `sentry issue list`, the CLI:

1. Scans for DSNs in monorepo directories (`packages/`, `apps/`, etc.)
2. Generates unique short aliases for each project
3. Caches the aliases for use with other commands

Aliases are the shortest unique prefix of each project slug. For example:

| Project Slug | Alias |
| --- | --- |
| `frontend` | `f` |
| `functions` | `fu` |
| `backend` | `b` |

For projects with a common prefix (like `spotlight-electron`, `spotlight-website`), the prefix is stripped first:

| Project Slug | Alias |
| --- | --- |
| `spotlight-electron` | `e` |
| `spotlight-website` | `w` |
| `spotlight-backend` | `b` |

### Using Alias-Suffix Format

[Section titled “Using Alias-Suffix Format”](#using-alias-suffix-format)

After running `issue list`, you can reference issues using the `alias-suffix` format:

Terminal window

```
# List issues - note the ALIAS columnsentry issue list
```


```
ALIAS  SHORT ID             TITLE                           COUNTe      SPOTLIGHT-ELEC-4Y    TypeError: Cannot read prop...  142w      SPOTLIGHT-WEB-ABC    Failed to fetch user data       89b      SPOTLIGHT-BACK-XYZ   Connection timeout              34
```


Terminal window

```
# View issue using alias-suffixsentry issue view e-4Y
# Explain using alias-suffixsentry issue explain w-ABC
# Works with any issue commandsentry issue plan b-XYZ
```


### Cross-Organization Support

[Section titled “Cross-Organization Support”](#cross-organization-support)

If you work with multiple organizations that have projects with the same slug, the CLI uses org-prefixed aliases:

```
ALIAS    SHORT ID        TITLEo1:api   ORG1-API-123    Error in API handlero2:api   ORG2-API-456    Database connection failed
```


## Issue ID Formats

[Section titled “Issue ID Formats”](#issue-id-formats)

The CLI accepts several formats for identifying issues:

### Numeric ID

[Section titled “Numeric ID”](#numeric-id)

The internal Sentry issue ID:

Terminal window

```
sentry issue view 123456789sentry issue explain 987654321
```


### Full Short ID

[Section titled “Full Short ID”](#full-short-id)

The project-prefixed short ID shown in Sentry UI:

Terminal window

```
sentry issue view MYPROJECT-ABCsentry issue explain FRONTEND-XYZ
```


### Short Suffix

[Section titled “Short Suffix”](#short-suffix)

Just the suffix portion when project context is provided via the `<org>/` prefix:

Terminal window

```
sentry issue view my-org/myproject-ABC
```


### GitHub-Style (`#` separator)

[Section titled “GitHub-Style (# separator)”](#github-style--separator)

A `#` may be used in place of the final slash, matching how issues are referenced on GitHub. This is handy for AI agents and tooling that emit `org/project#SHORTID`:

Terminal window

```
# Equivalent to my-org/my-project/PROJ-123sentry issue view my-org/my-project#PROJ-123
# Project context only (org auto-detected)sentry issue view my-project#PROJ-123
```


### Alias-Suffix

[Section titled “Alias-Suffix”](#alias-suffix)

The short alias plus suffix, available after running `issue list`:

Terminal window

```
# First, list issues to populate the alias cachesentry issue list
# Then use alias-suffix formatsentry issue view e-4Ysentry issue explain w-ABCsentry issue plan b-XYZ
```


This format is especially useful in monorepos where you're working across multiple projects.

## AI-Powered Analysis with Seer

[Section titled “AI-Powered Analysis with Seer”](#ai-powered-analysis-with-seer)

The CLI integrates with Sentry's Seer AI to provide root cause analysis and fix plans directly in your terminal.

### Root Cause Analysis

[Section titled “Root Cause Analysis”](#root-cause-analysis)

Use `sentry issue explain` to understand why an issue is happening:

Terminal window

```
sentry issue explain MYPROJECT-ABC
```


Seer analyzes:

- Stack traces and error messages
- Related events and patterns
- Your codebase (via GitHub integration)

And provides:

- Detailed root cause explanation
- Reproduction steps
- Relevant code locations

### Fix Plans

[Section titled “Fix Plans”](#fix-plans)

After understanding the root cause, use `sentry issue plan` to get actionable fix steps:

Terminal window

```
sentry issue plan MYPROJECT-ABC
```


The plan includes:

- Specific files to modify
- Code changes to make
- Implementation guidance

### Requirements

[Section titled “Requirements”](#requirements)

For Seer integration to work, you need:

1. **Seer enabled** for your organization
2. **GitHub integration** configured with repository access
3. **Code mappings** set up to link stack frames to source files

See [Sentry's Seer documentation](https://docs.sentry.io/product/issues/issue-details/ai-suggested-solution/) for setup instructions.
