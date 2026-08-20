---
name: review
description: Review the current branch's changes against intent. Returns a structured list of findings the caller can hand to a fix-applier, or an empty list when there's nothing to address. Use this for both self-review of your own work and reviewing someone else's PR.
license: Apache-2.0
metadata:
  source: https://github.com/BYK/dotskills
  audience: autonomous-agents
---

# Review changes

Read the diff against the default branch and produce a structured list
of findings. The caller decides what to do with them — apply fixes
directly, post a review on GitHub, or both.

## Process

1. Resolve the default branch and diff:
   ```sh
   DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
   git diff "$DEFAULT_BRANCH"...HEAD
   ```
   Three-dot syntax shows just what this branch added, not unrelated
   changes that landed on the default branch since branching.

2. For larger diffs, read the changed files top to bottom before
   judging, so you don't carry the implementation's "obvious in
   context" bias. You may delegate the read-and-summarize pass to the
   `explore` subagent (cheaper, read-only) to get a structured rundown
   of what changed — but make every review *judgment* (is this a real
   finding?) yourself.

3. If a test suite exists, run it to verify the changes don't break
   anything. Check `package.json` scripts, `Makefile`, `pytest.ini`,
   `go.mod`, or CI workflow files for the test command. If tests fail
   on code unrelated to the diff, note it but don't flag it. If tests
   fail on changed code, add a `bug` finding.

4. Read every change against the PR's stated intent (PR body + linked
   issues via `gh issue view`). For each concern, classify it:

   - **bug** — logic doesn't match intent, broken edge case (null,
     empty, concurrency), incorrect assumption, factual error.
   - **test-gap** — new behavior added without test coverage on a
     critical path.
   - **style** — inconsistent with surrounding code (string quotes,
     brace style, naming).
   - **scope** — diff includes changes unrelated to the stated intent.
   - **docs** — stale comments or PR description doesn't match diff.

## Output format

Emit a JSON block as the FINAL part of your reply, exactly:

```json
{
  "findings": [
    {
      "kind": "bug" | "test-gap" | "style" | "scope" | "docs",
      "file": "<path/to/file>",
      "line": <number or null>,
      "summary": "<one sentence>",
      "suggested_fix": "<one or two sentences describing the fix>"
    }
  ]
}
```

If there's nothing to address, return `{ "findings": [] }`.

Keep `summary` and `suggested_fix` terse — one or two sentences each.
The fix-applier reading these has the file open already; don't restate
context the diff already carries.

## Confidence calibration

Assign a confidence level to each potential finding before including
it. See `references/confidence-calibration.md` for the full table.

- **HIGH** — you traced the code path and verified the issue. Report it.
- **MEDIUM** — the pattern is suspicious and likely wrong. Report it,
  noting uncertainty in `summary` if relevant.
- **LOW** — the code looks unusual but could be intentional. Do **not**
  report it.

Bug findings should almost always be HIGH. If you can't trace the
code path to confirm the issue, it's speculation — downgrade or drop.

## When to flag vs. not

- A `style` finding only counts if the PR's *neighbouring* code uses a
  different convention. Don't flag general taste preferences.
- A `test-gap` finding only counts when the missing test would have
  caught a real bug class — not "every new function needs a test."
- A `scope` finding is high-confidence: the diff demonstrably includes
  a change unrelated to the issue. When in doubt, don't flag.
- Don't include "everything looks good" notes in `findings`. Empty
  array is the correct positive signal.

## Not a finding

Before reporting, check `references/not-a-finding.md` for patterns
that look suspicious but are typically correct. Common examples:

- Null checks on values that "should" be set (defensive, valid if
  function is public or called from multiple sites)
- Empty catch blocks in error boundaries (framework convention)
- Trivial getters/setters (not worth a test-gap finding)
- Fixing a typo adjacent to changed code (not scope creep)
- TODO comments describing known limitations (not stale docs)

---

*Adapted from [BYK/dotskills](https://github.com/BYK/dotskills)
(Apache-2.0). The original was prose-only; this version produces
structured output so a downstream fix-applier can act on findings
mechanically.*
