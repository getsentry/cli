---
name: mark-pr-ready
description: Promote a draft PR to ready-for-review after CI passes and self-review is clean. Assigns reviewers and adds labels.
license: Apache-2.0
metadata:
  audience: autonomous-agents
---

# Mark PR Ready

Promote a draft PR out of draft status. Only do this when CI is green
and self-review found no remaining issues.

## Preconditions

- You are on the PR's feature branch.
- CI has passed (check via `gh pr checks <N> --required`).
- Self-review produced no unresolved findings.

## Workflow

1. Verify CI status:
   ```sh
   FAILING=$(gh pr checks <N> --json name,state \
     --jq '[.[] | select(.state != "SUCCESS" and .state != "SKIPPED" and .state != "NEUTRAL")]')
   ```
   If the output is not an empty array `[]`, stop — CI isn't green yet.

2. Mark ready for review:
   ```sh
   gh pr ready <N>
   ```

3. Request reviewers. Always add the creator of the originating
   issue as a reviewer — they have the most context on the problem
   and should sign off on the fix:
   ```sh
   ISSUE_AUTHOR=$(gh issue view <issue-N> --json author --jq '.author.login' 2>/dev/null)
   if [ -n "$ISSUE_AUTHOR" ]; then
     gh pr edit <N> --add-reviewer "$ISSUE_AUTHOR" 2>/dev/null || true
   fi
   ```
   Then fall back to CODEOWNERS. GitHub auto-assigns from CODEOWNERS
   when a draft PR is marked ready (if branch protection requires
   reviews), so explicit assignment is often unnecessary. If the repo
   doesn't use branch protection, try to find an owner:
   ```sh
   CODEOWNERS_FILE=""
   for f in .github/CODEOWNERS CODEOWNERS docs/CODEOWNERS; do
     [ -f "$f" ] && CODEOWNERS_FILE="$f" && break
   done
   if [ -n "$CODEOWNERS_FILE" ]; then
     OWNERS=$(grep -v '^#' "$CODEOWNERS_FILE" | awk '{for(i=2;i<=NF;i++) print $i}' | sort -u | head -3)
     for owner in $OWNERS; do
       owner="${owner#@}"
       gh pr edit <N> --add-reviewer "$owner" 2>/dev/null || true
     done
   fi
   ```
   If reviewer assignment fails (e.g. the issue author can't review
   their own org's PR, or isn't a collaborator), skip silently.

4. Add labels:
   ```sh
   gh pr edit <N> --add-label "bot-generated"
   ```
   If the original issue had priority labels, propagate them:
   ```sh
   ISSUE_LABELS=$(gh issue view <issue-N> --json labels --jq '.labels[].name' 2>/dev/null)
   for label in $ISSUE_LABELS; do
     case "$label" in priority*|P0|P1|P2|P3|critical|high|medium|low)
       gh pr edit <N> --add-label "$label" 2>/dev/null || true
       ;;
     esac
   done
   ```

5. Post a short comment noting the PR is ready. Mention what CI
   checks passed and that self-review found no issues. Write it
   naturally — vary the wording, don't use a canned phrase.

## Notes

- Don't merge the PR. This skill only marks the PR ready — the
  coordinator may load `auto-merge` next if the PR qualifies.
- If label creation fails (label doesn't exist in the repo), skip
  silently — don't create labels.
- This skill is typically loaded by the coordinator agent after a
  `check_suite` or `workflow_run` event with conclusion `success`.
