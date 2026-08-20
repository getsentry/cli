---
name: repo-setup
description: Refresh /workspace/repo and prepare the correct branch. Load this before any situation skill.
license: Apache-2.0
metadata:
  audience: autonomous-agents
---

# Repository Setup

The target repository is already cloned by the container runtime at
`/workspace/repo`. Work directly in that checkout — do not create git
worktrees or clone a second copy of the target repo. Each issue/PR gets its
own container, so `/workspace/repo` is already isolated.

## Steps

1. **Enter the repository and refresh refs**:
   ```sh
   cd /workspace/repo
   git fetch --all --prune
   ```

2. **Determine the branch name**:
   - **New issue**: `issue-<number>-<slug>` (e.g. `issue-42-fix-login`)
   - **Existing PR**: get the PR head branch with:
     ```sh
     BRANCH=$(gh pr view <number> --json headRefName --jq .headRefName)
     ```
   - **Operator chat** (a `New operator chat` turn — a repo but no issue/PR):
     there is nothing to branch from yet. Stay on the default branch for
     read-only exploration and answering questions. Only create a branch once
     the operator asks for a change that needs a PR, and name it for the work
     (e.g. `chat-<slug>`); don't invent an `issue-*` branch for a chat.

3. **Preserve in-progress follow-up work**. If `/workspace/repo` is already on
   the intended branch and has uncommitted changes, keep them and skip branch
   reset/checkout. The previous event may have left in-progress changes that the
   current follow-up event needs to continue. If there are uncommitted changes
   on a different branch, stop and inspect before switching — do not risk
   carrying changes to the wrong branch or discarding work.
   ```sh
   git status --short
   git branch --show-current
   ```

4. **Prepare the branch in `/workspace/repo`** if step 3 did not already find
   the right branch with in-progress changes:

   - **New issue** — create or reset the issue branch from the default branch:
     ```sh
     DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
     git switch -C <branch> "origin/$DEFAULT_BRANCH"
     ```

   - **Existing PR** — check out the PR branch:
     ```sh
     gh pr checkout <number>
     ```
     If `gh pr checkout` fails, fall back to:
     ```sh
     git fetch origin "$BRANCH:$BRANCH" 2>/dev/null || true
     git switch "$BRANCH"
     git pull --ff-only origin "$BRANCH" 2>/dev/null || true
     ```

5. **Run all subsequent commands from `/workspace/repo`**.

## Important

- Never push to or force-push the default branch.
- Never `git reset --hard` or `git clean -fd` when there are uncommitted
  changes unless the situation skill explicitly determines those changes are
  disposable.
- Multi-repo investigation may clone **other** repositories under `~/dev/...`,
  but the target repo for this issue/PR stays `/workspace/repo`.
