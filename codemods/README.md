# Codemods

Automated migration transforms for the Sentry CLI.

## `sentry-v3-to-v4.cjs`

Migrates the legacy `@sentry/cli` v3 Node wrapper (`new SentryCli().releases.*`)
to the v4 `sentry` package library API (`createSentrySDK()`).

```bash
# Run against your source (any path/glob jscodeshift accepts)
npx jscodeshift -t codemods/sentry-v3-to-v4.cjs src/

# Or straight from GitHub, without cloning:
npx jscodeshift \
  -t https://raw.githubusercontent.com/getsentry/cli/main/codemods/sentry-v3-to-v4.cjs \
  src/

# For TypeScript sources, pick the matching parser:
npx jscodeshift --parser=tsx -t codemods/sentry-v3-to-v4.cjs src/
```

It rewrites:

- the `@sentry/cli` import / `require` → `sentry`,
- `new SentryCli(configFile, options)` → `createSentrySDK(options)`
  (drops the removed `configFile` arg, renames `authToken` → `token`),
- the `releases.*` method chain → the v4 `release.*` / `sourcemap.*` methods,
- `execute(args)` → `run(...args)`.

Because several option **shapes** changed between v3 and v4 (most notably
`uploadSourceMaps({ include })` → `sourcemap.upload({ directory })`), the codemod
does the mechanical rewrites and inserts `// TODO(sentry-v4): …` comments where a
call needs a manual review rather than guessing. **Review the diff** after
running it.

See [Migrating from v3](https://cli.sentry.dev/migrating-from-v3/) for the full
guide.
