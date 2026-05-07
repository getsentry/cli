# Pagination

## Intent
List commands use one cursor-stack model so `-c next`, `-c prev`, and JSON pagination stay consistent.

## Required Helpers
- `LIST_CURSOR_FLAG` from `src/lib/list-command.ts`
- `buildPaginationContextKey()` from `src/lib/db/pagination.ts`
- `resolveCursor()` from `src/lib/db/pagination.ts`
- `advancePaginationState()` from `src/lib/db/pagination.ts`
- `hasPreviousPage()` from `src/lib/db/pagination.ts`
- `paginationHint()` from `src/lib/list-command.ts`

## Rules
- Use `-c` as the `cursor` alias.
- Include `hasPrev`, `hasMore`, and `nextCursor` where applicable in JSON envelopes.
- Build navigation hints with `paginationHint()`, not manual string arrays.
- Treat `"last"` as the existing silent alias for `"next"`.
- Call `resolveCursor()` inside mode-specific handlers when cursor support is mode-specific.
- Never pass `per_page` larger than `API_MAX_PER_PAGE`.
- When `--limit` exceeds `API_MAX_PER_PAGE`, fetch multiple pages until the limit is filled or pages run out.

## Abstraction Choice
| Use | When |
|-----|------|
| `buildOrgListCommand` | Simple org-scoped lists such as teams or repos |
| `dispatchOrgScopedList` | Commands with custom auto-detect, org-all, or project-search behavior |
| Manual cursor wiring | Standalone list commands such as traces, spans, dashboards, replays, or explore |
