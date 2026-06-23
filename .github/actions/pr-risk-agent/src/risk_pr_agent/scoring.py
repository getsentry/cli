"""Simple baseline scoring and evaluation for PR risk datasets."""

from __future__ import annotations

import json
from bisect import bisect_right, insort
from typing import Any, Dict, Iterable, List, Sequence, Tuple


TOP_KS = (5, 10, 30)
RISK_LABELS = ("low", "medium", "high")
RISK_LABEL_RANK = {label: index for index, label in enumerate(RISK_LABELS)}


def score_feature_rows(
    rows: Sequence[Dict[str, Any]], percentile_mode: str = "as_of"
) -> List[Dict[str, Any]]:
    enriched = [dict(row) for row in rows]
    add_percentiles(enriched, "changed_lines", percentile_mode=percentile_mode)
    add_percentiles(enriched, "file_count", percentile_mode=percentile_mode)
    add_percentiles(enriched, "directory_count", percentile_mode=percentile_mode)
    add_percentiles(enriched, "entropy_of_change", percentile_mode=percentile_mode)
    add_percentiles(enriched, "max_file_churn_ratio", percentile_mode=percentile_mode)
    add_percentiles(enriched, "sum_churn_over_base_sloc", percentile_mode=percentile_mode)
    add_percentiles(enriched, "max_file_prior_reverts", percentile_mode=percentile_mode)
    add_percentiles(enriched, "max_dir_prior_reverts", percentile_mode=percentile_mode)
    add_percentiles(enriched, "max_file_prior_bad_outcomes", percentile_mode=percentile_mode)
    add_percentiles(enriched, "max_dir_prior_bad_outcomes", percentile_mode=percentile_mode)

    raw_scores: List[float] = []
    churn_scores: List[float] = []
    for row in enriched:
        features = row["prediction_features"]
        churn_score = (
            0.55 * features["changed_lines_percentile_repo"]
            + 0.30 * features["file_count_percentile_repo"]
            + 0.15 * features["directory_count_percentile_repo"]
        )
        score = churn_score
        score += 0.18 * features.get("max_file_churn_ratio_percentile_repo", 0)
        score += 0.12 * features.get("sum_churn_over_base_sloc_percentile_repo", 0)
        score += 12 if features.get("migration_changed") else 0
        score += 10 if features.get("ci_or_deploy_changed") else 0
        score += 10 if features.get("lockfile_changed") else 0
        score += 12 if features.get("auth_or_permission_changed") else 0
        score += 8 if features.get("public_api_changed") else 0
        score += 10 if features.get("code_changed_without_test_signal") else 0
        score += 8 if features.get("touches_error_handling") else 0
        score += 8 if features.get("touches_async_or_concurrency") else 0
        score += 6 if features.get("touches_serialization") else 0
        score += 8 if features.get("touches_data_deletion") else 0
        score += 0.15 * features.get("max_file_prior_reverts_percentile_repo", 0)
        score += 0.15 * features.get("max_dir_prior_reverts_percentile_repo", 0)
        score += 0.20 * features.get("max_file_prior_bad_outcomes_percentile_repo", 0)
        score += 0.15 * features.get("max_dir_prior_bad_outcomes_percentile_repo", 0)
        if features.get("file_count", 0) and features.get("author_touched_file_ratio", 0) == 0:
            score += 6
        if features.get("directory_count", 0) and features.get("author_touched_dir_ratio", 0) == 0:
            score += 4
        if features.get("docs_only") or features.get("generated_only"):
            score -= 35
        elif features.get("tests_only"):
            score -= 20
        if features.get("comment_only") or features.get("whitespace_only"):
            score -= 20
        if features.get("source_type") == "dependency_bot":
            score -= 5
        raw_scores.append(max(score, 0))
        churn_scores.append(max(churn_score, 0))

    rule_percentiles = percentile_values_for_rows(enriched, raw_scores, percentile_mode)
    churn_percentiles = percentile_values_for_rows(enriched, churn_scores, percentile_mode)
    for row, raw_score, churn_score, rule_pct, churn_pct in zip(
        enriched, raw_scores, churn_scores, rule_percentiles, churn_percentiles
    ):
        label = "low"
        if rule_pct >= 90 or raw_score >= 105:
            label = "high"
        elif rule_pct >= 70 or raw_score >= 80:
            label = "medium"
        row["prediction"] = {
            "risk_score_raw": round(raw_score, 3),
            "risk_percentile_repo": round(rule_pct, 3),
            "risk_label": label,
            "churn_score_raw": round(churn_score, 3),
            "churn_percentile_repo": round(churn_pct, 3),
            "percentile_mode": percentile_mode,
            "signals": build_signals(row),
        }
    return enriched


def add_percentiles(
    rows: Sequence[Dict[str, Any]], feature_name: str, percentile_mode: str = "as_of"
) -> None:
    by_repo: Dict[str, List[float]] = {}
    for row in rows:
        repo = row.get("repo") or ""
        features = row["prediction_features"]
        by_repo.setdefault(repo, []).append(float(features.get(feature_name) or 0))

    percentile_name = f"{feature_name}_percentile_repo"
    values = [float(row["prediction_features"].get(feature_name) or 0) for row in rows]
    percentiles = percentile_values_for_rows(rows, values, percentile_mode)
    for row, percentile in zip(rows, percentiles):
        row["prediction_features"][percentile_name] = round(percentile, 3)


def percentile_values_for_rows(
    rows: Sequence[Dict[str, Any]], values: Sequence[float], percentile_mode: str
) -> List[float]:
    if percentile_mode == "global":
        by_repo: Dict[str, List[float]] = {}
        for row, value in zip(rows, values):
            by_repo.setdefault(row.get("repo") or "", []).append(float(value))
        repo_sorted = {repo: sorted(repo_values) for repo, repo_values in by_repo.items()}
        return [
            percentile_rank(float(value), repo_sorted[row.get("repo") or ""])
            for row, value in zip(rows, values)
        ]
    if percentile_mode == "as_of":
        return as_of_percentile_values(rows, values)
    raise ValueError(f"unknown percentile_mode: {percentile_mode}")


def as_of_percentile_values(rows: Sequence[Dict[str, Any]], values: Sequence[float]) -> List[float]:
    result = [0.0] * len(rows)
    sorted_indices = sorted(
        range(len(rows)),
        key=lambda index: (
            rows[index].get("created_at") or "",
            rows[index].get("repo") or "",
            int(rows[index].get("number") or 0),
        ),
    )
    prior_by_repo: Dict[str, List[float]] = {}
    index = 0
    while index < len(sorted_indices):
        first = sorted_indices[index]
        repo = rows[first].get("repo") or ""
        created_at = rows[first].get("created_at") or ""
        group: List[int] = []
        while index < len(sorted_indices):
            current = sorted_indices[index]
            current_key = (rows[current].get("repo") or "", rows[current].get("created_at") or "")
            if current_key != (repo, created_at):
                break
            group.append(current)
            index += 1
        prior_values = prior_by_repo.setdefault(repo, [])
        for row_index in group:
            result[row_index] = percentile_rank(float(values[row_index]), prior_values)
        for row_index in group:
            insort(prior_values, float(values[row_index]))
    return result


def add_global_percentiles(rows: Sequence[Dict[str, Any]], feature_name: str) -> None:
    by_repo: Dict[str, List[float]] = {}
    for row in rows:
        repo = row.get("repo") or ""
        features = row["prediction_features"]
        by_repo.setdefault(repo, []).append(float(features.get(feature_name) or 0))

    repo_sorted = {repo: sorted(values) for repo, values in by_repo.items()}
    percentile_name = f"{feature_name}_percentile_repo"
    for row in rows:
        repo = row.get("repo") or ""
        value = float(row["prediction_features"].get(feature_name) or 0)
        row["prediction_features"][percentile_name] = round(percentile_rank(value, repo_sorted[repo]), 3)


def percentile_rank(value: float, sorted_values: Sequence[float]) -> float:
    if not sorted_values:
        return 0.0
    below_or_equal = bisect_right(sorted_values, value)
    return 100.0 * below_or_equal / len(sorted_values)


def percentile_values(values: Sequence[float]) -> List[float]:
    sorted_values = sorted(values)
    return [percentile_rank(value, sorted_values) for value in values]


def build_signals(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    features = row["prediction_features"]
    signals: List[Dict[str, Any]] = []
    if features.get("changed_lines_percentile_repo", 0) >= 90:
        signals.append(
            {
                "name": "unusual_change_size",
                "severity": "medium",
                "reason": f"Changed lines are p{features['changed_lines_percentile_repo']:.0f} for this dataset slice.",
            }
        )
    if features.get("file_count_percentile_repo", 0) >= 90:
        signals.append(
            {
                "name": "broad_file_diffusion",
                "severity": "medium",
                "reason": f"Files touched are p{features['file_count_percentile_repo']:.0f} for this dataset slice.",
            }
        )
    if features.get("migration_changed"):
        signals.append(
            {
                "name": "migration_changed",
                "severity": "high",
                "reason": "Migration-like path changed.",
            }
        )
    if features.get("auth_or_permission_changed"):
        signals.append(
            {
                "name": "auth_or_permission_changed",
                "severity": "high",
                "reason": "Auth, permission, token, session, or RBAC path changed.",
            }
        )
    if features.get("ci_or_deploy_changed"):
        signals.append(
            {
                "name": "ci_or_deploy_changed",
                "severity": "medium",
                "reason": "CI, deployment, or workflow path changed.",
            }
        )
    if features.get("code_changed_without_test_signal"):
        signals.append(
            {
                "name": "code_changed_without_test_signal",
                "severity": "medium",
                "reason": "Code-like files changed without a test-path change in the same PR.",
            }
        )
    if features.get("max_file_prior_reverts", 0) > 0 or features.get("max_dir_prior_reverts", 0) > 0:
        signals.append(
            {
                "name": "historical_revert_nearby",
                "severity": "high",
                "reason": "Touched files or directories had a prior revert event in this dataset slice.",
            }
        )
    if (
        features.get("max_file_prior_bad_outcomes", 0) > 0
        or features.get("max_dir_prior_bad_outcomes", 0) > 0
    ):
        signals.append(
            {
                "name": "historical_bad_outcome_nearby",
                "severity": "high",
                "reason": "Touched files or directories had a prior revert or strict follow-up fix.",
            }
        )
    if features.get("max_file_churn_ratio_percentile_repo", 0) >= 90:
        signals.append(
            {
                "name": "large_relative_churn",
                "severity": "medium",
                "reason": f"File churn relative to prior size is p{features['max_file_churn_ratio_percentile_repo']:.0f}.",
            }
        )
    if features.get("author_touched_file_ratio", 1) == 0 and features.get("file_count", 0):
        signals.append(
            {
                "name": "low_author_file_familiarity",
                "severity": "medium",
                "reason": "The author has no prior touches on the files in this dataset slice.",
            }
        )
    if any(
        features.get(name)
        for name in [
            "touches_error_handling",
            "touches_async_or_concurrency",
            "touches_serialization",
            "touches_data_deletion",
        ]
    ):
        signals.append(
            {
                "name": "sensitive_patch_semantics",
                "severity": "medium",
                "reason": "Patch text touches error handling, concurrency, serialization, or deletion semantics.",
            }
        )
    if not signals and (features.get("docs_only") or features.get("tests_only") or features.get("generated_only")):
        signals.append(
            {
                "name": "safe_lowering_scope",
                "severity": "low",
                "reason": "Change appears limited to docs, tests, or generated files.",
            }
        )
    return signals


def evaluate_predictions(
    rows: Sequence[Dict[str, Any]], outcome_name: str = "strong_outcome", merged_only: bool = True
) -> Dict[str, Any]:
    return evaluate_prediction_scores(
        rows,
        outcome_name=outcome_name,
        score_paths=[
            ("rule_percentile", ("prediction", "risk_percentile_repo")),
            ("churn_percentile", ("prediction", "churn_percentile_repo")),
        ],
        merged_only=merged_only,
    )


def evaluate_prediction_scores(
    rows: Sequence[Dict[str, Any]],
    outcome_name: str,
    score_paths: Sequence[Tuple[str, Tuple[str, str]]],
    merged_only: bool = True,
) -> Dict[str, Any]:
    evaluated_rows = [
        row for row in rows if not merged_only or row.get("outcomes", {}).get("is_merged")
    ]
    total = len(evaluated_rows)
    positives = sum(1 for row in evaluated_rows if row["outcomes"].get(outcome_name))
    result: Dict[str, Any] = {
        "total_prs": total,
        "input_prs": len(rows),
        "merged_only": merged_only,
        "positive_outcomes": positives,
        "outcome_name": outcome_name,
        "metrics": {},
        "label_safety": {},
    }
    for score_name, key in score_paths:
        sorted_rows = sorted(evaluated_rows, key=lambda row: nested_get(row, key), reverse=True)
        result["metrics"][score_name] = topk_metrics(sorted_rows, positives, outcome_name)
        result["label_safety"][score_name] = outcome_label_safety_metrics(
            evaluated_rows,
            outcome_name,
            score_name,
            key,
        )
    return result


def topk_metrics(
    sorted_rows: Sequence[Dict[str, Any]], positives: int, outcome_name: str
) -> Dict[str, Dict[str, Any]]:
    metrics: Dict[str, Dict[str, Any]] = {}
    total = len(sorted_rows)
    for k in TOP_KS:
        bucket_size = max(1, int(round(total * (k / 100))))
        bucket = sorted_rows[:bucket_size]
        true_positives = sum(1 for row in bucket if row["outcomes"].get(outcome_name))
        recall = true_positives / positives if positives else 0.0
        precision = true_positives / bucket_size if bucket_size else 0.0
        random_recall = k / 100
        metrics[f"top_{k}"] = {
            "bucket_size": bucket_size,
            "true_positives": true_positives,
            "recall": round(recall, 4),
            "precision": round(precision, 4),
            "lift_over_random": round(recall / random_recall, 3) if random_recall else 0.0,
        }
    return metrics


def nested_get(row: Dict[str, Any], keys: Tuple[str, str]) -> float:
    outer, inner = keys
    return float((row.get(outer) or {}).get(inner) or 0)


def outcome_label_safety_metrics(
    rows: Sequence[Dict[str, Any]],
    outcome_name: str,
    score_name: str,
    score_key: Tuple[str, str],
) -> Dict[str, Any]:
    """Measure the dangerous miss mode: outcome-positive PRs labeled low."""

    label_counts = empty_label_counts()
    positive_counts = empty_label_counts()
    positives = 0
    for row in rows:
        label = predicted_label_for_score(row, score_name, score_key)
        label_counts[label] = label_counts.get(label, 0) + 1
        if row.get("outcomes", {}).get(outcome_name):
            positives += 1
            positive_counts[label] = positive_counts.get(label, 0) + 1

    high_as_low = positive_counts["low"]
    positive_not_high = positives - positive_counts["high"]
    low_label_count = label_counts["low"]
    return {
        "actual_high_definition": f"{outcome_name}=true",
        "label_counts": label_counts,
        "positive_outcomes_by_label": positive_counts,
        "positive_outcomes_marked_low": high_as_low,
        "positive_outcomes_marked_low_rate": round(high_as_low / positives, 4) if positives else 0.0,
        "positive_outcomes_not_marked_high": positive_not_high,
        "positive_outcomes_not_marked_high_rate": round(positive_not_high / positives, 4)
        if positives
        else 0.0,
        "non_low_recall_for_positive_outcomes": round(
            (positives - high_as_low) / positives,
            4,
        )
        if positives
        else 0.0,
        "high_label_recall_for_positive_outcomes": round(positive_counts["high"] / positives, 4)
        if positives
        else 0.0,
        "low_label_positive_rate": round(high_as_low / low_label_count, 4) if low_label_count else 0.0,
    }


def predicted_label_for_score(
    row: Dict[str, Any],
    score_name: str,
    score_key: Tuple[str, str],
) -> str:
    prediction = row.get("prediction") or {}
    explicit_label = None
    if score_name == "logistic_probability":
        explicit_label = prediction.get("logistic_risk_label")
    elif score_name == "rule_percentile":
        explicit_label = prediction.get("risk_label")
    label = normalize_risk_label(explicit_label)
    if label:
        return label
    score = nested_get(row, score_key)
    if score_name.endswith("percentile") or score > 1:
        return risk_label_for_percentile(score)
    return "unknown"


def risk_label_for_percentile(percentile: float) -> str:
    if percentile >= 90:
        return "high"
    if percentile >= 70:
        return "medium"
    return "low"


def combine_risk_labels(*labels: Any) -> str:
    normalized = [normalize_risk_label(label) for label in labels]
    ranked = [label for label in normalized if label]
    if not ranked:
        return "unknown"
    return max(ranked, key=lambda label: RISK_LABEL_RANK[label])


def apply_final_risk_label(prediction: Dict[str, Any]) -> None:
    """Set the deployable risk label from logistic and deterministic labels."""

    prediction["final_risk_label"] = combine_risk_labels(
        prediction.get("logistic_risk_label"),
        prediction.get("risk_label"),
    )
    prediction["final_risk_policy"] = "max_logistic_rule_v1"


def evaluate_label_confusion(
    rows: Sequence[Dict[str, Any]],
    actual_label_key: str = "audit_label",
    predicted_label_key: str = "model_label",
) -> Dict[str, Any]:
    """Evaluate low/medium/high labels when explicit audit labels are available."""

    confusion = {actual: empty_label_counts() for actual in RISK_LABELS}
    confusion["unknown"] = empty_label_counts()
    label_counts = empty_label_counts()
    actual_counts = empty_label_counts()
    undercalls = 0
    overcalls = 0
    high_as_low = 0
    evaluated = 0

    for row in rows:
        actual = normalize_risk_label(row.get(actual_label_key)) or "unknown"
        predicted = normalize_risk_label(row.get(predicted_label_key)) or "unknown"
        evaluated += 1
        confusion.setdefault(actual, empty_label_counts())
        confusion[actual][predicted] = confusion[actual].get(predicted, 0) + 1
        label_counts[predicted] = label_counts.get(predicted, 0) + 1
        actual_counts[actual] = actual_counts.get(actual, 0) + 1

        actual_rank = RISK_LABEL_RANK.get(actual)
        predicted_rank = RISK_LABEL_RANK.get(predicted)
        if actual_rank is None or predicted_rank is None:
            continue
        if predicted_rank < actual_rank:
            undercalls += 1
        elif predicted_rank > actual_rank:
            overcalls += 1
        if actual == "high" and predicted == "low":
            high_as_low += 1

    high_actual = actual_counts["high"]
    return {
        "total_rows": evaluated,
        "actual_label_key": actual_label_key,
        "predicted_label_key": predicted_label_key,
        "actual_label_counts": actual_counts,
        "predicted_label_counts": label_counts,
        "confusion": confusion,
        "undercalls": undercalls,
        "undercall_rate": round(undercalls / evaluated, 4) if evaluated else 0.0,
        "overcalls": overcalls,
        "overcall_rate": round(overcalls / evaluated, 4) if evaluated else 0.0,
        "high_as_low": high_as_low,
        "high_as_low_rate": round(high_as_low / high_actual, 4) if high_actual else 0.0,
    }


def normalize_risk_label(value: Any) -> str:
    label = str(value or "").strip().lower()
    return label if label in RISK_LABEL_RANK else ""


def empty_label_counts() -> Dict[str, int]:
    return {"low": 0, "medium": 0, "high": 0, "unknown": 0}


def write_json(path: str, data: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")


def markdown_report(evaluation: Dict[str, Any]) -> str:
    lines = [
        "# Risk Dataset Evaluation",
        "",
        f"- Input PRs: {evaluation['input_prs']}",
        f"- Total PRs: {evaluation['total_prs']}",
        f"- Merged-only evaluation: {evaluation['merged_only']}",
        f"- Positive outcomes (`{evaluation['outcome_name']}`): {evaluation['positive_outcomes']}",
        "",
    ]
    if evaluation["positive_outcomes"] == 0:
        lines.extend(
            [
                "> Warning: this evaluated slice has zero positive outcomes, so Recall@Top-k cannot validate ranking quality.",
                "",
            ]
        )
    for score_name, metrics in evaluation["metrics"].items():
        lines.append(f"## {score_name}")
        lines.append("")
        lines.append("| Bucket | Size | TP | Recall | Precision | Lift over random |")
        lines.append("| --- | ---: | ---: | ---: | ---: | ---: |")
        for bucket, values in metrics.items():
            lines.append(
                "| {bucket} | {size} | {tp} | {recall:.4f} | {precision:.4f} | {lift:.3f} |".format(
                    bucket=bucket,
                    size=values["bucket_size"],
                    tp=values["true_positives"],
                    recall=values["recall"],
                    precision=values["precision"],
                    lift=values["lift_over_random"],
                )
            )
        lines.append("")
    if evaluation.get("label_safety"):
        lines.append("## Label Safety")
        lines.append("")
        lines.append(
            "| Score | Positive-as-low | Positive-as-low rate | Non-low recall | High-label recall | Low-label positive rate |"
        )
        lines.append("| --- | ---: | ---: | ---: | ---: | ---: |")
        for score_name, values in evaluation["label_safety"].items():
            lines.append(
                "| {score} | {low_count} | {low_rate:.4f} | {non_low:.4f} | {high_recall:.4f} | {low_positive:.4f} |".format(
                    score=score_name,
                    low_count=values["positive_outcomes_marked_low"],
                    low_rate=values["positive_outcomes_marked_low_rate"],
                    non_low=values["non_low_recall_for_positive_outcomes"],
                    high_recall=values["high_label_recall_for_positive_outcomes"],
                    low_positive=values["low_label_positive_rate"],
                )
            )
        lines.append("")
    return "\n".join(lines)
