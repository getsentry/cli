# Investigation Protocol

Before editing any code, you should be able to articulate:

> "This breaks because **X**, in **Y** path, after **Z** condition."

If you cannot fill in X, Y, and Z, keep investigating.

## Steps

1. **Reproduce the problem.** Find the code path described in the
   issue. Trace it from entry point to the failure site. If the issue
   includes an error message or stack trace, locate the exact line.

2. **Understand the current behavior.** Read the code, not just the
   function — read its callers and the data flowing into it. Check
   tests (if any) to see what the expected behavior was.

3. **Identify the root cause.** Distinguish between:
   - The **symptom** (what the user sees)
   - The **proximate cause** (what line/condition triggers it)
   - The **root cause** (why that condition exists)

   Fix the root cause when possible. Fix the proximate cause only when
   the root cause is out of scope.

4. **State the fix hypothesis.** Before writing code, state in one
   sentence what you plan to change and why it addresses the root
   cause. This becomes part of the commit message.

## When investigation is blocked

- **Missing reproduction context**: if the issue lacks enough detail
  to identify the code path, ask via a PR comment (not a blocking
  question — ship what you can).
- **External dependencies**: if the root cause is in a dependency or
  external service, note it in the PR description and fix what's
  within scope.
- **Multiple possible causes**: if you find several plausible causes,
  fix the most likely one and note the alternatives in the PR.

## Anti-patterns

- Starting to code before understanding the failure path
- Reading only the function mentioned in the issue without checking callers
- Guessing based on function names without reading the implementation
- Fixing the symptom while leaving the root cause intact
