# Open CLI pull request migration

`migrate-open-prs.mjs` migrates open pull requests from `getsentry/cli` to
`getsentry/sentry-mcp` after the CLI and CLI documentation subtree imports.
It transfers changes only under `packages/cli/` and `apps/cli-docs/`. For pull
requests based before the monorepo layout commit, it uses an explicit old CLI
mapping whose source and destination boundaries are verified against that
immutable commit and maps those roots into
`packages/cli/`; it maps only the explicitly moved children of `docs/` into
`apps/cli-docs/`. A path that remained at the repository root or under `docs/`
is excluded even when the layout commit created a same-named path in an
imported destination. Unknown paths remain excluded as repository
administration changes.

## 1. Export and review a plan

```sh
pnpm migrate:open-prs --output cli-open-pr-migration-plan.json
```

This is always the default mode. It reads GitHub, clones into a temporary
directory, reconstructs commits, verifies exact scoped diffs, and writes one
new plan file. It never changes either repository. The command refuses to
overwrite an existing plan; choose a new path or remove the old plan after
reviewing it.

Review every entry, especially `mappedPaths` and `excludedPaths`. Root
workflows, repository administration, and all other paths stay in
`getsentry/cli`. An entry with no imported-path changes has `action: "skip"`.

The plan pins:

- every source PR's metadata, open state, head and advertised base SHA;
- source cutoff `fc1140092883409046438c8bb5d6f7f939eb9659`;
- filtered import tips `6b08e9029dc7e092bfebaa3870ca116e7dfdfc89` and
  `4358ec2729a60ef034f3866680fc5fd7bce62ce0`;
- each current source target, merge base, source layout, reconstructed
  destination commit, and byte-exact scoped change-manifest hash;
- stack relationships derived from exact source repository and base branch;
- destination-valid labels, assignees, reviewers, teams, and milestone mapping.

An advertised PR base SHA may be older than current `main` or its stack
parent. The tool resolves and pins the current target by repository and branch,
then computes the merge base. Linear histories replay commit by commit. A
history containing merge commits becomes one net-change commit with the source
head's author metadata. The final mapped status, file mode, and blob IDs must
match exactly.

The command fails on moved sources, binary changes, renames or copies,
symlinks, submodules, unsafe or ambiguous paths, patch conflicts, missing
import tips, and non-exact reconstructed changes.

Source `main` may advance past the recorded cutoff only through changes outside
`packages/cli` and `apps/cli-docs`. Any change under those imported paths
requires another subtree import before PR migration can continue.

## 2. Execute the reviewed plan

```sh
pnpm migrate:open-prs --execute --plan cli-open-pr-migration-plan.json
```

Execution fetches all source state again, rebuilds the plan from scratch, and
requires an exact match before the first write. Immediately before every
GitHub write, it fetches and compares every source target and destination base
in the entry's full stack against the plan. This includes skipped stack
parents. Any drift stops that phase before its write and prevents all later
mutations. It pushes
`migrated/cli-pr-N`, creates each destination PR as a draft, verifies the
remote head, base, and diff, then copies destination-valid metadata. New pull
requests start in their planned draft/ready state. Same-repository and fork PRs use the
source repository's immutable pull ref, while the snapshot retains the original
head repository. Only after verification does the script comment on
the source PR with the reciprocal link.

New destination branches use an atomic push with a must-not-exist
`--force-with-lease` guard. Existing destination branches are never pushed. A
partial run can resume when the existing branch SHA and exact scoped diff match
the plan. If the earlier run pushed the branch but failed before PR creation,
the rerun creates the missing PR. An existing pull request must have the exact
planned title, body marker, draft state, and either a known partial or complete
set of migration-owned labels, assignees, milestone, and reviewers. User-edited
or unknown metadata fails closed before any write. Any other branch or PR state
also fails closed.

Source PRs always stay open. GitHub cannot atomically create the destination PR
and close the source PR, so this tool never offers or performs source closure.

Use `--keep-temp` to retain the temporary clone after success or failure for
manual inspection.
