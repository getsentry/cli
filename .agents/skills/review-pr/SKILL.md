---
name: review-pr
description: Review a pull request. Self-fix on own PRs, post a review on others'. Load repo-setup first.
license: Apache-2.0
metadata:
  audience: autonomous-agents
---

# Review PR

Review a PR the bot is involved in. Load `repo-setup` first.

## Workflow

1. Check authorship: `gh pr view <N> --json author --jq .author.login`
   vs `$ME` (your identity). Skip drafts unless it's your own PR.
2. Read the PR's intent (body, linked issues, commit log).
3. Load `review` skill.
4. Act on findings:
   - **No findings**: post a `--comment` review (reserve `--approve`
     for when you can vouch for correctness).
   - **Findings on own PR**: load `apply-fixes` skill to push fixes.
   - **Findings on others' PR**: post `--request-changes` or
     `--comment` review via `gh pr review`. Don't push to their branch.

Write review comments like a senior dev — direct, specific, no
filler. "this will panic on nil" not "I noticed that this could
potentially cause a nil pointer dereference."

Don't approve trivially. Don't merge.
