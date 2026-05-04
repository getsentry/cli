# Code Comments

## Intent
Comments are for non-obvious intent, invariants, policy decisions, and tradeoffs.

They are not a narration layer for obvious code.

## Policy
- Add comments when behavior is easy to misread, policy-driven, or tied to a non-obvious invariant.
- Exported functions, classes, and types must have brief JSDoc explaining intent.
- Document fields when units, nullability, defaults, or allowed values are not obvious from the type.
- Prefer short JSDoc on tricky local helpers when future readers need context to change them safely.
- Keep comments concrete. Explain why the code exists or what boundary it protects.
- Delete or rewrite stale comments in the same change that alters behavior.

## Exceptions
- Do not comment obvious transformations or control flow.
- Do not restate code in English.
- Do not add decorative ASCII or box-drawing section dividers.
