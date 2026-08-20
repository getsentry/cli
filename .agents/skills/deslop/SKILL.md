---
name: deslop
description: Strip AI-generated noise from the diff before pushing — extra comments a human wouldn't write, defensive try/catch in trusted code paths, casts to any, inline imports in Python, and other style inconsistencies with the surrounding file. Use this immediately before commit so the diff stays clean.
license: Apache-2.0
metadata:
  source: https://github.com/BYK/dotskills
  audience: autonomous-agents
---

# Remove AI Code Slop

Check the diff against the base branch and remove all AI-generated
slop introduced in this branch.

## What to remove

- Extra comments that a human wouldn't add or that are inconsistent
  with the rest of the file (no `// loop through items`, no
  `# increment counter`, no `// Handle the error case`).
- Extra defensive checks or try/catch blocks that are abnormal for
  that area of the codebase, especially when called from
  trusted/validated code paths.
- Casts to `any` (or `as unknown as X`) that exist purely to silence
  the type checker. If a type assertion is needed, use the narrowest
  correct type instead.
- Inline imports in Python — move to the top of the file alongside the
  other imports. Group with the appropriate import section (stdlib,
  third-party, local).
- Redundant type annotations where TypeScript inference handles it
  (e.g., `const x: string = "hello"` → `const x = "hello"`).
- Unnecessary `else` after `return`, `throw`, `continue`, or `break`.
- Console.log / print statements left from debugging.
- Overly verbose variable names that don't match the file's naming
  convention (e.g., `isCurrentlyLoadingDataFromServer` when neighbors
  use `loading`).
- Any other style that's inconsistent with the file (string quote
  choice, brace style, trailing commas, etc.).

## Process

1. Get the diff against the default branch:
   ```bash
   git diff $(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')...HEAD
   ```
2. For each changed file, scan for the patterns above.
3. Remove identified slop while preserving legitimate changes.
4. Report a 1–3 sentence summary of what was changed.

## Why

Code reviewers (human and bot) react badly to AI-generated noise: it
looks lazy, hides intent, and inflates the diff. A clean diff
gets merged faster.

---

*Adapted from [BYK/dotskills](https://github.com/BYK/dotskills)
(Apache-2.0).*
