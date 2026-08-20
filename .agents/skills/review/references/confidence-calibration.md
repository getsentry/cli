# Confidence Calibration

Assign a confidence level to each finding before including it in the
output. Only report findings at HIGH or MEDIUM confidence.

## Levels

| Level | Criteria | Action |
|---|---|---|
| **HIGH** | You traced the code path and verified the issue exists. The finding is demonstrably wrong, not hypothetically wrong. | Report as a finding. |
| **MEDIUM** | The pattern is suspicious and likely a problem, but you haven't fully traced every code path. The surrounding code suggests this wasn't intentional. | Report as a finding. Note uncertainty in `summary` if relevant. |
| **LOW** | The code looks unusual but could be intentional. You can construct a scenario where it breaks, but it requires unlikely inputs or specific timing. | Do **not** report. |

## Calibration guidelines

- **Bug findings should almost always be HIGH.** If you can't trace
  the code path to confirm the bug, it's not a bug finding — it's
  speculation. Downgrade to MEDIUM or drop it.

- **Test-gap findings are typically MEDIUM.** You can see the behavior
  isn't tested but can't always prove it would catch a real bug class.

- **Style findings should be HIGH** (you can see the neighboring code
  uses a different convention) or dropped (it's a taste preference).

- **Scope findings should be HIGH.** The change is demonstrably
  unrelated to the stated intent, or it isn't.

- **Docs findings are typically HIGH.** The comment is stale or it isn't.

## Common false positive patterns

Before reporting, check whether the "issue" is actually:

- **Intentional defensive code.** The function is called from multiple
  sites and the check is valid for some of them.
- **Framework convention.** The pattern looks unusual but is standard
  for the framework (e.g., empty catch blocks in error boundaries).
- **Existing behavior, not new.** The "issue" exists in the base
  branch too — the PR didn't introduce it.
