

## Global Options

All commands support the following global options:

- `--help` - Show help for the command
- `--version` - Show CLI version
- `--log-level <level>` - Set log verbosity (`error`, `warn`, `log`, `info`, `debug`, `trace`). Overrides `SENTRY_LOG_LEVEL`
- `--verbose` - Shorthand for `--log-level debug`

## Targeting Organizations and Projects

Many commands accept an optional `<org>/<project>` target, either as the first positional argument (list commands) or as a prefix of an ID (e.g. `my-org/my-project/<trace-id>`). When you omit it, the CLI auto-detects the org and project (see [Resolution Priority](../configuration/#resolution-priority)).

| Target | Meaning |
|--------|---------|
| _(omitted)_ | Auto-detect org and project |
| `<org>/<project>` | That project in that organization |
| `<org>/` | The whole organization (trailing slash) |
| `<name>` | A project named `<name>` in any accessible organization. If no project matches, commands that accept an organization use the org named `<name>` instead |

When a project and an organization share the same slug, the bare form selects the project. Add the trailing slash (`my-org/`) to target the organization explicitly.

## JSON Output

Most list and view commands support `--json` flag for JSON output, making it easy to integrate with other tools:

```bash
sentry org list --json | jq '.[] | .slug'
```

## Opening in Browser

View commands support `-w` or `--web` flag to open the resource in your browser:

```bash
sentry issue view PROJ-123 -w
```
