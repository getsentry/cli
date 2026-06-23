"""Command line interface for the PR risk MVP."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from .features import build_feature_rows, load_raw_dataset, write_feature_csv
from .git_history import build_git_pr_rows, collect_git_reverts_by_pr, survey_git_history
from .github import (
    GitHubClient,
    RepoRef,
    normalize_file,
    normalize_pr,
    normalize_review,
    parse_github_time,
    utc_now_iso,
    write_jsonl,
)
from .modeling import (
    DEFAULT_FEATURE_SET,
    apply_serialized_logistic_model,
    canonical_feature_set,
    logistic_markdown_report,
    train_logistic_baseline,
)
from .scoring import evaluate_predictions, markdown_report, score_feature_rows, write_json

DEFAULT_OUTCOMES = ["strong_outcome", "medium_outcome"]


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="risk-pr", description="Offline PR risk dataset tooling")
    subparsers = parser.add_subparsers(dest="command", required=True)

    backfill = subparsers.add_parser("backfill", help="Fetch PR data from GitHub")
    backfill.add_argument("--repo", action="append", required=True, help="GitHub repo as owner/name")
    backfill.add_argument("--out", default="data/raw", help="Output root for raw datasets")
    backfill.add_argument("--since", help="Only include PRs created on/after YYYY-MM-DD")
    backfill.add_argument("--until", help="Only include PRs created on/before YYYY-MM-DD")
    backfill.add_argument("--months", type=int, default=6, help="Months to backfill when --since is absent")
    backfill.add_argument("--max-prs", type=int, help="Maximum PRs per repo")
    backfill.add_argument("--skip-reviews", action="store_true", help="Skip PR review state backfill")
    backfill.add_argument("--resume", action="store_true", help="Reuse existing PR rows and fetch missing PRs")
    backfill.add_argument("--refresh", action="store_true", help="Refetch existing PR rows")
    backfill.add_argument("--sleep", type=float, default=0.0, help="Sleep between GitHub API requests")
    backfill.set_defaults(func=cmd_backfill)

    git_backfill = subparsers.add_parser("git-backfill", help="Build raw merged PR rows from local git history")
    git_backfill.add_argument("--repo", action="append", required=True, help="GitHub repo as owner/name")
    git_backfill.add_argument(
        "--git-repo",
        action="append",
        required=True,
        help="Local git repo path or owner/name=/path mapping",
    )
    git_backfill.add_argument("--git-ref", default="origin/master", help="Git ref to scan")
    git_backfill.add_argument("--out", default="data/raw-git", help="Output root for local-git raw datasets")
    git_backfill.add_argument("--since", help="Only include commits on/after YYYY-MM-DD")
    git_backfill.add_argument("--until", help="Only include commits on/before YYYY-MM-DD")
    git_backfill.add_argument("--months", type=int, default=24, help="Months to scan when --since is absent")
    git_backfill.add_argument("--max-prs", type=int, help="Maximum PR rows per repo")
    git_backfill.set_defaults(func=cmd_git_backfill)

    features = subparsers.add_parser("features", help="Build feature rows from a raw PR dataset")
    features.add_argument("--input", required=True, help="Raw prs.jsonl path")
    features.add_argument("--out", default="data/processed", help="Output root for feature datasets")
    features.set_defaults(func=cmd_features)

    score = subparsers.add_parser("score", help="Score feature rows and write an eval report")
    score.add_argument("--input", required=True, help="Feature JSONL path")
    score.add_argument("--out", default="data/processed", help="Output root for scored datasets")
    score.add_argument(
        "--outcome",
        action="append",
        help="Outcome field to evaluate. Repeatable. Defaults to strong_outcome and medium_outcome.",
    )
    score.add_argument(
        "--include-unmerged",
        action="store_true",
        help="Include unmerged/open PRs in evaluation. Default evaluates merged PRs only.",
    )
    score.set_defaults(func=cmd_score)

    build = subparsers.add_parser("build", help="Backfill, extract features, score, and evaluate")
    build.add_argument("--repo", action="append", required=True, help="GitHub repo as owner/name")
    build.add_argument("--out", default="data", help="Output root containing raw/ and processed/")
    build.add_argument("--since", help="Only include PRs created on/after YYYY-MM-DD")
    build.add_argument("--until", help="Only include PRs created on/before YYYY-MM-DD")
    build.add_argument("--months", type=int, default=12, help="Months to backfill when --since is absent")
    build.add_argument("--max-prs", type=int, help="Maximum PRs per repo")
    build.add_argument("--skip-reviews", action="store_true", help="Skip PR review state backfill")
    build.add_argument("--resume", action="store_true", help="Reuse existing PR rows and fetch missing PRs")
    build.add_argument("--refresh", action="store_true", help="Refetch existing PR rows")
    build.add_argument("--sleep", type=float, default=0.0, help="Sleep between GitHub API requests")
    build.add_argument(
        "--git-repo",
        action="append",
        help="Optional local git repo mapping as owner/name=/path for revert outcome enrichment",
    )
    build.add_argument("--git-ref", default="origin/master", help="Git ref for local git outcome enrichment")
    build.add_argument(
        "--outcome",
        action="append",
        help="Outcome field to evaluate. Repeatable. Defaults to strong_outcome and medium_outcome.",
    )
    build.add_argument(
        "--include-unmerged",
        action="store_true",
        help="Include unmerged/open PRs in evaluation. Default evaluates merged PRs only.",
    )
    build.set_defaults(func=cmd_build)

    survey = subparsers.add_parser("survey", help="Estimate repo slice size before a large backfill")
    survey.add_argument("--repo", required=True, help="GitHub repo as owner/name")
    survey.add_argument("--since", help="Only include PRs created on/after YYYY-MM-DD")
    survey.add_argument("--until", help="Only include PRs created on/before YYYY-MM-DD")
    survey.add_argument("--months", type=int, default=12, help="Months to survey when --since is absent")
    survey.add_argument("--git-repo", help="Optional local git checkout path for revert estimates")
    survey.add_argument("--git-ref", default="origin/master", help="Git ref for local git estimates")
    survey.set_defaults(func=cmd_survey)

    combine = subparsers.add_parser("combine", help="Combine feature datasets and evaluate them together")
    combine.add_argument("--input", action="append", required=True, help="Feature JSONL path")
    combine.add_argument("--out", default="data/processed/combined", help="Combined processed output directory")
    combine.add_argument(
        "--dedupe",
        action="store_true",
        help="Deduplicate by repo and PR number. Later --input rows replace earlier rows.",
    )
    combine.add_argument(
        "--outcome",
        action="append",
        help="Outcome field to evaluate. Repeatable. Defaults to strong_outcome and medium_outcome.",
    )
    combine.add_argument(
        "--include-unmerged",
        action="store_true",
        help="Include unmerged/open PRs in evaluation. Default evaluates merged PRs only.",
    )
    combine.set_defaults(func=cmd_combine)

    train = subparsers.add_parser("train", help="Train an interpretable logistic regression baseline")
    train.add_argument("--input", required=True, help="Feature JSONL path")
    train.add_argument("--out", default="data/processed", help="Output root for model artifacts")
    train.add_argument(
        "--outcome",
        action="append",
        help="Outcome field to train on. Repeatable. Defaults to medium_outcome.",
    )
    train.add_argument(
        "--include-unmerged",
        action="store_true",
        help="Include unmerged/open PRs as negatives. Default trains on merged PRs only.",
    )
    train.add_argument("--train-fraction", type=float, default=0.8, help="Chronological train split fraction")
    train.add_argument(
        "--validation-fraction",
        type=float,
        default=0.1,
        help="Chronological validation split fraction after train. Remaining rows are test.",
    )
    train.add_argument("--epochs", type=int, default=800, help="Gradient descent epochs")
    train.add_argument("--learning-rate", type=float, default=0.05, help="Gradient descent learning rate")
    train.add_argument("--l2", type=float, default=0.01, help="L2 regularization strength")
    train.add_argument(
        "--maturity-days",
        type=int,
        default=0,
        help=(
            "Exclude the newest N days from train/validation/test evaluation so recent PRs "
            "are not treated as final negatives before they have time to be reverted or fixed."
        ),
    )
    train.add_argument(
        "--feature-set",
        choices=[
            "static_no_process",
            "selected_static_v1",
            "at_open",
            "in_review_final",
            "in_review",
            "legacy",
        ],
        default=DEFAULT_FEATURE_SET,
        help=(
            "Feature set to train. static_no_process excludes comments/reviews/commit counts "
            "but still uses the fetched PR diff snapshot; selected_static_v1 uses the deterministic "
            "Meta-aligned MVP signal set; in_review_final includes final process signals; legacy "
            "keeps the pre-history-expansion feature list. at_open and in_review are accepted as aliases."
        ),
    )
    train.add_argument(
        "--no-class-balance",
        action="store_true",
        help="Disable balanced class weights for rare positive outcomes",
    )
    train.set_defaults(func=cmd_train)

    apply_model = subparsers.add_parser("apply-model", help="Apply a saved logistic model to feature rows")
    apply_model.add_argument("--input", required=True, help="Feature JSONL path")
    apply_model.add_argument("--model", required=True, help="Saved model_*.json path")
    apply_model.add_argument("--out", default="data/processed", help="Output root for modeled rows")
    apply_model.set_defaults(func=cmd_apply_model)

    score_pr = subparsers.add_parser("score-pr", help="Fetch and score one pull request")
    score_pr.add_argument(
        "--repo",
        default=os.environ.get("GITHUB_REPOSITORY"),
        help="GitHub repo as owner/name. Defaults to GITHUB_REPOSITORY.",
    )
    score_pr.add_argument("--pr", type=int, required=True, help="Pull request number to score")
    score_pr.add_argument(
        "--history",
        action="append",
        required=True,
        help=(
            "Raw historical PR JSONL/JSONL.GZ for this repo. Repeatable. "
            "Rows for the target PR are replaced with the freshly fetched PR."
        ),
    )
    score_pr.add_argument("--model", required=True, help="Saved model_*.json path")
    score_pr.add_argument("--out", help="Optional JSON output path")
    score_pr.add_argument("--summary-file", help="Optional markdown summary path, e.g. GITHUB_STEP_SUMMARY")
    score_pr.add_argument("--skip-reviews", action="store_true", help="Skip fetching current PR reviews")
    score_pr.add_argument(
        "--git-repo",
        help="Optional local git checkout for supplemental historical revert labels",
    )
    score_pr.add_argument("--git-ref", default="origin/master", help="Git ref for local git revert labels")
    score_pr.set_defaults(func=cmd_score_pr)

    args = parser.parse_args(argv)
    args.func(args)
    return 0


def cmd_backfill(args: argparse.Namespace) -> None:
    since = parse_since(args.since, args.months)
    until = parse_until(args.until)
    client = GitHubClient(sleep_seconds=args.sleep)

    for repo_value in args.repo:
        repo = RepoRef.parse(repo_value)
        backfill_repo(client, repo, Path(args.out), since, until, args)


def cmd_git_backfill(args: argparse.Namespace) -> None:
    since = parse_since(args.since, args.months)
    until = parse_until(args.until)
    git_repo_by_slug = parse_git_repo_specs(args.git_repo, args.repo)
    for repo_value in args.repo:
        repo = RepoRef.parse(repo_value)
        if repo.slug not in git_repo_by_slug:
            raise ValueError(f"missing --git-repo mapping for {repo.slug}")
        git_backfill_repo(
            repo,
            Path(args.out),
            git_repo_by_slug[repo.slug],
            args.git_ref,
            since,
            until,
            args.max_prs,
        )


def git_backfill_repo(
    repo: RepoRef,
    out_root: Path,
    git_repo: str,
    git_ref: str,
    since: datetime,
    until: Optional[datetime],
    max_prs: Optional[int],
) -> Path:
    out_dir = out_root / repo.path_slug
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_path = out_dir / "prs.jsonl"
    manifest_path = out_dir / "manifest.json"
    fetched_at = utc_now_iso()
    rows = build_git_pr_rows(
        repo.slug,
        git_repo,
        ref=git_ref,
        since=since,
        until=until,
        max_prs=max_prs,
        fetched_at=fetched_at,
    )
    write_jsonl(str(raw_path), rows)
    write_json(
        manifest_path,
        {
            "schema_version": 1,
            "repo": repo.slug,
            "data_source": "local_git",
            "git_repo": git_repo,
            "git_ref": git_ref,
            "fetched_at": fetched_at,
            "since": since.isoformat().replace("+00:00", "Z"),
            "until": until.isoformat().replace("+00:00", "Z") if until else None,
            "count": len(rows),
            "raw_path": str(raw_path),
        },
    )
    print(f"wrote {len(rows)} local-git PR rows to {raw_path}")
    return raw_path


def backfill_repo(
    client: GitHubClient,
    repo: RepoRef,
    out_root: Path,
    since: datetime,
    until: Optional[datetime],
    args: argparse.Namespace,
) -> Path:
    out_dir = out_root / repo.path_slug
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_path = out_dir / "prs.jsonl"
    partial_path = out_dir / "prs.in-progress.jsonl"
    manifest_path = out_dir / "manifest.json"

    existing_rows = (
        load_existing_rows(raw_path, partial_path) if args.resume and not args.refresh else {}
    )
    fetched_at = utc_now_iso()
    count = 0
    reused = 0
    fetched = 0
    seen_numbers = set()

    with partial_path.open("w", encoding="utf-8") as handle:
        for listed_pr in client.list_pull_requests(repo):
            created = parse_github_time(listed_pr.get("created_at"))
            if until and created and created > until:
                continue
            if created and created < since:
                break
            number = int(listed_pr["number"])
            if number in seen_numbers:
                continue
            seen_numbers.add(number)
            if args.max_prs and count >= args.max_prs:
                break
            if number in existing_rows:
                row = existing_rows[number]
                reused += 1
                print(f"reused {repo.slug}#{number}", flush=True)
            else:
                row = fetch_pr_row(client, repo, number, fetched_at, skip_reviews=args.skip_reviews)
                fetched += 1
                print(
                    f"fetched {repo.slug}#{number} "
                    f"({len(row['files'])} files, {len(row['reviews'])} reviews)",
                    flush=True,
                )
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
            handle.flush()
            count += 1

    partial_path.replace(raw_path)
    manifest = {
        "schema_version": 1,
        "repo": repo.slug,
        "fetched_at": fetched_at,
        "since": since.isoformat().replace("+00:00", "Z"),
        "until": until.isoformat().replace("+00:00", "Z") if until else None,
        "count": count,
        "fetched_count": fetched,
        "reused_count": reused,
        "raw_path": str(raw_path),
        "partial_path": str(partial_path),
        "includes_reviews": not args.skip_reviews,
    }
    write_json(manifest_path, manifest)
    print(f"wrote {count} PRs to {raw_path} ({fetched} fetched, {reused} reused)", flush=True)
    return raw_path


def fetch_pr_row(
    client: GitHubClient, repo: RepoRef, number: int, fetched_at: str, skip_reviews: bool
) -> Dict[str, Any]:
    detail = client.get_pull_request(repo, number)
    row = normalize_pr(repo, detail, fetched_at)
    row["files"] = [normalize_file(item) for item in client.list_pull_files(repo, number)]
    row["reviews"] = []
    if not skip_reviews:
        row["reviews"] = [normalize_review(item) for item in client.list_pull_reviews(repo, number)]
    return row


def load_existing_rows(*paths: Path) -> Dict[int, Dict[str, Any]]:
    rows: Dict[int, Dict[str, Any]] = {}
    for path in paths:
        if not path.exists():
            continue
        for row in load_raw_dataset(str(path)):
            if row.get("number") is not None:
                rows[int(row["number"])] = row
    return rows


def cmd_features(args: argparse.Namespace) -> None:
    raw_path = Path(args.input)
    out_dir = Path(args.out) / raw_path.parent.name
    build_features_file(raw_path, out_dir)


def build_features_file(
    raw_path: Path,
    out_dir: Path,
    git_reverts_by_pr: Optional[Dict[int, List[Dict[str, Any]]]] = None,
    extra_manifest: Optional[Dict[str, Any]] = None,
) -> Path:
    rows = load_raw_dataset(str(raw_path))
    feature_rows = build_feature_rows(rows, git_reverts_by_pr=git_reverts_by_pr)
    out_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = out_dir / "features.jsonl"
    csv_path = out_dir / "features.csv"
    manifest_path = out_dir / "manifest.json"
    write_jsonl(str(jsonl_path), feature_rows)
    write_feature_csv(str(csv_path), feature_rows)
    manifest = {
        "schema_version": 1,
        "source": str(raw_path),
        "count": len(feature_rows),
        "jsonl_path": str(jsonl_path),
        "csv_path": str(csv_path),
    }
    if extra_manifest:
        manifest.update(extra_manifest)
    write_json(manifest_path, manifest)
    print(f"wrote {len(feature_rows)} feature rows to {jsonl_path}")
    print(f"wrote CSV to {csv_path}")
    return jsonl_path


def cmd_score(args: argparse.Namespace) -> None:
    feature_path = Path(args.input)
    out_dir = Path(args.out) / feature_path.parent.name
    score_feature_file(
        feature_path,
        out_dir,
        outcome_names=args.outcome or DEFAULT_OUTCOMES,
        include_unmerged=args.include_unmerged,
    )


def score_feature_file(
    feature_path: Path,
    out_dir: Path,
    outcome_names: List[str],
    include_unmerged: bool,
) -> Path:
    rows = load_raw_dataset(str(feature_path))
    scored_rows = score_feature_rows(rows)
    out_dir.mkdir(parents=True, exist_ok=True)
    scored_path = out_dir / "scored.jsonl"
    write_jsonl(str(scored_path), scored_rows)
    print(f"wrote scored rows to {scored_path}")
    for outcome_name in outcome_names:
        evaluation = evaluate_predictions(
            scored_rows, outcome_name=outcome_name, merged_only=not include_unmerged
        )
        suffix = f"_{outcome_name}" if len(outcome_names) > 1 else ""
        eval_path = out_dir / f"evaluation{suffix}.json"
        report_path = out_dir / f"evaluation{suffix}.md"
        write_json(eval_path, evaluation)
        report_path.write_text(markdown_report(evaluation), encoding="utf-8")
        print(f"wrote evaluation to {eval_path}")
        print(f"wrote markdown report to {report_path}")
    return scored_path


def cmd_build(args: argparse.Namespace) -> None:
    since = parse_since(args.since, args.months)
    until = parse_until(args.until)
    client = GitHubClient(sleep_seconds=args.sleep)
    out_root = Path(args.out)
    raw_root = out_root / "raw"
    processed_root = out_root / "processed"
    git_repo_by_slug = parse_git_repo_specs(args.git_repo or [], args.repo)
    for repo_value in args.repo:
        repo = RepoRef.parse(repo_value)
        raw_path = backfill_repo(client, repo, raw_root, since, until, args)
        git_reverts = None
        manifest_extra: Dict[str, Any] = {}
        if repo.slug in git_repo_by_slug:
            git_path = git_repo_by_slug[repo.slug]
            git_reverts = collect_git_reverts_by_pr(git_path, args.git_ref, since=since, until=until)
            manifest_extra = {
                "git_repo": git_path,
                "git_ref": args.git_ref,
                "git_revert_target_prs": len(git_reverts),
                "git_revert_commits": sum(len(commits) for commits in git_reverts.values()),
            }
        features_path = build_features_file(
            raw_path,
            processed_root / repo.path_slug,
            git_reverts_by_pr=git_reverts,
            extra_manifest=manifest_extra,
        )
        score_feature_file(
            features_path,
            processed_root / repo.path_slug,
            outcome_names=args.outcome or DEFAULT_OUTCOMES,
            include_unmerged=args.include_unmerged,
        )


def cmd_survey(args: argparse.Namespace) -> None:
    since = parse_since(args.since, args.months)
    until = parse_until(args.until)
    repo = RepoRef.parse(args.repo)
    client = GitHubClient()
    created_query = created_search_query(since, until)
    base_query = f"repo:{repo.slug} is:pr {created_query}".strip()
    total = client.search_issues_count(base_query)
    open_count = client.search_issues_count(f"{base_query} is:open")
    merged_count = client.search_issues_count(f"{base_query} is:merged")
    result: Dict[str, Any] = {
        "repo": repo.slug,
        "since": since.date().isoformat(),
        "until": until.date().isoformat() if until else None,
        "github": {
            "total_prs": total,
            "open_prs": open_count,
            "merged_prs": merged_count,
            "closed_unmerged_prs": max(total - open_count - merged_count, 0),
        },
    }
    if args.git_repo:
        result["git"] = survey_git_history(args.git_repo, args.git_ref, since=since, until=until)
    print(json.dumps(result, indent=2, sort_keys=True))


def cmd_combine(args: argparse.Namespace) -> None:
    combine_feature_files(
        [Path(value) for value in args.input],
        Path(args.out),
        outcome_names=args.outcome or DEFAULT_OUTCOMES,
        include_unmerged=args.include_unmerged,
        dedupe=args.dedupe,
    )


def cmd_train(args: argparse.Namespace) -> None:
    feature_path = Path(args.input)
    out_dir = Path(args.out) / feature_path.parent.name
    train_feature_file(
        feature_path,
        out_dir,
        outcome_names=args.outcome or ["medium_outcome"],
        include_unmerged=args.include_unmerged,
        train_fraction=args.train_fraction,
        validation_fraction=args.validation_fraction,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        l2=args.l2,
        class_balance=not args.no_class_balance,
        feature_set=args.feature_set,
        maturity_days=args.maturity_days,
    )


def cmd_apply_model(args: argparse.Namespace) -> None:
    feature_path = Path(args.input)
    model_path = Path(args.model)
    out_dir = Path(args.out) / feature_path.parent.name
    apply_model_file(feature_path, model_path, out_dir)


def cmd_score_pr(args: argparse.Namespace) -> None:
    if not args.repo:
        raise ValueError("--repo is required when GITHUB_REPOSITORY is not set")
    repo = RepoRef.parse(args.repo)
    result = score_pull_request(
        repo=repo,
        pr_number=args.pr,
        history_paths=[Path(value) for value in args.history],
        model_path=Path(args.model),
        skip_reviews=args.skip_reviews,
        git_repo=args.git_repo,
        git_ref=args.git_ref,
    )
    if args.out:
        write_json(Path(args.out), result)
    if args.summary_file:
        Path(args.summary_file).write_text(result["markdown_summary"], encoding="utf-8")
    elif os.environ.get("GITHUB_STEP_SUMMARY"):
        Path(os.environ["GITHUB_STEP_SUMMARY"]).write_text(result["markdown_summary"], encoding="utf-8")
    write_github_outputs(result)
    print(result["markdown_summary"])


def combine_feature_files(
    input_paths: Sequence[Path],
    out_dir: Path,
    outcome_names: List[str],
    include_unmerged: bool,
    dedupe: bool = False,
) -> Path:
    rows: List[Dict[str, Any]] = []
    for input_path in input_paths:
        rows.extend(load_raw_dataset(str(input_path)))
    if dedupe:
        by_key: Dict[tuple[str, int], Dict[str, Any]] = {}
        for row in rows:
            by_key[(row.get("repo") or "", int(row.get("number") or 0))] = row
        rows = sorted(
            by_key.values(),
            key=lambda row: (
                row.get("created_at") or "",
                row.get("repo") or "",
                int(row.get("number") or 0),
            ),
            reverse=True,
        )
    out_dir.mkdir(parents=True, exist_ok=True)
    feature_path = out_dir / "features.jsonl"
    csv_path = out_dir / "features.csv"
    write_jsonl(str(feature_path), rows)
    write_feature_csv(str(csv_path), rows)
    write_json(
        out_dir / "manifest.json",
        {
            "schema_version": 1,
            "sources": [str(path) for path in input_paths],
            "count": len(rows),
            "dedupe": dedupe,
            "jsonl_path": str(feature_path),
            "csv_path": str(csv_path),
        },
    )
    print(f"wrote {len(rows)} combined feature rows to {feature_path}")
    print(f"wrote CSV to {csv_path}")
    score_feature_file(feature_path, out_dir, outcome_names, include_unmerged)
    return feature_path


def train_feature_file(
    feature_path: Path,
    out_dir: Path,
    outcome_names: List[str],
    include_unmerged: bool,
    train_fraction: float,
    epochs: int,
    learning_rate: float,
    l2: float,
    class_balance: bool,
    validation_fraction: float = 0.1,
    feature_set: str = DEFAULT_FEATURE_SET,
    maturity_days: int = 0,
) -> List[Path]:
    rows = load_raw_dataset(str(feature_path))
    out_dir.mkdir(parents=True, exist_ok=True)
    model_paths: List[Path] = []
    canonical_set = canonical_feature_set(feature_set)
    for outcome_name in outcome_names:
        result = train_logistic_baseline(
            rows,
            outcome_name=outcome_name,
            train_fraction=train_fraction,
            validation_fraction=validation_fraction,
            epochs=epochs,
            learning_rate=learning_rate,
            l2=l2,
            class_balance=class_balance,
            include_unmerged=include_unmerged,
            feature_set=feature_set,
            maturity_days=maturity_days,
        )
        artifact_stem = (
            f"{canonical_set}_{outcome_name}" if canonical_set != DEFAULT_FEATURE_SET else outcome_name
        )
        model_path = out_dir / f"model_{artifact_stem}.json"
        eval_path = out_dir / f"model_evaluation_{artifact_stem}.json"
        report_path = out_dir / f"model_{artifact_stem}.md"
        modeled_path = out_dir / f"modeled_{artifact_stem}.jsonl"
        write_json(model_path, result["model"])
        write_json(
            eval_path,
            {
                "schema_version": 1,
                "outcome_name": outcome_name,
                "train_evaluation": result["train_evaluation"],
                "validation_evaluation": result["validation_evaluation"],
                "test_evaluation": result["test_evaluation"],
                "all_evaluation": result["all_evaluation"],
            },
        )
        report_path.write_text(logistic_markdown_report(result), encoding="utf-8")
        write_jsonl(str(modeled_path), result["modeled_rows"])
        print(f"wrote logistic model to {model_path}")
        print(f"wrote logistic evaluation to {eval_path}")
        print(f"wrote logistic report to {report_path}")
        print(f"wrote logistic scored rows to {modeled_path}")
        model_paths.append(model_path)
    return model_paths


def apply_model_file(feature_path: Path, model_path: Path, out_dir: Path) -> Path:
    rows = load_raw_dataset(str(feature_path))
    model = json.loads(model_path.read_text(encoding="utf-8"))
    modeled_rows = apply_serialized_logistic_model(rows, model)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = model_path.stem.removeprefix("model_")
    modeled_path = out_dir / f"modeled_{stem}.jsonl"
    manifest_path = out_dir / f"model_application_{stem}.json"
    write_jsonl(str(modeled_path), modeled_rows)
    write_json(
        manifest_path,
        {
            "schema_version": 1,
            "feature_path": str(feature_path),
            "model_path": str(model_path),
            "modeled_path": str(modeled_path),
            "rows": len(modeled_rows),
            "outcome_name": model.get("outcome_name"),
            "feature_set": model.get("feature_set"),
            "percentile_mode": model.get("percentile_mode"),
        },
    )
    print(f"wrote modeled rows to {modeled_path}")
    print(f"wrote model application manifest to {manifest_path}")
    return modeled_path


def score_pull_request(
    repo: RepoRef,
    pr_number: int,
    history_paths: Sequence[Path],
    model_path: Path,
    skip_reviews: bool = False,
    git_repo: Optional[str] = None,
    git_ref: str = "origin/master",
    client: Optional[GitHubClient] = None,
) -> Dict[str, Any]:
    client = client or GitHubClient()
    current_row = fetch_pr_row(client, repo, pr_number, utc_now_iso(), skip_reviews=skip_reviews)
    current_row["data_source"] = "github_api"

    historical_rows: List[Dict[str, Any]] = []
    for history_path in history_paths:
        historical_rows.extend(load_raw_dataset(str(history_path)))
    historical_rows = [
        row
        for row in historical_rows
        if row.get("repo") == repo.slug and int(row.get("number") or 0) != pr_number
    ]
    raw_rows = dedupe_raw_rows([*historical_rows, current_row])
    if len(raw_rows) <= 1:
        raise ValueError("score-pr requires at least one historical PR row plus the current PR")

    git_reverts = None
    if git_repo:
        since, until = created_bounds(raw_rows)
        git_reverts = collect_git_reverts_by_pr(git_repo, git_ref, since=since, until=until)

    feature_rows = build_feature_rows(raw_rows, git_reverts_by_pr=git_reverts)
    model = json.loads(model_path.read_text(encoding="utf-8"))
    modeled_rows = apply_serialized_logistic_model(feature_rows, model)
    current = next(
        (
            row
            for row in modeled_rows
            if row.get("repo") == repo.slug and int(row.get("number") or 0) == pr_number
        ),
        None,
    )
    if not current:
        raise ValueError(f"could not find modeled row for {repo.slug}#{pr_number}")

    result = {
        "schema_version": 1,
        "repo": repo.slug,
        "number": pr_number,
        "model_path": str(model_path),
        "history_paths": [str(path) for path in history_paths],
        "history_rows": len(raw_rows) - 1,
        "model": {
            "outcome_name": model.get("outcome_name"),
            "feature_set": model.get("feature_set"),
            "percentile_mode": model.get("percentile_mode"),
        },
        "prediction": current.get("prediction") or {},
        "prediction_features": current.get("prediction_features") or {},
        "title": current.get("title"),
        "html_url": current.get("html_url"),
        "author": current.get("author"),
        "created_at": current.get("created_at"),
    }
    result["markdown_summary"] = pr_risk_markdown_summary(result)
    return result


def dedupe_raw_rows(rows: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_key: Dict[tuple[str, int], Dict[str, Any]] = {}
    for row in rows:
        if row.get("number") is None:
            continue
        key = (row.get("repo") or "", int(row["number"]))
        by_key[key] = row
    return sorted(
        by_key.values(),
        key=lambda row: (
            row.get("created_at") or "",
            row.get("repo") or "",
            int(row.get("number") or 0),
        ),
    )


def created_bounds(rows: Sequence[Dict[str, Any]]) -> tuple[datetime, Optional[datetime]]:
    values = [
        parse_github_time(row.get("created_at"))
        for row in rows
        if row.get("created_at")
    ]
    values = [value for value in values if value]
    if not values:
        now = datetime.now(timezone.utc)
        return now - timedelta(days=365), now
    return min(values), max(values)


def write_github_outputs(result: Dict[str, Any]) -> None:
    output_path = os.environ.get("GITHUB_OUTPUT")
    if not output_path:
        return
    prediction = result.get("prediction") or {}
    with open(output_path, "a", encoding="utf-8") as handle:
        handle.write(
            f"risk_label={prediction.get('final_risk_label') or prediction.get('logistic_risk_label') or prediction.get('risk_label') or ''}\n"
        )
        handle.write(f"final_risk_label={prediction.get('final_risk_label', '')}\n")
        handle.write(f"final_risk_policy={prediction.get('final_risk_policy', '')}\n")
        handle.write(f"logistic_risk_label={prediction.get('logistic_risk_label', '')}\n")
        handle.write(f"rule_risk_label={prediction.get('risk_label', '')}\n")
        handle.write(f"logistic_probability={prediction.get('logistic_probability', '')}\n")
        handle.write(f"logistic_percentile_repo={prediction.get('logistic_percentile_repo', '')}\n")
        handle.write(f"rule_percentile_repo={prediction.get('risk_percentile_repo', '')}\n")


def pr_risk_markdown_summary(result: Dict[str, Any]) -> str:
    prediction = result.get("prediction") or {}
    features = result.get("prediction_features") or {}
    label = str(
        prediction.get("final_risk_label")
        or prediction.get("logistic_risk_label")
        or prediction.get("risk_label")
        or "unknown"
    )
    probability = prediction.get("logistic_probability")
    percentile = prediction.get("logistic_percentile_repo")
    rule_percentile = prediction.get("risk_percentile_repo")
    churn_percentile = prediction.get("churn_percentile_repo")
    signals = prediction.get("signals") or []
    signal_names = [signal.get("name") for signal in signals if signal.get("name")]

    lines = [
        "# PR Risk Summary",
        "",
        f"- PR: [{result.get('repo')}#{result.get('number')}]({result.get('html_url')})",
        f"- Title: {result.get('title')}",
        f"- Risk label: `{label}`",
        f"- Logistic risk label: `{prediction.get('logistic_risk_label', 'unknown')}`",
        f"- Rule risk label: `{prediction.get('risk_label', 'unknown')}`",
        f"- Final risk policy: `{prediction.get('final_risk_policy', 'n/a')}`",
        f"- Logistic probability: `{format_optional_float(probability)}`",
        f"- Logistic repo percentile: `{format_optional_float(percentile)}`",
        f"- Rule repo percentile: `{format_optional_float(rule_percentile)}`",
        f"- Churn repo percentile: `{format_optional_float(churn_percentile)}`",
        f"- Historical rows used: `{result.get('history_rows')}`",
        "",
        "## Main Signals",
        "",
    ]
    if signal_names:
        for name in signal_names[:8]:
            lines.append(f"- `{name}`")
    else:
        lines.append("- No rule-level risk signals fired.")
    lines.extend(
        [
            "",
            "## Deterministic Features",
            "",
            f"- Changed lines: `{features.get('changed_lines', 0)}`",
            f"- Files changed: `{features.get('file_count', 0)}`",
            f"- Directories changed: `{features.get('directory_count', 0)}`",
            f"- Max relative file churn: `{features.get('max_file_churn_ratio', 0)}`",
            f"- Author touched-file ratio: `{features.get('author_touched_file_ratio', 0)}`",
            f"- Prior bad outcomes on touched files: `{features.get('max_file_prior_bad_outcomes', 0)}`",
            f"- Tests changed: `{features.get('tests_changed', False)}`",
            f"- Code changed without test-path signal: `{features.get('code_changed_without_test_signal', False)}`",
            "",
            "> Experimental advisory signal only. This workflow should not block merges yet.",
            "",
        ]
    )
    return "\n".join(lines)


def format_optional_float(value: Any) -> str:
    if value is None or value == "":
        return "n/a"
    try:
        return f"{float(value):.3f}"
    except (TypeError, ValueError):
        return str(value)


def parse_since(value: Optional[str], months: int) -> datetime:
    if value:
        parsed = datetime.strptime(value, "%Y-%m-%d")
        return parsed.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - timedelta(days=months * 30)


def parse_until(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    parsed = datetime.strptime(value, "%Y-%m-%d")
    return parsed.replace(tzinfo=timezone.utc) + timedelta(days=1) - timedelta(microseconds=1)


def parse_git_repo_specs(specs: Sequence[str], repo_values: Sequence[str]) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    parsed_repos = [RepoRef.parse(value).slug for value in repo_values]
    for spec in specs:
        if "=" in spec:
            slug, path = spec.split("=", 1)
            mapping[RepoRef.parse(slug).slug] = path
        elif len(parsed_repos) == 1:
            mapping[parsed_repos[0]] = spec
        else:
            raise ValueError("--git-repo without owner/name=path is only allowed with one --repo")
    return mapping


def created_search_query(since: datetime, until: Optional[datetime]) -> str:
    since_value = since.date().isoformat()
    if until:
        return f"created:{since_value}..{until.date().isoformat()}"
    return f"created:>={since_value}"


if __name__ == "__main__":
    raise SystemExit(main())
