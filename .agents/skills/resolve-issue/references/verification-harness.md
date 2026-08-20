# Verification Harness Selection

Match the shape of the change to the right verification method.
Use the first row that fits.

| Change shape | Verification method | Example |
|---|---|---|
| Logic bug in a pure function | Unit test targeting the fixed path | `expect(parse("")).toBe(null)` |
| State management / data flow | Integration test with real data flow | Test the full handler, not just the helper |
| CLI command behavior | Run the actual command | `bun run cli --flag` and check output |
| HTTP endpoint | `curl` or test client against dev server | `curl localhost:3000/api/health` |
| Build / compilation | Full build | `bun run build` or `npm run build` |
| Type error fix | Type checker | `tsc --noEmit` or `bunx tsc --noEmit` |
| Lint / format fix | Linter | `bunx biome check` or project lint command |
| Config change | Smoke test the affected system | Start the server, run the workflow |
| UI component | Browser test or visual check | Storybook, Playwright, or manual |
| CI workflow change | Dry-run where possible | `act` for GitHub Actions, or push and observe |

## Principles

- **Run the existing test suite first.** If it passes, your change
  didn't break existing behavior. If it fails on unrelated code,
  note it and move on.

- **Verify the fix, not just the absence of error.** A test that
  previously crashed and now doesn't crash might be passing for the
  wrong reason. Assert the expected output.

- **Prefer the project's own verification tools.** If the repo has
  `make test`, use it. Don't introduce new test infrastructure for
  a single fix.

- **Time-box verification.** Spend up to 2 minutes finding and
  running tests. If the project has no test suite and the change is
  simple, note "no test suite found" and move on.
