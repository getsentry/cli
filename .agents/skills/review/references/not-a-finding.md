# Not a Finding

These patterns look suspicious but are typically correct. Do not
report them unless you have specific evidence they cause a problem
in this codebase.

## By category

### Bug — safe patterns

- **Null/undefined checks on values that "should" be set.** If the
  function is public or called from multiple sites, defensive checks
  are reasonable.
- **Empty catch blocks in error boundaries** (React, Express, Hono).
  The framework expects them. Only flag if the error is silently
  swallowed in a non-boundary context.
- **Loose equality (`==`) in JavaScript** when comparing to `null` to
  catch both `null` and `undefined`. This is an intentional pattern.
- **Re-throwing the same error.** Sometimes done to add context or
  trigger a different catch block.

### Test-gap — not worth flagging

- **Trivial getters/setters** that delegate directly to another
  property or method.
- **Type-only changes** (adding/removing TypeScript types) that don't
  affect runtime behavior.
- **Log/telemetry additions** that don't change control flow.
- **Comment or documentation updates.**

### Style — taste preferences, not findings

- **Named vs. default exports.** Both are valid; flag only if the
  file's neighbors are consistent and this one breaks the pattern.
- **Arrow functions vs. function declarations.** Same rule — only
  flag if the file is inconsistent with itself.
- **Trailing commas.** Unless the formatter config enforces one way.
- **Single vs. double quotes.** Unless the formatter config enforces
  one way.
- **Import ordering.** Unless an auto-sorter is configured.

### Scope — not unrelated

- **Fixing a typo in a comment** adjacent to the changed code. This
  is a natural drive-by fix, not scope creep.
- **Renaming a variable** in the same function being modified. This
  improves readability of the change.
- **Updating a type** that the changed code depends on. This is a
  necessary part of the change.

### Docs — not stale

- **TODO comments** that describe known limitations. These are
  intentional markers, not stale documentation.
- **Comments explaining "why"** (not "what"). Even if the code
  changes, the reasoning may still be valid.
