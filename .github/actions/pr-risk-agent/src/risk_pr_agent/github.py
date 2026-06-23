"""Small GitHub REST client for PR backfills."""

from __future__ import annotations

import json
import os
import socket
import time
import gzip
import http.client
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Iterator, List, Optional


GITHUB_API = "https://api.github.com"


class GitHubError(RuntimeError):
    """Raised when the GitHub API returns an error."""


@dataclass(frozen=True)
class RepoRef:
    owner: str
    name: str

    @classmethod
    def parse(cls, value: str) -> "RepoRef":
        parts = value.strip().split("/")
        if len(parts) != 2 or not all(parts):
            raise ValueError(f"repo must look like owner/name, got {value!r}")
        return cls(parts[0], parts[1])

    @property
    def slug(self) -> str:
        return f"{self.owner}/{self.name}"

    @property
    def path_slug(self) -> str:
        return f"{self.owner}__{self.name}"


class GitHubClient:
    def __init__(
        self,
        token: Optional[str] = None,
        api_url: str = GITHUB_API,
        sleep_seconds: float = 0.0,
        max_retries: int = 3,
    ) -> None:
        self.token = token or os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        self.api_url = api_url.rstrip("/")
        self.sleep_seconds = sleep_seconds
        self.max_retries = max_retries

    def request_json(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        url = self._url(path, params)
        request = urllib.request.Request(url, headers=self._headers())
        waited_for_rate_limit = False
        for attempt in range(self.max_retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    raw = response.read()
                    if self.sleep_seconds:
                        time.sleep(self.sleep_seconds)
                    if not raw:
                        return None
                    return json.loads(raw.decode("utf-8"))
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                if (
                    self._is_rate_limited(exc, body)
                    and self.token
                    and not waited_for_rate_limit
                    and exc.headers.get("X-RateLimit-Reset", "").isdigit()
                ):
                    reset_at = int(exc.headers["X-RateLimit-Reset"])
                    sleep_seconds = max(reset_at - int(time.time()) + 5, 1)
                    print(
                        f"GitHub rate limit reached for {url}; sleeping {sleep_seconds}s",
                        flush=True,
                    )
                    time.sleep(sleep_seconds)
                    waited_for_rate_limit = True
                    continue
                if exc.code >= 500 and attempt < self.max_retries:
                    time.sleep(2**attempt)
                    continue
                reset = exc.headers.get("X-RateLimit-Reset")
                reset_text = ""
                if reset and reset.isdigit():
                    reset_at = datetime.fromtimestamp(int(reset), tz=timezone.utc).isoformat()
                    reset_text = f" Rate limit resets at {reset_at}."
                raise GitHubError(f"GitHub API {exc.code} for {url}: {body}{reset_text}") from exc
            except (
                urllib.error.URLError,
                socket.timeout,
                TimeoutError,
                http.client.RemoteDisconnected,
                ConnectionError,
            ) as exc:
                if attempt < self.max_retries:
                    time.sleep(2**attempt)
                    continue
                raise GitHubError(f"GitHub API request failed for {url}: {exc}") from exc
        raise GitHubError(f"GitHub API request failed for {url}")

    def paginate(self, path: str, params: Optional[Dict[str, Any]] = None) -> Iterator[Any]:
        page = 1
        while True:
            page_params = dict(params or {})
            page_params["page"] = page
            page_params.setdefault("per_page", 100)
            items = self.request_json(path, page_params)
            if not items:
                break
            if not isinstance(items, list):
                raise GitHubError(f"Expected list response from {path}, got {type(items).__name__}")
            yield from items
            if len(items) < int(page_params["per_page"]):
                break
            page += 1

    def list_pull_requests(self, repo: RepoRef) -> Iterator[Dict[str, Any]]:
        path = f"/repos/{repo.owner}/{repo.name}/pulls"
        params = {
            "state": "all",
            "sort": "created",
            "direction": "desc",
            "per_page": 100,
        }
        yield from self.paginate(path, params)

    def get_pull_request(self, repo: RepoRef, number: int) -> Dict[str, Any]:
        path = f"/repos/{repo.owner}/{repo.name}/pulls/{number}"
        return self.request_json(path)

    def list_pull_files(self, repo: RepoRef, number: int) -> List[Dict[str, Any]]:
        path = f"/repos/{repo.owner}/{repo.name}/pulls/{number}/files"
        return list(self.paginate(path, {"per_page": 100}))

    def list_pull_reviews(self, repo: RepoRef, number: int) -> List[Dict[str, Any]]:
        path = f"/repos/{repo.owner}/{repo.name}/pulls/{number}/reviews"
        return list(self.paginate(path, {"per_page": 100}))

    def search_issues_count(self, query: str) -> int:
        data = self.request_json("/search/issues", {"q": query, "per_page": 1})
        return int((data or {}).get("total_count") or 0)

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "risk-pr-agent/0.1",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _url(self, path: str, params: Optional[Dict[str, Any]]) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            url = path
        else:
            url = f"{self.api_url}/{path.lstrip('/')}"
        if params:
            query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            return f"{url}?{query}"
        return url

    def _is_rate_limited(self, exc: urllib.error.HTTPError, body: str) -> bool:
        if exc.code not in {403, 429}:
            return False
        remaining = exc.headers.get("X-RateLimit-Remaining")
        if remaining == "0":
            return True
        return "rate limit" in body.lower()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_github_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def normalize_user(user: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not user:
        return None
    return {
        "login": user.get("login"),
        "type": user.get("type"),
        "site_admin": bool(user.get("site_admin")),
    }


def normalize_label(label: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": label.get("name"),
        "color": label.get("color"),
        "description": label.get("description"),
    }


def normalize_pr(repo: RepoRef, pr: Dict[str, Any], fetched_at: str) -> Dict[str, Any]:
    return {
        "schema_version": 1,
        "repo": repo.slug,
        "fetched_at": fetched_at,
        "number": pr.get("number"),
        "id": pr.get("id"),
        "node_id": pr.get("node_id"),
        "html_url": pr.get("html_url"),
        "state": pr.get("state"),
        "locked": bool(pr.get("locked")),
        "draft": bool(pr.get("draft")),
        "title": pr.get("title") or "",
        "body": pr.get("body") or "",
        "created_at": pr.get("created_at"),
        "updated_at": pr.get("updated_at"),
        "closed_at": pr.get("closed_at"),
        "merged_at": pr.get("merged_at"),
        "merge_commit_sha": pr.get("merge_commit_sha"),
        "author": normalize_user(pr.get("user")),
        "labels": [normalize_label(label) for label in pr.get("labels", [])],
        "assignees": [normalize_user(user) for user in pr.get("assignees", [])],
        "requested_reviewers": [
            normalize_user(user) for user in pr.get("requested_reviewers", [])
        ],
        "base": {
            "ref": (pr.get("base") or {}).get("ref"),
            "sha": (pr.get("base") or {}).get("sha"),
        },
        "head": {
            "ref": (pr.get("head") or {}).get("ref"),
            "sha": (pr.get("head") or {}).get("sha"),
            "repo": ((pr.get("head") or {}).get("repo") or {}).get("full_name"),
        },
        "metrics": {
            "commits": pr.get("commits") or 0,
            "additions": pr.get("additions") or 0,
            "deletions": pr.get("deletions") or 0,
            "changed_files": pr.get("changed_files") or 0,
            "comments": pr.get("comments") or 0,
            "review_comments": pr.get("review_comments") or 0,
        },
    }


def normalize_file(file_info: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "filename": file_info.get("filename"),
        "status": file_info.get("status"),
        "additions": file_info.get("additions") or 0,
        "deletions": file_info.get("deletions") or 0,
        "changes": file_info.get("changes") or 0,
        "previous_filename": file_info.get("previous_filename"),
        "patch": file_info.get("patch"),
    }


def normalize_review(review: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": review.get("id"),
        "state": review.get("state"),
        "submitted_at": review.get("submitted_at"),
        "user": normalize_user(review.get("user")),
    }


def write_jsonl(path: str, rows: Iterable[Dict[str, Any]]) -> int:
    count = 0
    open_func = gzip.open if path.endswith(".gz") else open
    with open_func(path, "wt", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
            count += 1
    return count


def read_jsonl(path: str) -> Iterator[Dict[str, Any]]:
    open_func = gzip.open if path.endswith(".gz") else open
    with open_func(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield json.loads(line)
