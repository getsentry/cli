# Policies

Policies are short repo-wide defaults.

Use a policy when the repo needs a durable "how we do this here" rule without a full design doc or workflow.

## Rules
- Keep policy docs small: intent, default rule, meaningful exceptions.
- Prefer bullets, tables, and examples over paragraphs.
- Link to implementation files instead of copying large code samples.
- Move repeatable procedures to `playbooks/`.
- Move proposed designs, tradeoffs, and migration plans to `specs/`.
- Update `AGENTS.md` when a policy becomes broadly required reading.

## Current Policies
| File | Scope |
|------|-------|
| `TEMPLATE.md` | Copy this shape for new policy docs |
| `code-comments.md` | Comments, docstrings, and JSDoc |
| `runtime-and-deps.md` | Bun APIs, dependency rules, Node distribution exceptions |
| `cli-command-design.md` | Command, route, and mutation command conventions |
| `output-and-errors.md` | Human output, JSON output, errors, logging |
| `pagination.md` | Cursor-stack pagination for list commands |
| `testing.md` | Test style, isolation, property/model-based tests |
| `generated-artifacts.md` | Generated docs, skills, fragments, schemas |
| `implementation-notes.md` | Conditional edge-case notes for specific domains |
