# Generated Artifacts

## Intent
Generated docs, schemas, and plugin skill files should be updated through the existing generators.

## Rules
- `bun run generate:docs` runs command docs, parser generation, skill generation, and docs sections.
- `dev`, `build`, `typecheck`, and test scripts run the relevant generators automatically.
- Command reference docs under `docs/src/content/docs/commands/*.md` are generated and gitignored.
- Edit custom command docs in `docs/src/fragments/commands/`.
- Run `bun run check:fragments` after fragment or route changes.
- Skill files under `plugins/sentry-cli/skills/sentry-cli/` are generated and committed.
- Positional placeholders must be descriptive, such as `org/project/trace-id`, not `args`.
- API schema changes should use `bun run generate:schema`.
