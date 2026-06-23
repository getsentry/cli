"""Feature and outcome extraction for PR risk datasets."""

from __future__ import annotations

import csv
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import PurePosixPath
from typing import Any, DefaultDict, Dict, Iterable, Iterator, List, Optional, Sequence, Set, Tuple

from .github import parse_github_time, read_jsonl


REVERT_SHA_RE = re.compile(r"\bthis reverts commit\s+([0-9a-f]{7,40})\b", re.IGNORECASE)
ISSUE_REF_RE = re.compile(r"(?<![\w-])#(\d+)\b")
QUOTED_TEXT_RE = re.compile(r"['\"]([^'\"]{8,160})['\"]")
FOLLOWUP_FIX_RE = re.compile(
    r"\b(fix|fixes|fixed|hotfix|regression|rollback|restore)\b|roll back",
    re.IGNORECASE,
)
ERROR_HANDLING_RE = re.compile(
    r"\b(try|except|catch|finally|throw|raise|panic|error|exception|rollback|fallback)\b",
    re.IGNORECASE,
)
ASYNC_CONCURRENCY_RE = re.compile(
    r"\b(async|await|thread|mutex|lock|race|concurrent|parallel|queue|worker|consumer|producer)\b",
    re.IGNORECASE,
)
SERIALIZATION_RE = re.compile(
    r"\b(json|serialize|deserialize|schema|payload|protobuf|pickle|marshal|encode|decode)\b",
    re.IGNORECASE,
)
DATA_DELETION_RE = re.compile(
    r"\b(delete|deleted|remove|removed|drop table|truncate|purge|cascade|destroy)\b",
    re.IGNORECASE,
)

DOC_EXTENSIONS = {
    ".adoc",
    ".md",
    ".mdx",
    ".rst",
    ".txt",
}
CODE_EXTENSIONS = {
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".css",
    ".go",
    ".h",
    ".hpp",
    ".java",
    ".js",
    ".jsx",
    ".kt",
    ".m",
    ".mm",
    ".php",
    ".py",
    ".rb",
    ".rs",
    ".scala",
    ".sh",
    ".sql",
    ".swift",
    ".ts",
    ".tsx",
}
CONFIG_EXTENSIONS = {
    ".cfg",
    ".conf",
    ".ini",
    ".json",
    ".toml",
    ".yaml",
    ".yml",
}
LOCKFILES = {
    "cargo.lock",
    "composer.lock",
    "gemfile.lock",
    "go.sum",
    "package-lock.json",
    "pnpm-lock.yaml",
    "poetry.lock",
    "requirements.lock",
    "yarn.lock",
}
LANGUAGE_BY_EXTENSION = {
    ".c": "c",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".css": "css",
    ".go": "go",
    ".h": "c",
    ".hpp": "cpp",
    ".java": "java",
    ".js": "javascript",
    ".jsx": "javascript",
    ".kt": "kotlin",
    ".m": "objective-c",
    ".mm": "objective-c",
    ".php": "php",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".scala": "scala",
    ".sh": "shell",
    ".sql": "sql",
    ".swift": "swift",
    ".ts": "typescript",
    ".tsx": "typescript",
}


RECENT_EXPERIENCE_WINDOW = timedelta(days=90)
FOLLOWUP_FIX_STRICT_WINDOW = timedelta(days=30)
BAD_OUTCOME_WINDOWS = {
    "90d": timedelta(days=90),
    "365d": timedelta(days=365),
}


def build_feature_rows(
    raw_rows: Sequence[Dict[str, Any]],
    git_reverts_by_pr: Optional[Dict[int, List[Dict[str, Any]]]] = None,
) -> List[Dict[str, Any]]:
    """Build leakage-aware feature rows from normalized raw PR records."""

    outcomes = infer_revert_outcomes(raw_rows, git_reverts_by_pr=git_reverts_by_pr)
    rows_by_number = {int(row["number"]): row for row in raw_rows}
    revert_events = _build_revert_events(raw_rows, outcomes)
    bad_outcome_events = _build_bad_outcome_events(raw_rows, outcomes)
    touch_events = _build_touch_events(raw_rows)

    sorted_rows = sorted(raw_rows, key=lambda row: row.get("created_at") or "")
    revert_events.sort(key=lambda event: event[0])
    bad_outcome_events.sort(key=lambda event: event[0])
    touch_events.sort(key=lambda event: event[0])

    file_touch_counts: DefaultDict[str, int] = defaultdict(int)
    dir_touch_counts: DefaultDict[str, int] = defaultdict(int)
    top_dir_touch_counts: DefaultDict[str, int] = defaultdict(int)
    file_revert_counts: DefaultDict[str, int] = defaultdict(int)
    dir_revert_counts: DefaultDict[str, int] = defaultdict(int)
    file_bad_outcome_counts: DefaultDict[str, int] = defaultdict(int)
    dir_bad_outcome_counts: DefaultDict[str, int] = defaultdict(int)
    file_bad_outcome_times: DefaultDict[str, List[datetime]] = defaultdict(list)
    dir_bad_outcome_times: DefaultDict[str, List[datetime]] = defaultdict(list)
    file_estimated_sloc: DefaultDict[str, int] = defaultdict(int)
    file_authors: DefaultDict[str, Set[str]] = defaultdict(set)
    dir_authors: DefaultDict[str, Set[str]] = defaultdict(set)
    top_dir_authors: DefaultDict[str, Set[str]] = defaultdict(set)
    file_last_touched_at: Dict[str, datetime] = {}
    file_touch_times: DefaultDict[str, List[datetime]] = defaultdict(list)
    dir_touch_times: DefaultDict[str, List[datetime]] = defaultdict(list)
    author_repo_touch_times: DefaultDict[str, List[datetime]] = defaultdict(list)
    author_file_touch_counts: DefaultDict[Tuple[str, str], int] = defaultdict(int)
    author_dir_touch_counts: DefaultDict[Tuple[str, str], int] = defaultdict(int)
    author_top_dir_touch_counts: DefaultDict[Tuple[str, str], int] = defaultdict(int)
    file_first_author: Dict[str, str] = {}
    revert_event_index = 0
    bad_event_index = 0
    touch_event_index = 0
    feature_rows: List[Dict[str, Any]] = []

    for row in sorted_rows:
        created = parse_github_time(row.get("created_at"))
        if created:
            while revert_event_index < len(revert_events) and revert_events[revert_event_index][0] <= created:
                _, event_files = revert_events[revert_event_index]
                for path in event_files:
                    file_revert_counts[path] += 1
                    dir_revert_counts[parent_dir(path)] += 1
                revert_event_index += 1
            while bad_event_index < len(bad_outcome_events) and bad_outcome_events[bad_event_index][0] < created:
                event_time, event_files = bad_outcome_events[bad_event_index]
                for path in event_files:
                    file_bad_outcome_counts[path] += 1
                    dir_path = parent_dir(path)
                    dir_bad_outcome_counts[dir_path] += 1
                    file_bad_outcome_times[path].append(event_time)
                    dir_bad_outcome_times[dir_path].append(event_time)
                bad_event_index += 1
            while touch_event_index < len(touch_events) and touch_events[touch_event_index][0] < created:
                event_time, event_author, event_files = touch_events[touch_event_index]
                _apply_touch_event(
                    event_time,
                    event_author,
                    event_files,
                    file_touch_counts,
                    dir_touch_counts,
                    top_dir_touch_counts,
                    file_authors,
                    dir_authors,
                    top_dir_authors,
                    file_last_touched_at,
                    file_touch_times,
                    dir_touch_times,
                    author_repo_touch_times,
                    author_file_touch_counts,
                    author_dir_touch_counts,
                    author_top_dir_touch_counts,
                    file_first_author,
                    file_estimated_sloc,
                )
                touch_event_index += 1

        files = row.get("files") or []
        paths = [file_info.get("filename") for file_info in files if file_info.get("filename")]
        file_summary = summarize_files(files)
        relative_churn = summarize_relative_churn(files, file_estimated_sloc)
        patch_summary = summarize_patch_signals(files)
        review_summary = summarize_reviews(row.get("reviews") or [])
        author = (row.get("author") or {}).get("login") or ""
        history = summarize_history(
            paths,
            created,
            author,
            file_touch_counts,
            dir_touch_counts,
            top_dir_touch_counts,
            file_revert_counts,
            dir_revert_counts,
            file_bad_outcome_counts,
            dir_bad_outcome_counts,
            file_bad_outcome_times,
            dir_bad_outcome_times,
            file_authors,
            dir_authors,
            top_dir_authors,
            file_last_touched_at,
            file_touch_times,
            dir_touch_times,
            author_repo_touch_times,
            author_file_touch_counts,
            author_dir_touch_counts,
            author_top_dir_touch_counts,
            file_first_author,
        )
        source_type = classify_source_type(row)
        prediction_features = {
            "source_type": source_type,
            **row.get("metrics", {}),
            **file_summary,
            **relative_churn,
            **patch_summary,
            **history,
            **summarize_text(row),
        }

        number = int(row["number"])
        outcome = outcomes[number]
        outcome["review_requested_changes_count"] = review_summary["requested_changes"]
        outcome["review_approval_count"] = review_summary["approved"]
        outcome["review_comment_count"] = row.get("metrics", {}).get("review_comments", 0)
        outcome["issue_comment_count"] = row.get("metrics", {}).get("comments", 0)
        outcome["is_hotfix_like"] = is_hotfix_like(row)
        outcome["weak_review_churn"] = bool(
            outcome["review_requested_changes_count"] >= 2
            or outcome["review_comment_count"] >= 10
            or (row.get("metrics", {}).get("commits", 0) or 0) >= 10
        )

        feature_rows.append(
            {
                "schema_version": 1,
                "repo": row.get("repo"),
                "data_source": row.get("data_source"),
                "number": number,
                "html_url": row.get("html_url"),
                "title": row.get("title") or "",
                "author": author,
                "created_at": row.get("created_at"),
                "merged_at": row.get("merged_at"),
                "closed_at": row.get("closed_at"),
                "prediction_features": prediction_features,
                "outcomes": outcome,
            }
        )

    return sorted(feature_rows, key=lambda row: row["created_at"] or "", reverse=True)


def infer_revert_outcomes(
    raw_rows: Sequence[Dict[str, Any]],
    git_reverts_by_pr: Optional[Dict[int, List[Dict[str, Any]]]] = None,
) -> Dict[int, Dict[str, Any]]:
    rows_by_number = {int(row["number"]): row for row in raw_rows}
    sha_to_number: Dict[str, int] = {}
    title_to_number: Dict[str, int] = {}
    for row in raw_rows:
        number = int(row["number"])
        for sha in [row.get("merge_commit_sha"), (row.get("head") or {}).get("sha")]:
            if sha:
                sha_to_number[sha.lower()] = number
        normalized_title = normalize_title(row.get("title") or "")
        if normalized_title:
            title_to_number.setdefault(normalized_title, number)

    reverted_by: DefaultDict[int, List[int]] = defaultdict(list)
    followup_fix_by: DefaultDict[int, List[int]] = defaultdict(list)
    followup_fix_strict_by: DefaultDict[int, List[int]] = defaultdict(list)
    for row in raw_rows:
        number = int(row["number"])
        if not is_revert_pr(row):
            continue
        for target in extract_revert_targets(row, rows_by_number, sha_to_number, title_to_number):
            if target != number and target in rows_by_number:
                reverted_by[target].append(number)

    for row in raw_rows:
        number = int(row["number"])
        if not is_followup_fix_pr(row):
            continue
        for target in extract_referenced_pr_numbers(row, rows_by_number):
            target_row = rows_by_number[target]
            if target != number and is_later_pr(row, target_row):
                followup_fix_by[target].append(number)
                if is_strict_followup_fix(row, target_row):
                    followup_fix_strict_by[target].append(number)

    outcomes: Dict[int, Dict[str, Any]] = {}
    for row in raw_rows:
        number = int(row["number"])
        is_merged = bool(row.get("merged_at"))
        is_revert = is_revert_pr(row)
        target_prs = sorted(set(reverted_by.get(number, [])))
        followup_prs = sorted(set(followup_fix_by.get(number, [])))
        strict_followup_prs = sorted(set(followup_fix_strict_by.get(number, [])))
        git_commits = sorted(
            git_reverts_by_pr.get(number, []) if git_reverts_by_pr else [],
            key=lambda item: (item.get("committed_at") or "", item.get("sha") or ""),
        )
        outcomes[number] = {
            "is_merged": is_merged,
            "is_revert_pr": is_revert,
            "reverted_by_prs": target_prs,
            "git_reverted_by_commits": git_commits,
            "followup_fix_by_prs": followup_prs,
            "followup_fix_strict_by_prs": strict_followup_prs,
            "has_revert_outcome": bool(target_prs or git_commits),
            "strong_outcome": bool(target_prs or git_commits),
            "medium_outcome": bool(target_prs or git_commits or followup_prs),
            "medium_outcome_strict": bool(target_prs or git_commits or strict_followup_prs),
        }
    return outcomes


def summarize_files(files: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    paths = [file_info.get("filename") for file_info in files if file_info.get("filename")]
    changes_by_file = [int(file_info.get("changes") or 0) for file_info in files]
    extensions = sorted({extension(path) for path in paths if extension(path)})
    languages = sorted({LANGUAGE_BY_EXTENSION[ext] for ext in extensions if ext in LANGUAGE_BY_EXTENSION})
    directories = sorted({parent_dir(path) for path in paths})
    top_dirs = sorted({top_level_dir(path) for path in paths if top_level_dir(path)})

    counts = Counter(classify_path(path) for path in paths)
    sensitive_counts = Counter(area for path in paths for area in classify_sensitive_areas(path))
    status_counts = Counter((file_info.get("status") or "").lower() for file_info in files)
    code_files = counts["code"]
    test_files = counts["test"]
    docs_files = counts["docs"]
    generated_files = counts["generated"]
    lockfile_files = counts["lockfile"]
    migration_files = counts["migration"]
    ci_deploy_files = counts["ci_deploy"]
    config_files = counts["config"]
    auth_permission_files = counts["auth_permission"]
    public_api_files = counts["public_api"]

    file_count = len(paths)
    new_file_count = status_counts["added"]
    non_docs_generated = file_count - docs_files - generated_files
    non_test_generated_docs = file_count - test_files - docs_files - generated_files
    changed_lines = sum(changes_by_file)
    added_lines = sum(int(file_info.get("additions") or 0) for file_info in files)
    deleted_lines = sum(int(file_info.get("deletions") or 0) for file_info in files)
    sensitive_file_count = sum(1 for path in paths if classify_sensitive_areas(path))

    return {
        "file_count": file_count,
        "changed_lines": changed_lines,
        "added_lines": added_lines,
        "deleted_lines": deleted_lines,
        "deleted_line_ratio": round(deleted_lines / changed_lines, 4) if changed_lines else 0.0,
        "directory_count": len(directories),
        "top_level_directory_count": len(top_dirs),
        "extension_count": len(extensions),
        "language_count": len(languages),
        "extensions": extensions,
        "languages": languages,
        "top_level_dirs": top_dirs,
        "entropy_of_change": round(entropy(changes_by_file), 4),
        "new_file_count": new_file_count,
        "removed_file_count": status_counts["removed"],
        "renamed_file_count": status_counts["renamed"],
        "modified_file_count": status_counts["modified"],
        "new_file_ratio": round(new_file_count / file_count, 4) if file_count else 0.0,
        "only_new_files": bool(file_count and new_file_count == file_count),
        "code_file_count": code_files,
        "test_file_count": test_files,
        "docs_file_count": docs_files,
        "generated_file_count": generated_files,
        "lockfile_count": lockfile_files,
        "migration_file_count": migration_files,
        "ci_deploy_file_count": ci_deploy_files,
        "config_file_count": config_files,
        "auth_permission_file_count": auth_permission_files,
        "public_api_file_count": public_api_files,
        "sensitive_file_count": sensitive_file_count,
        "sensitive_area_count": len(sensitive_counts),
        "db_or_storage_changed": bool(sensitive_counts["db_storage"]),
        "ingest_or_pipeline_changed": bool(sensitive_counts["ingest_pipeline"]),
        "billing_or_quota_changed": bool(sensitive_counts["billing_quota"]),
        "security_or_privacy_changed": bool(sensitive_counts["security_privacy"]),
        "ownership_or_org_changed": bool(sensitive_counts["ownership_org"]),
        "sensitive_area_changed": bool(sensitive_counts),
        "docs_only": bool(file_count and non_docs_generated <= 0),
        "generated_only": bool(file_count and generated_files == file_count),
        "tests_only": bool(file_count and non_test_generated_docs <= 0 and test_files > 0),
        "tests_changed": bool(test_files),
        "code_changed_without_test_signal": bool(code_files and not test_files),
        "lockfile_changed": bool(lockfile_files),
        "migration_changed": bool(migration_files),
        "ci_or_deploy_changed": bool(ci_deploy_files),
        "config_or_env_changed": bool(config_files),
        "auth_or_permission_changed": bool(auth_permission_files),
        "public_api_changed": bool(public_api_files),
    }


def summarize_relative_churn(
    files: Sequence[Dict[str, Any]],
    file_estimated_sloc: Dict[str, int],
) -> Dict[str, Any]:
    ratios: List[float] = []
    known_base_sloc = 0
    known_base_churn = 0
    known_file_count = 0
    new_file_count = 0

    for file_info in files:
        path = file_info.get("filename")
        if not path:
            continue
        previous_path = file_info.get("previous_filename")
        status = (file_info.get("status") or "").lower()
        changes = int(file_info.get("changes") or 0)
        if not changes:
            changes = int(file_info.get("additions") or 0) + int(file_info.get("deletions") or 0)
        base_sloc = file_estimated_sloc.get(path, 0)
        if not base_sloc and previous_path:
            base_sloc = file_estimated_sloc.get(previous_path, 0)
        if status == "added" and base_sloc <= 0:
            new_file_count += 1
            ratios.append(1.0 if changes else 0.0)
            continue
        if base_sloc > 0:
            ratio = changes / base_sloc
            ratios.append(max(ratio, 0.0))
            known_base_sloc += base_sloc
            known_base_churn += changes
            known_file_count += 1
        else:
            ratios.append(0.0)

    return {
        "max_file_churn_ratio": round(max(ratios or [0.0]), 4),
        "avg_file_churn_ratio": round(sum(ratios) / len(ratios), 4) if ratios else 0.0,
        "sum_churn_over_base_sloc": round(known_base_churn / known_base_sloc, 4)
        if known_base_sloc
        else 0.0,
        "known_prior_file_size_count": known_file_count,
        "new_file_relative_churn_count": new_file_count,
        "large_relative_churn": bool(ratios and max(ratios) >= 0.5),
    }


def summarize_patch_signals(files: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    patch_available_count = 0
    comment_only_file_count = 0
    whitespace_only_file_count = 0
    touches_error_handling = False
    touches_async_or_concurrency = False
    touches_serialization = False
    touches_data_deletion = False
    changed_patch_line_count = 0

    for file_info in files:
        patch = file_info.get("patch") or ""
        if not patch:
            continue
        patch_available_count += 1
        changed_lines = patch_changed_lines(patch)
        changed_patch_line_count += len(changed_lines)
        normalized_lines = [line.strip() for line in changed_lines]
        non_empty_lines = [line for line in normalized_lines if line]
        if changed_lines and not non_empty_lines:
            whitespace_only_file_count += 1
        if non_empty_lines and all(is_comment_like_line(line) for line in non_empty_lines):
            comment_only_file_count += 1
        changed_text = "\n".join(changed_lines)
        touches_error_handling = touches_error_handling or bool(ERROR_HANDLING_RE.search(changed_text))
        touches_async_or_concurrency = touches_async_or_concurrency or bool(
            ASYNC_CONCURRENCY_RE.search(changed_text)
        )
        touches_serialization = touches_serialization or bool(SERIALIZATION_RE.search(changed_text))
        touches_data_deletion = touches_data_deletion or bool(DATA_DELETION_RE.search(changed_text))

    return {
        "patch_available_count": patch_available_count,
        "changed_patch_line_count": changed_patch_line_count,
        "comment_only_file_count": comment_only_file_count,
        "whitespace_only_file_count": whitespace_only_file_count,
        "comment_only": bool(patch_available_count and comment_only_file_count == patch_available_count),
        "whitespace_only": bool(patch_available_count and whitespace_only_file_count == patch_available_count),
        "touches_error_handling": touches_error_handling,
        "touches_async_or_concurrency": touches_async_or_concurrency,
        "touches_serialization": touches_serialization,
        "touches_data_deletion": touches_data_deletion,
    }


def summarize_reviews(reviews: Sequence[Dict[str, Any]]) -> Dict[str, int]:
    states = Counter((review.get("state") or "").upper() for review in reviews)
    return {
        "approved": states["APPROVED"],
        "changes_requested": states["CHANGES_REQUESTED"],
        "commented": states["COMMENTED"],
        "dismissed": states["DISMISSED"],
        "requested_changes": states["CHANGES_REQUESTED"],
    }


def summarize_history(
    paths: Sequence[str],
    created: Optional[datetime],
    author: str,
    file_touch_counts: Dict[str, int],
    dir_touch_counts: Dict[str, int],
    top_dir_touch_counts: Dict[str, int],
    file_revert_counts: Dict[str, int],
    dir_revert_counts: Dict[str, int],
    file_bad_outcome_counts: Dict[str, int],
    dir_bad_outcome_counts: Dict[str, int],
    file_bad_outcome_times: Dict[str, List[datetime]],
    dir_bad_outcome_times: Dict[str, List[datetime]],
    file_authors: Dict[str, Set[str]],
    dir_authors: Dict[str, Set[str]],
    top_dir_authors: Dict[str, Set[str]],
    file_last_touched_at: Dict[str, datetime],
    file_touch_times: Dict[str, List[datetime]],
    dir_touch_times: Dict[str, List[datetime]],
    author_repo_touch_times: Dict[str, List[datetime]],
    author_file_touch_counts: Dict[Tuple[str, str], int],
    author_dir_touch_counts: Dict[Tuple[str, str], int],
    author_top_dir_touch_counts: Dict[Tuple[str, str], int],
    file_first_author: Dict[str, str],
) -> Dict[str, Any]:
    dirs = [parent_dir(path) for path in paths]
    unique_dirs = sorted(set(dirs))
    top_dirs = [top_level_dir(path) for path in paths if top_level_dir(path)]
    previous_file_authors = [len(file_authors[path]) for path in paths]
    previous_dir_authors = [len(dir_authors[path]) for path in dirs]
    prior_file_days = days_since_last_touch(paths, created, file_last_touched_at)
    author_recent_cutoff = created - RECENT_EXPERIENCE_WINDOW if created else None
    author_repo_times = author_repo_touch_times.get(author, [])
    author_recent_prs = (
        sum(1 for touched_at in author_repo_times if touched_at >= author_recent_cutoff)
        if author_recent_cutoff
        else 0
    )
    file_recent_counts = recent_touch_counts(paths, created, file_touch_times)
    dir_recent_counts = recent_touch_counts(dirs, created, dir_touch_times)
    file_bad_counts_90d = recent_touch_counts(
        paths,
        created,
        file_bad_outcome_times,
        window=BAD_OUTCOME_WINDOWS["90d"],
    )
    dir_bad_counts_90d = recent_touch_counts(
        dirs,
        created,
        dir_bad_outcome_times,
        window=BAD_OUTCOME_WINDOWS["90d"],
    )
    file_bad_counts_365d = recent_touch_counts(
        paths,
        created,
        file_bad_outcome_times,
        window=BAD_OUTCOME_WINDOWS["365d"],
    )
    dir_bad_counts_365d = recent_touch_counts(
        dirs,
        created,
        dir_bad_outcome_times,
        window=BAD_OUTCOME_WINDOWS["365d"],
    )
    author_created_file_count = sum(
        1 for path in paths if file_first_author.get(path) and file_first_author.get(path) == author
    )
    author_file_prior_values = [author_file_touch_counts[(author, path)] for path in paths]
    author_dir_prior_values = [author_dir_touch_counts[(author, path)] for path in dirs]
    author_touched_file_count = sum(1 for value in author_file_prior_values if value > 0)
    author_touched_dir_count = sum(
        1 for path in unique_dirs if author_dir_touch_counts[(author, path)] > 0
    )
    sum_file_prior_prs = sum(file_touch_counts[path] for path in paths)
    sum_dir_prior_prs = sum(dir_touch_counts[path] for path in dirs)
    author_sum_file_prior_prs = sum(author_file_prior_values)
    author_sum_dir_prior_prs = sum(author_dir_prior_values)
    return {
        "max_file_prior_prs": max([file_touch_counts[path] for path in paths] or [0]),
        "sum_file_prior_prs": sum_file_prior_prs,
        "max_dir_prior_prs": max([dir_touch_counts[path] for path in dirs] or [0]),
        "sum_dir_prior_prs": sum_dir_prior_prs,
        "max_top_level_dir_prior_prs": max([top_dir_touch_counts[path] for path in top_dirs] or [0]),
        "sum_top_level_dir_prior_prs": sum(top_dir_touch_counts[path] for path in top_dirs),
        "max_file_prior_reverts": max([file_revert_counts[path] for path in paths] or [0]),
        "sum_file_prior_reverts": sum(file_revert_counts[path] for path in paths),
        "max_dir_prior_reverts": max([dir_revert_counts[path] for path in dirs] or [0]),
        "sum_dir_prior_reverts": sum(dir_revert_counts[path] for path in dirs),
        "max_file_prior_bad_outcomes": max([file_bad_outcome_counts[path] for path in paths] or [0]),
        "sum_file_prior_bad_outcomes": sum(file_bad_outcome_counts[path] for path in paths),
        "max_dir_prior_bad_outcomes": max([dir_bad_outcome_counts[path] for path in dirs] or [0]),
        "sum_dir_prior_bad_outcomes": sum(dir_bad_outcome_counts[path] for path in dirs),
        "max_file_prior_bad_outcomes_90d": max(file_bad_counts_90d or [0]),
        "sum_file_prior_bad_outcomes_90d": sum(file_bad_counts_90d),
        "max_dir_prior_bad_outcomes_90d": max(dir_bad_counts_90d or [0]),
        "sum_dir_prior_bad_outcomes_90d": sum(dir_bad_counts_90d),
        "max_file_prior_bad_outcomes_365d": max(file_bad_counts_365d or [0]),
        "sum_file_prior_bad_outcomes_365d": sum(file_bad_counts_365d),
        "max_dir_prior_bad_outcomes_365d": max(dir_bad_counts_365d or [0]),
        "sum_dir_prior_bad_outcomes_365d": sum(dir_bad_counts_365d),
        "max_file_prior_authors": max(previous_file_authors or [0]),
        "sum_file_prior_authors": sum(previous_file_authors),
        "max_dir_prior_authors": max(previous_dir_authors or [0]),
        "sum_dir_prior_authors": sum(previous_dir_authors),
        "max_top_level_dir_prior_authors": max([len(top_dir_authors[path]) for path in top_dirs] or [0]),
        "sum_top_level_dir_prior_authors": sum(len(top_dir_authors[path]) for path in top_dirs),
        "min_file_days_since_last_change": min(prior_file_days or [0]),
        "avg_file_days_since_last_change": round(sum(prior_file_days) / len(prior_file_days), 4)
        if prior_file_days
        else 0.0,
        "max_file_days_since_last_change": max(prior_file_days or [0]),
        "max_file_prior_prs_90d": max(file_recent_counts or [0]),
        "sum_file_prior_prs_90d": sum(file_recent_counts),
        "max_dir_prior_prs_90d": max(dir_recent_counts or [0]),
        "sum_dir_prior_prs_90d": sum(dir_recent_counts),
        "author_repo_prior_prs": len(author_repo_times),
        "author_repo_recent_prs_90d": author_recent_prs,
        "author_max_file_prior_prs": max([author_file_touch_counts[(author, path)] for path in paths] or [0]),
        "author_sum_file_prior_prs": author_sum_file_prior_prs,
        "author_max_dir_prior_prs": max([author_dir_touch_counts[(author, path)] for path in dirs] or [0]),
        "author_sum_dir_prior_prs": author_sum_dir_prior_prs,
        "author_max_top_level_dir_prior_prs": max(
            [author_top_dir_touch_counts[(author, path)] for path in top_dirs] or [0]
        ),
        "author_sum_top_level_dir_prior_prs": sum(
            author_top_dir_touch_counts[(author, path)] for path in top_dirs
        ),
        "author_touched_file_count": author_touched_file_count,
        "author_touched_file_ratio": round(author_touched_file_count / len(paths), 4) if paths else 0.0,
        "author_touched_dir_count": author_touched_dir_count,
        "author_touched_dir_ratio": round(author_touched_dir_count / len(unique_dirs), 4)
        if unique_dirs
        else 0.0,
        "author_file_experience_share": round(author_sum_file_prior_prs / sum_file_prior_prs, 4)
        if sum_file_prior_prs
        else 0.0,
        "author_dir_experience_share": round(author_sum_dir_prior_prs / sum_dir_prior_prs, 4)
        if sum_dir_prior_prs
        else 0.0,
        "author_created_file_count": author_created_file_count,
        "author_created_file_ratio": round(author_created_file_count / len(paths), 4) if paths else 0.0,
    }


def summarize_text(row: Dict[str, Any]) -> Dict[str, Any]:
    title = (row.get("title") or "").lower()
    body = (row.get("body") or "").lower()
    text = f"{title}\n{body}"
    return {
        "title_fix_like": bool(FOLLOWUP_FIX_RE.search(title)),
        "title_revert_like": title.strip().startswith("revert"),
        "title_refactor_like": bool(re.search(r"\b(refactor|cleanup|clean up|rename|move)\b", title)),
        "body_has_test_plan": bool(re.search(r"\b(test plan|tests?|verified|validation)\b", body)),
        "body_says_no_tests": bool(re.search(r"\b(no tests?|not tested|without tests?)\b", body)),
        "hotfix_like_text": is_hotfix_like(row),
        "references_other_pr": bool(ISSUE_REF_RE.search(text)),
    }


def patch_changed_lines(patch: str) -> List[str]:
    lines: List[str] = []
    for line in patch.splitlines():
        if not line:
            continue
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line[0] not in {"+", "-"}:
            continue
        lines.append(line[1:])
    return lines


def is_comment_like_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    comment_prefixes = ("#", "//", "/*", "*", "*/", "<!--", "-->", "--")
    if stripped.startswith(comment_prefixes):
        return True
    if stripped.startswith(('"""', "'''")) or stripped.endswith(('"""', "'''")):
        return True
    return False


def classify_path(path: str) -> str:
    normalized = path.lower()
    name = PurePosixPath(normalized).name
    parts = set(PurePosixPath(normalized).parts)
    ext = extension(normalized)

    if name in LOCKFILES:
        return "lockfile"
    if "migrations" in parts or "migration" in parts or "alembic" in parts:
        return "migration"
    if normalized.startswith(".github/workflows/") or ".circleci" in parts or ".buildkite" in parts:
        return "ci_deploy"
    if "docs" in parts or ext in DOC_EXTENSIONS or name in {"readme", "changelog", "license"}:
        return "docs"
    if "generated" in parts or "vendor" in parts or normalized.endswith(".generated.ts"):
        return "generated"
    if is_test_path(normalized):
        return "test"
    if any(token in normalized for token in ["auth", "permission", "rbac", "oauth", "token", "session"]):
        return "auth_permission"
    if any(token in normalized for token in ["openapi", "graphql", "schema", "proto"]):
        return "public_api"
    if ext in CONFIG_EXTENSIONS or "config" in parts or name.startswith(".env"):
        return "config"
    if ext in CODE_EXTENSIONS:
        return "code"
    return "other"


def classify_sensitive_areas(path: str) -> Set[str]:
    normalized = path.lower()
    parts = set(PurePosixPath(normalized).parts)
    areas: Set[str] = set()
    if any(token in normalized for token in ["auth", "permission", "rbac", "oauth", "token", "session"]):
        areas.add("security_privacy")
    if any(token in normalized for token in ["privacy", "security", "sso", "saml", "twofactor", "2fa"]):
        areas.add("security_privacy")
    if any(token in normalized for token in ["billing", "subscription", "payment", "invoice", "quota"]):
        areas.add("billing_quota")
    if any(token in normalized for token in ["rate_limit", "ratelimit", "usage", "plan"]):
        areas.add("billing_quota")
    if any(token in normalized for token in ["ingest", "relay", "snuba", "kafka", "consumer", "pipeline"]):
        areas.add("ingest_pipeline")
    if any(token in normalized for token in ["database", "postgres", "redis", "storage", "search", "index"]):
        areas.add("db_storage")
    if "migrations" in parts or "migration" in parts or "alembic" in parts:
        areas.add("db_storage")
    if any(token in normalized for token in ["organization", "member", "team", "project", "owner"]):
        areas.add("ownership_org")
    return areas


def classify_source_type(row: Dict[str, Any]) -> str:
    author = row.get("author") or {}
    login = (author.get("login") or "").lower()
    user_type = (author.get("type") or "").lower()
    text = f"{row.get('title') or ''}\n{row.get('body') or ''}\n{(row.get('head') or {}).get('ref') or ''}".lower()

    if "dependabot" in login or "renovate" in login:
        return "dependency_bot"
    if user_type == "bot" or login.endswith("[bot]"):
        return "bot"
    if any(token in text for token in ["codemod", "mechanical change", "bulk update"]):
        return "codemod"
    if any(token in text for token in ["ai-generated", "generated by copilot", "generated by ai"]):
        return "ai_generated"
    return "human"


def is_revert_pr(row: Dict[str, Any]) -> bool:
    title = (row.get("title") or "").strip().lower()
    body = (row.get("body") or "").lower()
    labels = " ".join((label.get("name") or "") for label in row.get("labels", [])).lower()
    return title.startswith("revert") or "this reverts commit" in body or "revert" in labels


def is_hotfix_like(row: Dict[str, Any]) -> bool:
    text = " ".join(
        [
            row.get("title") or "",
            row.get("body") or "",
            " ".join((label.get("name") or "") for label in row.get("labels", [])),
        ]
    ).lower()
    return any(token in text for token in ["hotfix", "regression", "rollback", "roll back", "fix forward"])


def is_followup_fix_pr(row: Dict[str, Any]) -> bool:
    if not row.get("merged_at"):
        return False
    text = " ".join(
        [
            row.get("title") or "",
            row.get("body") or "",
            " ".join((label.get("name") or "") for label in row.get("labels", [])),
        ]
    )
    return bool(FOLLOWUP_FIX_RE.search(text))


def extract_revert_targets(
    row: Dict[str, Any],
    rows_by_number: Dict[int, Dict[str, Any]],
    sha_to_number: Dict[str, int],
    title_to_number: Dict[str, int],
) -> Set[int]:
    targets: Set[int] = set()
    text = f"{row.get('title') or ''}\n{row.get('body') or ''}"
    for match in REVERT_SHA_RE.finditer(text):
        sha = match.group(1).lower()
        if sha in sha_to_number:
            targets.add(sha_to_number[sha])
    targets.update(extract_referenced_pr_numbers(row, rows_by_number))
    for quoted in QUOTED_TEXT_RE.findall(text):
        normalized = normalize_title(quoted)
        if normalized in title_to_number:
            targets.add(title_to_number[normalized])
    return targets


def extract_referenced_pr_numbers(
    row: Dict[str, Any], rows_by_number: Dict[int, Dict[str, Any]]
) -> Set[int]:
    text = f"{row.get('title') or ''}\n{row.get('body') or ''}"
    targets: Set[int] = set()
    for match in ISSUE_REF_RE.finditer(text):
        number = int(match.group(1))
        if number in rows_by_number:
            targets.add(number)
    return targets


def is_later_pr(candidate: Dict[str, Any], target: Dict[str, Any]) -> bool:
    candidate_created = parse_github_time(candidate.get("created_at"))
    target_created = parse_github_time(target.get("created_at"))
    if not candidate_created or not target_created:
        return False
    return candidate_created > target_created


def is_strict_followup_fix(candidate: Dict[str, Any], target: Dict[str, Any]) -> bool:
    candidate_created = parse_github_time(candidate.get("created_at"))
    target_created = parse_github_time(target.get("created_at"))
    if not candidate_created or not target_created:
        return False
    if candidate_created - target_created > FOLLOWUP_FIX_STRICT_WINDOW:
        return False
    candidate_paths = {
        file_info.get("filename")
        for file_info in candidate.get("files", [])
        if file_info.get("filename")
    }
    target_paths = {
        file_info.get("filename")
        for file_info in target.get("files", [])
        if file_info.get("filename")
    }
    if candidate_paths & target_paths:
        return True
    candidate_dirs = {parent_dir(path) for path in candidate_paths if parent_dir(path)}
    target_dirs = {parent_dir(path) for path in target_paths if parent_dir(path)}
    return bool(candidate_dirs & target_dirs)


def normalize_title(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def entropy(values: Sequence[int]) -> float:
    total = sum(value for value in values if value > 0)
    if total <= 0:
        return 0.0
    result = 0.0
    for value in values:
        if value <= 0:
            continue
        probability = value / total
        result -= probability * math.log2(probability)
    return result


def extension(path: str) -> str:
    return PurePosixPath(path).suffix.lower()


def parent_dir(path: str) -> str:
    parent = str(PurePosixPath(path).parent)
    return "" if parent == "." else parent


def top_level_dir(path: str) -> str:
    parts = PurePosixPath(path).parts
    return parts[0] if len(parts) > 1 else ""


def is_test_path(path: str) -> bool:
    parts = set(PurePosixPath(path).parts)
    name = PurePosixPath(path).name
    return (
        "test" in parts
        or "tests" in parts
        or "__tests__" in parts
        or name.startswith("test_")
        or name.endswith("_test.go")
        or name.endswith("_test.py")
        or name.endswith(".test.ts")
        or name.endswith(".test.tsx")
        or name.endswith(".spec.ts")
        or name.endswith(".spec.tsx")
    )


def days_since_last_touch(
    paths: Sequence[str],
    created: Optional[datetime],
    file_last_touched_at: Dict[str, datetime],
) -> List[float]:
    if not created:
        return []
    result: List[float] = []
    for path in paths:
        touched_at = file_last_touched_at.get(path)
        if not touched_at:
            continue
        result.append(max((created - touched_at).total_seconds() / 86400.0, 0.0))
    return result


def recent_touch_counts(
    paths: Sequence[str],
    created: Optional[datetime],
    touch_times_by_path: Dict[str, List[datetime]],
    window: timedelta = RECENT_EXPERIENCE_WINDOW,
) -> List[int]:
    if not created:
        return [0 for _ in paths]
    cutoff = created - window
    return [
        sum(1 for touched_at in touch_times_by_path.get(path, []) if touched_at >= cutoff)
        for path in paths
    ]


def _build_touch_events(raw_rows: Sequence[Dict[str, Any]]) -> List[Tuple[datetime, str, List[Dict[str, Any]]]]:
    events: List[Tuple[datetime, str, List[Dict[str, Any]]]] = []
    for row in raw_rows:
        merged_at = parse_github_time(row.get("merged_at"))
        if not merged_at:
            continue
        files = [file_info for file_info in row.get("files", []) if file_info.get("filename")]
        if not files:
            continue
        author = (row.get("author") or {}).get("login") or ""
        events.append((merged_at, author, files))
    return events


def _apply_touch_event(
    event_time: datetime,
    author: str,
    files: Sequence[Dict[str, Any]],
    file_touch_counts: DefaultDict[str, int],
    dir_touch_counts: DefaultDict[str, int],
    top_dir_touch_counts: DefaultDict[str, int],
    file_authors: DefaultDict[str, Set[str]],
    dir_authors: DefaultDict[str, Set[str]],
    top_dir_authors: DefaultDict[str, Set[str]],
    file_last_touched_at: Dict[str, datetime],
    file_touch_times: DefaultDict[str, List[datetime]],
    dir_touch_times: DefaultDict[str, List[datetime]],
    author_repo_touch_times: DefaultDict[str, List[datetime]],
    author_file_touch_counts: DefaultDict[Tuple[str, str], int],
    author_dir_touch_counts: DefaultDict[Tuple[str, str], int],
    author_top_dir_touch_counts: DefaultDict[Tuple[str, str], int],
    file_first_author: Dict[str, str],
    file_estimated_sloc: DefaultDict[str, int],
) -> None:
    author_repo_touch_times[author].append(event_time)
    touched_files: Set[str] = set()
    touched_dirs: Set[str] = set()
    touched_top_dirs: Set[str] = set()
    for file_info in files:
        path = file_info.get("filename")
        if not path:
            continue
        touched_files.add(path)
        touched_dirs.add(parent_dir(path))
        top_dir = top_level_dir(path)
        if top_dir:
            touched_top_dirs.add(top_dir)
        if (file_info.get("status") or "").lower() == "added":
            file_first_author.setdefault(path, author)

    for path in touched_files:
        file_touch_counts[path] += 1
        file_authors[path].add(author)
        file_last_touched_at[path] = event_time
        file_touch_times[path].append(event_time)
        author_file_touch_counts[(author, path)] += 1
    for path in touched_dirs:
        dir_touch_counts[path] += 1
        dir_authors[path].add(author)
        dir_touch_times[path].append(event_time)
        author_dir_touch_counts[(author, path)] += 1
    for path in touched_top_dirs:
        top_dir_touch_counts[path] += 1
        top_dir_authors[path].add(author)
        author_top_dir_touch_counts[(author, path)] += 1
    update_estimated_file_sizes(files, file_estimated_sloc)


def update_estimated_file_sizes(
    files: Sequence[Dict[str, Any]],
    file_estimated_sloc: DefaultDict[str, int],
) -> None:
    for file_info in files:
        path = file_info.get("filename")
        if not path:
            continue
        status = (file_info.get("status") or "").lower()
        previous_path = file_info.get("previous_filename")
        if previous_path and previous_path in file_estimated_sloc and path not in file_estimated_sloc:
            file_estimated_sloc[path] = file_estimated_sloc[previous_path]
        base_sloc = file_estimated_sloc.get(path, 0)
        additions = int(file_info.get("additions") or 0)
        deletions = int(file_info.get("deletions") or 0)
        if status == "removed":
            file_estimated_sloc[path] = 0
        elif status == "added" and base_sloc <= 0:
            file_estimated_sloc[path] = max(additions - deletions, 0)
        else:
            file_estimated_sloc[path] = max(base_sloc + additions - deletions, 0)


def _build_revert_events(
    raw_rows: Sequence[Dict[str, Any]], outcomes: Dict[int, Dict[str, Any]]
) -> List[Tuple[datetime, List[str]]]:
    rows_by_number = {int(row["number"]): row for row in raw_rows}
    events: List[Tuple[datetime, List[str]]] = []
    for number, outcome in outcomes.items():
        reverter_numbers = outcome.get("reverted_by_prs") or []
        git_revert_commits = outcome.get("git_reverted_by_commits") or []
        if not reverter_numbers and not git_revert_commits:
            continue
        event_times = [
            parse_github_time(rows_by_number[reverter].get("created_at"))
            for reverter in reverter_numbers
            if reverter in rows_by_number
        ]
        event_times.extend(
            parse_github_time(commit.get("committed_at"))
            for commit in git_revert_commits
            if commit.get("committed_at")
        )
        event_times = [value for value in event_times if value]
        if not event_times:
            continue
        files = [
            file_info.get("filename")
            for file_info in rows_by_number[number].get("files", [])
            if file_info.get("filename")
        ]
        events.append((min(event_times), files))
    return events


def _build_bad_outcome_events(
    raw_rows: Sequence[Dict[str, Any]], outcomes: Dict[int, Dict[str, Any]]
) -> List[Tuple[datetime, List[str]]]:
    rows_by_number = {int(row["number"]): row for row in raw_rows}
    events: List[Tuple[datetime, List[str]]] = []
    for number, outcome in outcomes.items():
        if not outcome.get("medium_outcome_strict"):
            continue
        event_times: List[datetime] = []
        for source_field in ["reverted_by_prs", "followup_fix_strict_by_prs"]:
            for source_number in outcome.get(source_field) or []:
                source_row = rows_by_number.get(source_number)
                if not source_row:
                    continue
                event_time = parse_github_time(source_row.get("created_at"))
                if event_time:
                    event_times.append(event_time)
        for commit in outcome.get("git_reverted_by_commits") or []:
            event_time = parse_github_time(commit.get("committed_at"))
            if event_time:
                event_times.append(event_time)
        if not event_times:
            continue
        target_row = rows_by_number.get(number)
        if not target_row:
            continue
        files = [
            file_info.get("filename")
            for file_info in target_row.get("files", [])
            if file_info.get("filename")
        ]
        if files:
            events.append((min(event_times), files))
    return events


def flatten_feature_row(row: Dict[str, Any]) -> Dict[str, Any]:
    flattened: Dict[str, Any] = {
        "repo": row.get("repo"),
        "number": row.get("number"),
        "html_url": row.get("html_url"),
        "title": row.get("title"),
        "author": row.get("author"),
        "created_at": row.get("created_at"),
        "merged_at": row.get("merged_at"),
        "closed_at": row.get("closed_at"),
    }
    for prefix in ["prediction_features", "outcomes"]:
        for key, value in (row.get(prefix) or {}).items():
            if isinstance(value, (list, dict)):
                flattened[key] = json.dumps(value, sort_keys=True)
            else:
                flattened[key] = value
    return flattened


def write_feature_csv(path: str, rows: Sequence[Dict[str, Any]]) -> None:
    flattened_rows = [flatten_feature_row(row) for row in rows]
    fieldnames: List[str] = []
    seen: Set[str] = set()
    for row in flattened_rows:
        for key in row:
            if key not in seen:
                seen.add(key)
                fieldnames.append(key)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(flattened_rows)


def load_raw_dataset(path: str) -> List[Dict[str, Any]]:
    return list(read_jsonl(path))
