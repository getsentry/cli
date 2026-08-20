---
name: pr
description: Create a draft PR for the current branch following repo conventions. Writes a concise PR description from the implementation plan, embeds the full plan as a hidden HTML comment so reviewers can read it without leaving GitHub, and reuses an existing branch when one is already checked out. Use this once your implementation is committed and pushed.
license: Apache-2.0
metadata:
  source: https://github.com/BYK/dotskills
  audience: autonomous-agents
---

# Create a PR

Create a **draft** PR from the current branch's changes. Follow the repo's
conventions for branch name and commit title. The PR description should
be based on the implementation plan and the changes summary, but kept
short and to the point — not overly long or detailed.

## Preconditions

- The branch you want to PR is already committed.
- The branch is already pushed to `origin` (the caller is expected to
  do this; the agent's workflow handles it before invoking the skill).

## Steps

1. **Check the branch**. If you're already on a relevant feature branch
   (i.e. not the repo's default branch), reuse it. Don't create a new
   one on top.

2. **Open the PR** with `gh pr create --draft`. Title should follow
   the repo's commit convention. If the repo uses conventional commits
   (check recent history with `git log --oneline -10`), use the format
   `<type>(<scope>): <subject>` where type is `fix`, `feat`, `chore`,
   `refactor`, `docs`, `test`, etc. Do not include AI-attribution
   labels like `[bot]`, `[claude]`, or `[ai]` in the title. Body
   should be a 1–3 sentence summary plus a "Testing" line if relevant
   — followed by the full implementation plan inside a hidden HTML
   comment so reviewers can read it without leaving GitHub but it
   doesn't bloat the visible description:

   ```sh
   gh pr create --draft \
     --title "<commit subject>" \
     --body "$(cat <<'EOF'
   <1–3 sentence summary>

   ## Testing
   <what you ran, or "none — see note">

   Closes #<issue-number>

   <!--
   ## Plan
   <full plan, multi-line is fine; this comment is invisible in
    GitHub's rendered PR view but can be inspected via "View source"
    or by checking out the PR locally>
   -->
   EOF
   )"
   ```

   The heredoc is important — it preserves multi-line plans, special
   characters, and quotes without escaping headaches.

3. **Print the PR URL** as the final line of your reply.

CI status will be monitored via webhook events — when a `check_suite`
or `workflow_run` event arrives with `conclusion: success`, the agent
will load `mark-pr-ready` to promote the draft.

## Notes

- This skill creates a *draft* PR by design. A separate review/iterate
  step should mark it ready-for-review once self-review and CI pass.
  This is handled automatically via webhook events for CI completion.
- Don't include diagrams, lengthy "context" sections, or duplicated
  information that's already on the issue. The reader can follow the
  link.
- If the caller specifically wants the plan attached as a `git note`
  instead of an HTML comment (BYK/dotskills' original design), use:
  ```sh
  git notes add -F - HEAD <<'EOF'
  <full plan>
  EOF
  git push origin refs/notes/commits
  ```
  Without the explicit `git push refs/notes/commits`, the note exists
  only in the local clone.

---

*Adapted from [BYK/dotskills](https://github.com/BYK/dotskills)
(Apache-2.0). Where the original used `git notes` as the primary
attachment mechanism, this version uses an HTML comment in the PR
body for reviewer visibility, with `git notes` documented as an
alternative.*
