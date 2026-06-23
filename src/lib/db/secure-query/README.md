# secure-query

Parameterized query helpers for the local SQLite layer.

## Why this exists

Several historical call sites built SQL by concatenating user input directly
into the statement text, e.g.:

```ts
db.prepare(`SELECT * FROM users WHERE name LIKE '%${term}%'`).all();
```

This is a classic **SQL injection** vulnerability: an input like
`'; DROP TABLE users; --` changes the meaning of the query rather than acting
as data.

## The fix

Always bind dynamic values as parameters (`?`) and never interpolate them into
the SQL text.

- `QueryBuilder` — fluent builder that emits `?` placeholders for every value
  and validates table/column identifiers against a strict allow-list.
- `UserRepository` — data-access layer that uses bound parameters for all
  lookups, searches, and inserts.
- `sanitize` — `escapeLike`, `stripControlChars`, and `safeIdentifier` for the
  rare cases where a value cannot be bound (LIKE fragments, dynamic
  identifiers).

## Rules

1. Prefer bound parameters (`?`) for **every** dynamic value.
2. Identifiers (table/column names) cannot be bound — validate them with
   `safeIdentifier` / `assertIdentifier`.
3. Escape LIKE wildcards with `escapeLike` and pair with `ESCAPE '\'`.
4. Never build SQL with template-literal interpolation of user input.

See `test/lib/db/secure-query.test.ts` for regression coverage.
