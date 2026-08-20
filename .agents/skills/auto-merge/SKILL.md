---
name: auto-merge
description: Auto-merge a PR after it is marked ready-for-review, if the change is small, non-disruptive, and all checks pass.
license: Apache-2.0
metadata:
  audience: autonomous-agents
---

# Auto-merge

Merge a PR that was just promoted from draft to ready-for-review,
**only** when the change is small, non-disruptive, and every required
check is green. This skill is the natural successor to `mark-pr-ready`.

## When to load this skill

Load after the `mark-pr-ready` skill has run (or after a
`pull_request.ready_for_review` event). Do **not** load it for PRs
that were created as ready-for-review from the start — only for PRs
that transitioned from draft.

## Preconditions (all must be true)

1. The PR is open and marked ready for review (not draft).
2. The PR targets the repo's default branch.
3. All CI checks have completed and passed.
4. The diff is small and non-disruptive (see size gate below).
5. No reviewer has requested changes.
6. No unresolved review threads.
7. At least 10 minutes have passed since the PR was marked ready
   for review, with no new reviewer comments or change requests
   during that window.

If any precondition fails, stop — do not merge. For precondition 7,
if the quiet period hasn't elapsed yet, schedule a one-shot follow-up
for the remaining time (Flue Durable Object `scheduleFollowUp` /
platform `schedule()`, or a `run_once` timer when running in-container)
and stop. The follow-up will re-trigger this skill when the period is up.

## Size gate

Classify the PR as "small and non-disruptive" only when **all** of
these hold:

- Total lines changed (additions + deletions) ≤ 150.
- No more than 5 files changed.
- No changes to CI/CD configuration (`.github/workflows/`, `Dockerfile`,
  `docker-compose*`, `Makefile`, `Justfile`, Terraform `*.tf`).
- No changes to dependency lockfiles (`bun.lock`, `package-lock.json`,
  `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`).
- No database migrations or schema changes.
- No changes to authentication, authorization, or secrets handling.
- No deletions of public API surface (exported functions, REST
  endpoints, GraphQL types).

If the PR exceeds the size gate, stop. Post a comment noting the PR
needs human review and list which criteria it exceeded.

## Workflow

0. **Check quiet period**. Verify the PR was marked ready at least
   10 minutes ago with no reviewer activity since:
   ```sh
   READY_AT=$(gh api "repos/<owner>/<repo>/issues/<N>/timeline" --paginate \
     --jq '[.[] | select(.event=="ready_for_review")] | last | .created_at')
   ```
   Calculate elapsed time. If less than 10 minutes have passed,
   schedule a one-shot follow-up (Flue DO `scheduleFollowUp` / platform
   `schedule()`, or in-container timer) for the remaining time with
   `entity_key` set to the PR entity, and stop. The follow-up prompt
   should instruct the agent to reload the `auto-merge` skill.

   Also check for any reviewer comments or `changes_requested`
   reviews that arrived after `READY_AT`:
   ```sh
   gh api "repos/<owner>/<repo>/pulls/<N>/reviews" \
     --jq '[.[] | select(.submitted_at > "'$READY_AT'" and .state != "APPROVED" and .state != "COMMENTED")]'
   ```
   If any exist, stop — the PR needs human attention.

1. **Verify PR state and target branch**:
   ```sh
   PR_JSON=$(gh pr view <N> --json state,isDraft,baseRefName)
   STATE=$(echo "$PR_JSON" | jq -r '.state')
   IS_DRAFT=$(echo "$PR_JSON" | jq -r '.isDraft')
   BASE=$(echo "$PR_JSON" | jq -r '.baseRefName')
   DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
   ```
   - Expect `STATE=OPEN`, `IS_DRAFT=false`. If draft or closed, stop.
   - Expect `BASE == DEFAULT_BRANCH`. If the PR targets a release or
     other protected branch, stop — those need human review.

2. **Verify all checks pass**:
   ```sh
   CHECKS=$(gh pr view <N> --json statusCheckRollup \
     --jq '.statusCheckRollup')
   ```
   For each check, inspect `status` and `conclusion`:
   - If any check has `status` other than `"COMPLETED"` (e.g.
     `"QUEUED"`, `"IN_PROGRESS"`, `"PENDING"`), stop — checks
     haven't finished yet. Post a comment noting which checks are
     still running.
   - If any completed check has `conclusion` other than `"SUCCESS"`,
     `"SKIPPED"`, or `"NEUTRAL"`, stop — checks are failing. Post a
     comment listing the failing checks.

   Quick jq filter for non-passing completed checks:
   ```sh
   FAILING=$(echo "$CHECKS" | jq '[.[] | select(
     .status == "COMPLETED" and
     .conclusion != "SUCCESS" and
     .conclusion != "SKIPPED" and
     .conclusion != "NEUTRAL"
   )]')
   ```
   Quick jq filter for still-running checks:
   ```sh
   PENDING=$(echo "$CHECKS" | jq '[.[] | select(.status != "COMPLETED")]')
   ```

3. **Evaluate the size gate**:
   ```sh
   PR_DATA=$(gh pr view <N> --json additions,deletions,files)
   ADDITIONS=$(echo "$PR_DATA" | jq '.additions')
   DELETIONS=$(echo "$PR_DATA" | jq '.deletions')
   TOTAL=$((ADDITIONS + DELETIONS))
   FILES_CHANGED=$(echo "$PR_DATA" | jq '.files | length')
   ```
   Check each criterion listed in the size gate section. Inspect the
   file list for CI/CD, lockfile, migration, auth, or public API
   changes:
   ```sh
   echo "$PR_DATA" | jq -r '.files[].path'
   ```

4. **Check for review objections and unresolved threads**:
   ```sh
   CHANGES_REQUESTED=$(gh pr view <N> --json reviews \
     --jq '[.reviews[] | select(.state == "CHANGES_REQUESTED")] | length')
   ```
   If `CHANGES_REQUESTED > 0`, stop — a reviewer has requested changes.

   Check for unresolved review threads via the GraphQL API:
   ```sh
   UNRESOLVED=$(gh api graphql -f query='
     query($owner: String!, $repo: String!, $pr: Int!) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $pr) {
           reviewThreads(first: 100) {
             nodes { isResolved }
           }
         }
       }
     }' -f owner=<OWNER> -f repo=<REPO> -F pr=<N> \
     --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length')
   ```
   If `UNRESOLVED > 0`, stop — there are unresolved review threads.

5. **Merge**:
   ```sh
   gh pr merge <N> --squash --auto --delete-branch
   ```
   Use `--squash` to keep the main branch history clean.
   Use `--auto` so GitHub waits for branch protection rules.
   Use `--delete-branch` to clean up the feature branch.

6. **Post a short comment** confirming the merge was enabled. Mention
   the total diff size and that all checks passed. Write it
   naturally — vary the wording, don't use a canned phrase.

## When NOT to merge

- The PR has "CHANGES_REQUESTED" reviews.
- The PR has unresolved review threads.
- The PR modifies security-sensitive code.
- The PR exceeds the size gate.
- Any required check is not green.
- Any check is still running (not yet completed).
- The PR targets a branch other than the repo's default branch.

In all these cases, leave a comment explaining why auto-merge was
skipped, and let a human decide.

## Notes

- This skill should be loaded by the coordinator after `mark-pr-ready`
  completes, or in response to a `pull_request.ready_for_review` webhook.
- The `--auto` flag on `gh pr merge` respects branch protection rules.
  If the repo requires approvals, the merge will wait until those are
  satisfied.
- Never force-merge or bypass branch protection.
