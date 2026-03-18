---
title: Agent Guidance
description: Operational guidance for AI coding agents using the Sentry CLI
---

Best practices and operational guidance for AI coding agents using the Sentry CLI.

## Design Principles

The `sentry` CLI follows conventions from well-known tools — if you're familiar with them, that knowledge transfers directly:

- **`gh` (GitHub CLI) conventions**: The `sentry` CLI uses the same `<noun> <verb>` command pattern (e.g., `sentry issue list`, `sentry org view`). Flags follow `gh` conventions: `--json` for machine-readable output, `--fields` to select specific fields, `-w`/`--web` to open in browser, `-q`/`--query` for filtering, `-n`/`--limit` for result count.
- **`sentry api` mimics `curl`**: The `sentry api` command provides direct API access with a `curl`-like interface — `--method` for HTTP method, `--data` for request body, `--header` for custom headers. It handles authentication automatically. If you know how to call a REST API with `curl`, the same patterns apply.

## Context Window Tips

- Use `--fields id,title,status` on list commands to reduce output size
- Use `--json` when piping output between commands or processing programmatically
- Use `--limit` to cap the number of results (default is usually 10–100)
- Prefer `sentry issue view PROJECT-123` over listing and filtering manually
- Use `sentry api` for endpoints not covered by dedicated commands

## Safety Rules

- Always confirm with the user before running destructive commands: `project delete`, `trial start`
- Verify the org/project context is correct before mutations — use `sentry auth status` to check defaults
- Never store or log authentication tokens — use `sentry auth login` and let the CLI manage credentials
- When in doubt about the target org/project, use explicit `<org>/<project>` arguments instead of auto-detection

## Workflow Patterns

### Investigate an Issue

```bash
# 1. Find the issue
sentry issue list my-org/my-project --query "is:unresolved" --limit 5

# 2. Get details
sentry issue view PROJECT-123

# 3. Get AI root cause analysis
sentry issue explain PROJECT-123

# 4. Get a fix plan
sentry issue plan PROJECT-123
```

### Explore Traces and Performance

```bash
# 1. List recent traces
sentry trace list my-org/my-project --limit 5

# 2. View a specific trace with span tree
sentry trace view my-org/my-project/abc123def456...

# 3. View spans for a trace
sentry span list my-org/my-project/abc123def456...

# 4. View logs associated with a trace
sentry trace logs my-org/abc123def456...
```

### Stream Logs

```bash
# Stream logs in real-time
sentry log list my-org/my-project --follow

# Filter logs by severity
sentry log list my-org/my-project --query "severity:error"
```

### Arbitrary API Access

```bash
# GET request (default)
sentry api /api/0/organizations/my-org/

# POST request with data
sentry api /api/0/organizations/my-org/projects/ --method POST --data '{"name":"new-project","platform":"python"}'
```

## Common Mistakes

- **Wrong issue ID format**: Use `PROJECT-123` (short ID), not the numeric ID `123456789`. The short ID includes the project prefix.
- **Forgetting authentication**: Run `sentry auth login` before any other command. Check with `sentry auth status`.
- **Missing `--json` for piping**: Human-readable output includes formatting. Use `--json` when parsing output programmatically.
- **Org/project ambiguity**: Auto-detection scans for DSNs in `.env` files and source code. If the project is ambiguous, specify explicitly: `sentry issue list my-org/my-project`.
- **Confusing `--query` syntax**: The `--query` flag uses Sentry search syntax (e.g., `is:unresolved`, `assigned:me`), not free text search.
- **Not using `--web`**: View commands support `-w`/`--web` to open the resource in the browser — useful for sharing links.
