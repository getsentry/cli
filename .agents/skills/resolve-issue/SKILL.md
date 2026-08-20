---
name: resolve-issue
description: Resolve a GitHub issue end-to-end — explore, plan, implement, clean up, and open a draft PR.
license: Apache-2.0
metadata:
  audience: autonomous-agents
---

# Resolve Issue

Take an issue from labeled to "draft PR opened." Load `repo-setup`
first to prepare `/workspace/repo` on a feature branch.

**Default to shipping a draft PR.** A best-effort first cut is more
valuable than a "too big" comment. Other agents will review it, fix CI,
and respond to feedback.

## Workflow

### Phase 1: Context Gathering

1. **Read the issue.** Lean toward the smallest interpretation.

2. **Check for existing PRs** that reference this issue:
   ```sh
   gh api "repos/<owner>/<repo>/issues/<number>/timeline" --paginate \
     --jq '[.[] | select(.event=="cross-referenced" and .source.issue.pull_request != null) | {number: .source.issue.number, state: .source.issue.state, title: .source.issue.title, url: .source.issue.html_url}]'
   ```
   Also search PR titles and bodies for the issue number:
   ```sh
   gh pr list --search "<number>" --repo <owner>/<repo> --json number,title,state,headRefName,url
   ```
   - **Open PR exists** → check it out (`gh pr checkout <number>`),
     review what's done, and continue from there instead of starting
     fresh. Load `review` skill to assess quality first.
   - **Draft/stale PR exists** → same as above. Rebase onto the
     default branch if needed (see conflict resolution below).
   - **Only closed/merged PRs** → the issue may already be resolved.
     Verify before starting new work.
   - **No linked PRs** → proceed with fresh implementation.

3. **Understand repo conventions.** Delegate this survey to the
   `explore` subagent (read-only, cheaper model) and use its brief; ask
   it to report:
   - `CONTRIBUTING.md`, `AGENTS.md`, `DEVELOPMENT.md`, or similar docs
   - Recent commit history: `git log --oneline -20` (commit style)
   - Linter config: `biome.json`, `.eslintrc*`, `.prettierrc*`,
     `ruff.toml`, `pyproject.toml [tool.ruff]`, `.golangci.yml`, etc.
   - Test framework config: `jest.config*`, `vitest.config*`,
     `pytest.ini`, `pyproject.toml [tool.pytest]`, `go.mod`, etc.
   - CI workflow files: `.github/workflows/*.yml` — note the test
     command and count the number of check/job names
   - Existing utility functions relevant to the issue
   Note for later: coding conventions, test command, lint command,
   PR template path (if any), and CI check count.

### Phase 2: Bug Verification

4. **Classify the issue**: bug report or feature request.
   - **Feature request** → skip to step 6 (planning).
   - **Bug report** → continue to verification.

5. **Verify the bug exists.** You may delegate the code-path *reading*
   to `explore` (e.g. "find and summarize the code paths involved in
   <behavior>"), but make the root-cause judgment yourself:
   a. Read the relevant code paths identified in the issue body.
   b. Cross-check against the default branch HEAD — is the described
      behavior actually present in the current code?
   c. Try to write a minimal reproduction: a test case, a script, or
      a specific input that triggers the bug.
   d. If reproducible: report the root cause ("This breaks because
      **X**, in **Y** path, after **Z** condition.").
   e. If not reproducible: report what was tried and why it failed.

   If the bug **cannot be reproduced**:
   - Post a comment on the issue asking for specific details:
     reproduction steps, environment, version, logs, or a minimal
     example. Be specific about what you tried.
   - **Stop.** Do not attempt a fix. A follow-up `issue_comment`
     webhook will arrive in this session when the reporter replies,
     and work will resume from this step.

### Phase 3: Planning

6. **Create a detailed plan.** Based on the root cause (from step 5) or the feature
   scope (from step 4), produce a plan that includes:
   - The root cause or feature scope summary.
   - Every file to change and what each change does.
   - What tests to add or modify (if the repo has a test suite).
   - The verification method: which test to run, which script to
     execute, or what behavior to check.
   This plan will be embedded in the PR description.

### Phase 4: Implementation

7. **Implement the plan.** Once your plan from step 6 is precise, hand
   the first-pass edits to the `implement` subagent (cheaper coding model),
   giving it: the full plan, the working directory (`/workspace/repo`), the
   coding conventions from step 3, and the exact files/changes/tests to write.
   Then **review `implement`'s output yourself** before trusting it — the
   correctness judgment stays with you. For small or subtle changes,
   just do them directly.

8. **Verify the implementation.**
   - Check that every item in the plan was implemented (your judgment).
   - Run the test suite (use the test command from step 3) — you may
     delegate the test run + failure summary to `implement`.
   - If this was a bug fix, run the reproduction from step 5.

9. **Loop if failing.** If tests fail or the issue isn't resolved:
   - Return to step 6: re-plan with the new information (test output,
     error messages, what the implementation got wrong).
   - Maximum **2 retries** (3 total attempts including the first).
   - After 3 failed attempts, commit what you have and note the
     remaining issues in the PR description.

### Phase 5: Cleanup and PR

10. **Clean up.**
    - Load `deslop` skill — strip AI noise from the diff.
    - Load `review` skill — self-review. If findings exist, fix them,
      re-run `deslop` and `review`. Repeat at most **3 rounds**.
    - Run the lint command from step 3 (if one was found). Fix lint
      issues before committing.

11. **Commit and push.**
    - Commit with `Fixes #<number>` in the message.
    - Check for conflicts with the default branch and rebase if
      needed (see conflict resolution below).
    - Push.

12. **Open a draft PR.** Load `pr` skill with:
    - The implementation summary from step 6.
    - What was tested (test command, results).
    - The CI check count from step 3 (for dynamic cron scheduling).
    - The issue number for linking (`Closes #<number>`).

## Conflict resolution

Before pushing, check for conflicts with the default branch:

```sh
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
git fetch origin "$DEFAULT_BRANCH"
git rebase "origin/$DEFAULT_BRANCH"
```

If the rebase has conflicts:

1. Check `git diff --name-only --diff-filter=U` for conflicted files.
2. For each file, read the conflict markers (`<<<<<<<`, `=======`,
   `>>>>>>>`), understand both sides, and resolve.
3. `git add <resolved-file>` then `git rebase --continue`.
4. If the conflict is too complex to resolve confidently, abort with
   `git rebase --abort` and note it in the PR description.

Never force-push to someone else's branch. On your own feature branch,
a rebase followed by `git push --force-with-lease` is acceptable.

## Test discovery

Before committing, find and run the project's test suite. Check these
locations in order and use the first match:

1. **package.json** (Node/JS/TS):
   ```sh
   jq -r '.scripts.test // empty' package.json
   ```
   Run with `npm test`, `bun test`, `pnpm test`, or `yarn test`
   depending on the lockfile present.

2. **Makefile / Justfile**:
   ```sh
   grep -E '^test[ :]' Makefile Justfile 2>/dev/null
   ```
   Run with `make test` or `just test`.

3. **Python** (pytest / unittest):
   ```sh
   test -f pytest.ini || test -f pyproject.toml || test -f setup.cfg
   ```
   Run with `pytest` or `python -m pytest`.

4. **Go**:
   ```sh
   test -f go.mod
   ```
   Run with `go test ./...`.

5. **CI workflows** (fallback):
   ```sh
   grep -r 'run:.*test' .github/workflows/ 2>/dev/null | head -5
   ```
   Extract the test command from the workflow file.

If no test command is found within 30 seconds of searching, skip and
note "no test suite found" in the PR description. Don't spend more
than 2 minutes on a failing test suite that's unrelated to your
changes — note it and move on.

## Command timeouts

**Always set a timeout on bash commands that might hang.** Use the
`timeout` parameter (milliseconds) on every `bash` tool call that
runs tests, builds, or installs dependencies:

- `pnpm install` / `npm install` / `bun install`: **120000** (2 min)
- `tsc --noEmit` / typecheck: **120000** (2 min)
- `vitest run` / `jest` / test suites: **180000** (3 min)
- `biome check` / `eslint` / lint: **60000** (1 min)

If a command times out, that's fine — note it in the PR description
and move on. **Never run test/build commands without a timeout.**

Also: many repos require a codegen or build step before typecheck/tests
work (e.g. `pnpm run generate:sdk`, `pnpm run build`). Check
`package.json` scripts for `generate*`, `codegen*`, or `prebuild*`
scripts and run them first. If they fail or are slow, skip them — the
typecheck/test failures from missing generated files are pre-existing
and not your fault.

Reserve BLOCKED for genuine impossibility (missing auth, deleted repo,
contradictory requirements). A best-effort draft PR is almost always
better than blocking.
