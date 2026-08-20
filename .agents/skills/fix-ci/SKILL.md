---
name: fix-ci
description: Diagnose and fix failing CI on a PR. Capped at 3 attempts. Load repo-setup first.
license: Apache-2.0
metadata:
  audience: autonomous-agents
---

# Fix CI

Fix failing CI on a PR the bot authored. Load `repo-setup` first.

## Budget

3 attempts max per PR. Count existing attempts:

```sh
ATTEMPTS=$(gh api "repos/<owner>/<repo>/issues/<number>/comments" --paginate \
  --jq '[.[] | select(.user.login == "'"$ME"'" and (.body | startswith("fix-ci: attempt")))] | length')
```

If >= 3, BLOCKED. Otherwise post a short comment like "fix-ci:
attempt 2 — looks like a type error in `foo.ts`, investigating"
before starting work. The `fix-ci:` prefix is required for counting
but the rest should read naturally.

## Workflow

1. Find failed runs: `gh run list --branch <branch> --status failure`
2. Read logs: `gh run view <id> --log-failed`
3. Categorize the failure — see `references/failure-taxonomy.md` for
   the full taxonomy and decision tree. Categories: test failure,
   type/lint error, build error, snapshot diff, flaky test, or infra
   issue.
4. Flaky? Re-run once (`gh run rerun <id> --failed`) and stop.
5. Infra/dependency issue? BLOCKED.
6. Otherwise: make the smallest fix. Reproduce locally if possible.
7. Load `deslop` and `review` skills.
8. Commit, push, and post a comment summarizing what you fixed and
   how. Write it like a teammate explaining the fix, not a status
   report.

Avoid modifying CI config unless the failure is specifically in it.
Avoid bumping dependency versions — the fix should target the code,
not the toolchain. Don't force-push. Don't merge.
