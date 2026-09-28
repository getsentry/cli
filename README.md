# Sentry Toolkit (pre-shape)

This repository is being reshaped into a pnpm-workspace monorepo ahead of merging
the Sentry CLI and Sentry MCP server into a single `getsentry/toolkit` monorepo.

## Workspace layout

- [`packages/cli/`](./packages/cli) — the Sentry CLI (npm package `sentry`,
  binary `sentry`). See [packages/cli/README.md](./packages/cli/README.md).
- [`apps/cli-docs/`](./apps/cli-docs) — the CLI documentation site
  (Astro + Starlight, published to `cli.sentry.dev`).

## Development

This is a [pnpm workspace](https://pnpm.io/workspaces). Common tasks are exposed
as delegating scripts at the root and forwarded to the relevant package:

```sh
pnpm install          # install all workspace packages
pnpm run build        # build the CLI package
pnpm run typecheck    # typecheck the CLI package
pnpm run lint         # lint
pnpm run test         # run the CLI unit tests
```

To work directly within a package, use pnpm filters, e.g.
`pnpm --filter sentry run <script>` or `pnpm --filter sentry-cli-docs run dev`.
