# Sentry CLI Skills

Agent skills for using the Sentry CLI, following the [Agent Skills](https://github.com/getsentry/skills) open format.

## Installation

### Automatic (recommended)

`sentry cli setup` installs the skill into the `~/.claude` and `~/.agents`
directories when they already exist. The install script and Homebrew run setup
automatically; after an npm, pnpm, yarn, or bun install, run `sentry cli setup`
once. Skills are also refreshed on `sentry cli upgrade`.

Pass `--no-agent-skills` to opt out. The choice is remembered for future
upgrades; re-enable with `sentry cli defaults agent-skills on`.

### dotagents

[dotagents](https://github.com/getsentry/dotagents) installs the skill from
the well-known source:

```bash
npx @sentry/dotagents add https://cli.sentry.dev sentry-cli
```

### skills

```bash
npx skills add https://cli.sentry.dev
```

The docs site publishes the skill files and their discovery manifest under
`https://cli.sentry.dev/.well-known/skills/`.

### Cursor

The repository ships Cursor skill symlinks in
`packages/cli/.cursor/skills/sentry-cli/`, pointing at the files below.

### Other Agents

Copy the `plugins/sentry-cli/skills/` directory to your agent's skills location, or reference the SKILL.md files directly according to your agent's documentation. Any agent that reads skills from `~/.agents` will pick up automatically installed skills.

## Available Skills

| Skill | Description |
|-------|-------------|
| [sentry-cli](sentry-cli/skills/sentry-cli/SKILL.md) | Guide for using the Sentry CLI to interact with Sentry |

## Usage

Once installed, ask your AI assistant questions like:

- "How do I list my Sentry issues?"
- "How do I view an issue in Sentry?"
- "How do I authenticate with Sentry CLI?"
- "How do I make API calls to Sentry?"
- "How do I resolve an issue via the CLI?"

The skill will guide the assistant to provide accurate CLI commands.

## Repository Structure

```
packages/cli/
├── .claude-plugin/
│   └── marketplace.json          # Marketplace manifest
├── .cursor/
│   └── skills/
│       └── sentry-cli/
│           ├── SKILL.md          # Symlink to plugins location
│           └── references        # Symlink to plugins location
├── plugins/
│   ├── README.md                 # This file
│   └── sentry-cli/
│       ├── .claude-plugin/
│       │   └── plugin.json       # Plugin manifest
│       └── skills/
│           └── sentry-cli/
│               ├── SKILL.md      # CLI usage skill (auto-generated)
│               └── references/   # One file per command group (auto-generated)
└── script/
    └── generate-skill.ts         # Generates SKILL.md and references/
```

The docs site serves the same files, plus the generated `index.json` discovery
manifest, from `apps/cli-docs/public/.well-known/skills/`.

## Updating SKILL.md

The SKILL.md file is **auto-generated** from the CLI's command definitions. Do not edit it manually.

To regenerate after modifying commands:

```bash
pnpm run generate:docs
```

CI will auto-commit updated skill files when they are stale.

## License

FSL-1.1-Apache-2.0
