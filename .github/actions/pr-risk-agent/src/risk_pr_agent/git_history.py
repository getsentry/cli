"""Local git history helpers for outcome enrichment."""

from __future__ import annotations

import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, DefaultDict, Dict, Iterable, Iterator, List, Optional, Set
from collections import defaultdict


PR_REF_RE = re.compile(r"(?<![\w-])#(\d+)\b")
STRICT_REVERT_SUBJECT_RE = re.compile(r'^Revert\s+"(?P<quoted>.+)"(?:\s+\(#(?P<reverter_pr>\d+)\))?\s*$')
TRAILING_PR_REF_RE = re.compile(r"\s+\(#\d+\)\s*$")


def collect_git_reverts_by_pr(
    repo_path: str,
    ref: str = "origin/master",
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> Dict[int, List[Dict[str, Any]]]:
    reverts_by_pr: DefaultDict[int, List[Dict[str, Any]]] = defaultdict(list)
    for commit in iter_first_parent_commits(repo_path, ref, since=since, until=until):
        parsed = parse_strict_revert_commit(commit)
        if not parsed:
            continue
        target_pr = int(parsed.pop("target_pr"))
        reverts_by_pr[target_pr].append(parsed)
    return {number: commits for number, commits in reverts_by_pr.items()}


def survey_git_history(
    repo_path: str,
    ref: str = "origin/master",
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> Dict[str, Any]:
    pr_refs = set()
    revert_targets = set()
    commit_count = 0
    strict_revert_count = 0
    for commit in iter_first_parent_commits(repo_path, ref, since=since, until=until):
        commit_count += 1
        subject = commit["subject"]
        refs = {int(value) for value in PR_REF_RE.findall(subject)}
        pr_refs.update(refs)
        parsed = parse_strict_revert_commit(commit)
        if parsed:
            strict_revert_count += 1
            revert_targets.add(int(parsed["target_pr"]))
    return {
        "git_repo": str(Path(repo_path)),
        "git_ref": ref,
        "first_parent_commits": commit_count,
        "unique_pr_refs": len(pr_refs),
        "strict_revert_commits": strict_revert_count,
        "strict_revert_target_prs": len(revert_targets),
    }


def build_git_pr_rows(
    repo_slug: str,
    repo_path: str,
    ref: str = "origin/master",
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    max_prs: Optional[int] = None,
    fetched_at: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Build normalized raw PR-like rows from local first-parent git commits."""

    rows: List[Dict[str, Any]] = []
    seen_numbers: Set[int] = set()
    fetched_at = fetched_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    for commit in iter_first_parent_commit_stats(repo_path, ref, since=since, until=until):
        number = pr_number_from_subject(commit["subject"])
        if number is None or number in seen_numbers:
            continue
        seen_numbers.add(number)
        rows.append(git_commit_to_raw_pr_row(repo_slug, commit, number, fetched_at))
        if max_prs and len(rows) >= max_prs:
            break
    return rows


def git_commit_to_raw_pr_row(
    repo_slug: str, commit: Dict[str, Any], number: int, fetched_at: str
) -> Dict[str, Any]:
    committed_at = utc_iso(commit["committed_at"])
    files = [git_numstat_to_file(item) for item in commit.get("numstat", [])]
    additions = sum(item["additions"] for item in files)
    deletions = sum(item["deletions"] for item in files)
    author_name = commit.get("author_name") or ""
    author_email = commit.get("author_email") or ""
    return {
        "schema_version": 1,
        "repo": repo_slug,
        "data_source": "local_git",
        "fetched_at": fetched_at,
        "number": number,
        "id": None,
        "node_id": None,
        "html_url": f"https://github.com/{repo_slug}/pull/{number}",
        "state": "closed",
        "locked": False,
        "draft": False,
        "title": title_from_subject(commit["subject"]),
        "body": "",
        "created_at": committed_at,
        "updated_at": committed_at,
        "closed_at": committed_at,
        "merged_at": committed_at,
        "merge_commit_sha": commit["sha"],
        "author": {"login": author_login(author_name, author_email), "type": "User", "site_admin": False},
        "labels": [],
        "assignees": [],
        "requested_reviewers": [],
        "base": {"ref": None, "sha": None},
        "head": {"ref": None, "sha": commit["sha"], "repo": repo_slug},
        "metrics": {
            "commits": 1,
            "additions": additions,
            "deletions": deletions,
            "changed_files": len(files),
            "comments": 0,
            "review_comments": 0,
        },
        "files": files,
        "reviews": [],
    }


def iter_first_parent_commit_stats(
    repo_path: str,
    ref: str,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> Iterator[Dict[str, Any]]:
    args = [
        "git",
        "-C",
        repo_path,
        "log",
        ref,
        "--first-parent",
        "--numstat",
        "--format=%x1e%H%x00%cI%x00%aN%x00%aE%x00%s",
    ]
    if since:
        args.append(f"--since={since.isoformat()}")
    if until:
        args.append(f"--until={until.isoformat()}")
    completed = subprocess.run(args, check=True, capture_output=True, text=True)
    for record in completed.stdout.split("\x1e"):
        record = record.strip("\n")
        if not record:
            continue
        lines = record.splitlines()
        if not lines:
            continue
        fields = lines[0].split("\x00")
        if len(fields) != 5:
            continue
        sha, committed_at, author_name, author_email, subject = fields
        yield {
            "sha": sha,
            "committed_at": committed_at,
            "author_name": author_name,
            "author_email": author_email,
            "subject": subject,
            "numstat": parse_numstat_lines(lines[1:]),
        }


def parse_numstat_lines(lines: Iterable[str]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for line in lines:
        if not line.strip():
            continue
        fields = line.split("\t")
        if len(fields) < 3:
            continue
        additions, deletions, path = fields[0], fields[1], fields[-1]
        result.append(
            {
                "filename": normalize_numstat_path(path),
                "additions": parse_numstat_count(additions),
                "deletions": parse_numstat_count(deletions),
            }
        )
    return result


def git_numstat_to_file(item: Dict[str, Any]) -> Dict[str, Any]:
    additions = int(item.get("additions") or 0)
    deletions = int(item.get("deletions") or 0)
    return {
        "filename": item.get("filename"),
        "status": "modified",
        "additions": additions,
        "deletions": deletions,
        "changes": additions + deletions,
        "previous_filename": None,
    }


def pr_number_from_subject(subject: str) -> Optional[int]:
    strict_revert = STRICT_REVERT_SUBJECT_RE.match((subject or "").strip())
    if strict_revert:
        if strict_revert.group("reverter_pr"):
            return int(strict_revert.group("reverter_pr"))
        return None
    refs = [int(value) for value in PR_REF_RE.findall(subject or "")]
    if not refs:
        return None
    return refs[-1]


def title_from_subject(subject: str) -> str:
    subject = (subject or "").strip()
    if subject.lower().startswith("merge pull request"):
        return subject
    return TRAILING_PR_REF_RE.sub("", subject).strip()


def parse_numstat_count(value: str) -> int:
    if value == "-":
        return 0
    return int(value or 0)


def normalize_numstat_path(path: str) -> str:
    return path.strip()


def utc_iso(value: str) -> str:
    return (
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        .astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def author_login(name: str, email: str) -> str:
    if email:
        return email.split("@", 1)[0]
    return re.sub(r"\s+", "-", name.strip().lower()) or "unknown"


def iter_first_parent_commits(
    repo_path: str,
    ref: str,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> Iterator[Dict[str, str]]:
    args = [
        "git",
        "-C",
        repo_path,
        "log",
        ref,
        "--first-parent",
        "--format=%H%x00%cI%x00%s%x00%b%x1e",
    ]
    if since:
        args.append(f"--since={since.isoformat()}")
    if until:
        args.append(f"--until={until.isoformat()}")
    completed = subprocess.run(args, check=True, capture_output=True, text=True)
    for record in completed.stdout.split("\x1e"):
        record = record.strip("\n")
        if not record:
            continue
        fields = record.split("\x00", 3)
        if len(fields) != 4:
            continue
        sha, committed_at, subject, body = fields
        yield {
            "sha": sha,
            "committed_at": committed_at,
            "subject": subject,
            "body": body,
        }


def parse_strict_revert_commit(commit: Dict[str, str]) -> Optional[Dict[str, Any]]:
    subject = (commit.get("subject") or "").strip()
    match = STRICT_REVERT_SUBJECT_RE.match(subject)
    if not match:
        return None
    refs = [int(value) for value in PR_REF_RE.findall(match.group("quoted"))]
    if not refs:
        return None
    return {
        "target_pr": refs[-1],
        "sha": commit.get("sha"),
        "committed_at": commit.get("committed_at"),
        "subject": subject,
    }
