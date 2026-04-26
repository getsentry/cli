

> **Experimental:** `sentry init` is experimental and may modify your source files. Always review changes before committing.

**Prerequisites:** You must be authenticated first. Run `sentry auth login` if you haven't already.

## Examples

```bash
# Interactive setup
sentry init

# Non-interactive with auto-yes
sentry init -y

# Dry run to preview changes
sentry init --dry-run

# Target a subdirectory
sentry init ./my-app

# Use a specific org (auto-detect project)
sentry init acme/

# Use a specific org and project
sentry init acme/my-app

# Assign a team when creating a new project
sentry init acme/ --team backend

# Skip the agent-driven feature picker and use a fixed list (CI / non-interactive)
sentry init --features tracing,replay,sourcemaps
```

## Target Syntax

| Syntax | Meaning |
|--------|---------|
| _(omitted)_ | Auto-detect org and project |
| `acme/` | Use org `acme`, auto-detect or create project |
| `acme/my-app` | Use org `acme` and project `my-app` |
| `my-app` | Search for project `my-app` across all accessible orgs |

Path-like arguments (starting with `.`, `/`, or `~`) are always treated as the directory. The order of target and directory can be swapped — the CLI will auto-correct with a warning.

## Available Features

| Feature | Description |
|---------|-------------|
| `errors` | Error monitoring |
| `tracing` | Performance tracing |
| `logs` | Log integration |
| `replay` | Session replay |
| `metrics` | Custom metrics |
| `profiling` | Profiling |
| `sourcemaps` | Source map uploads |
| `crons` | Cron job monitoring |
| `ai-monitoring` | AI/LLM monitoring |
| `user-feedback` | User feedback widget |

## What the Wizard Does

1. **Detects your framework** — scans your project files to identify the platform, framework, runtime, and relevant libraries
2. **Researches the docs** — walks the Sentry docs to figure out which features are supported and useful for *your* project
3. **Asks which features to enable** — proposes only the features that fit your stack (e.g. no Session Replay on a server-only Node app), with a short reason next to each one. Error monitoring is always on
4. **Installs the SDK** — adds the appropriate Sentry SDK package to your project
5. **Instruments your code** — configures error monitoring and the features you picked

Use `--features <list>` to skip the analyze-and-pick step (handy for `--yes` / CI). When provided, the wizard treats it as canonical and the agent goes straight to instrumentation.

### Supported Platforms

- **JavaScript / TypeScript** — Next.js, Express, SvelteKit, React
- **Python** — Flask, FastAPI

More platforms and frameworks are coming soon.
