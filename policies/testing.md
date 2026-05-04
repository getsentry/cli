# Testing

## Intent
Tests should be isolated, targeted, and biased toward generated coverage for invariant-heavy logic.

## Commands
| Task | Command |
|------|---------|
| Single file | `bun test path/to/file.test.ts --timeout 15000 --isolate` |
| Unit suite | `bun run test:unit` |
| E2E suite | `bun run test:e2e` |
| Changed tests | `bun run test:changed` |

## Test Types
| Type | Pattern | Use For |
|------|---------|---------|
| Unit | `*.test.ts` | Specific outputs, formatting, integration edges |
| Property | `*.property.test.ts` | Parsing, validation, transforms, invariants |
| Model-based | `*.model-based.test.ts` | DB state, caches, state machines |
| E2E | `test/e2e/*.test.ts` | Full CLI behavior |

## Isolation
- Tests that touch config dirs, auth, SQLite, or response cache use `useTestConfigDir()` from `test/helpers.ts`.
- Do not manually delete `process.env.SENTRY_CONFIG_DIR` in tests.
- Do not capture config-dir env values at module scope.
- API tests that mock `globalThis.fetch` also need isolated config and an auth token.

## Property And Model Tests
- Prefer property tests for reusable pure logic with clear invariants.
- Prefer model-based tests for stateful systems.
- Use `DEFAULT_NUM_RUNS` from `test/model-based/helpers.ts`.
- Do not duplicate invariants in unit tests when a property test already covers them.
