---
title: Agentic Usage
description: Enable AI coding agents to use the Sentry CLI
---

AI coding agents like Claude Code can use the Sentry CLI through the skill system. This allows agents to interact with Sentry directly from your development environment.

## Adding the Skill

Add the Sentry CLI skill to your agent:

```bash
npx skills add https://cli.sentry.dev
```

This registers the Sentry CLI as a skill that your agent can invoke when needed.

## Capabilities

With this skill, agents can:

- **View issues** - List and inspect Sentry issues from your projects
- **Inspect events** - Look at specific error events and their details
- **Browse projects** - List projects and organizations you have access to
- **Make API calls** - Execute arbitrary Sentry API requests
- **Authenticate** - Help you set up CLI authentication

## How It Works

When you ask your agent about Sentry errors or want to investigate an issue, the agent can use this skill to fetch real data from your Sentry account. For example:

- "Show me the latest issues in my project"
- "What's the stack trace for ISSUE-123?"
- "List all projects in my organization"

The skill uses your existing CLI authentication, so you'll need to run `sentry auth login` first if you haven't already.

## Requirements

- An authenticated Sentry CLI installation (`sentry auth login`)
- An AI coding agent that supports the skills system (e.g., Claude Code)
