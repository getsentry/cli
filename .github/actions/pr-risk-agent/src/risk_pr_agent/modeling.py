"""Stdlib-only logistic regression baseline for PR risk datasets."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .github import parse_github_time
from .scoring import (
    evaluate_prediction_scores,
    markdown_report,
    percentile_values_for_rows,
    score_feature_rows,
)


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    transform: str = "log1p"
    category_value: Optional[str] = None

    @property
    def output_name(self) -> str:
        if self.category_value is not None:
            return f"{self.name}_{self.category_value}"
        return self.name


PROCESS_FEATURES = {"commits", "comments", "review_comments"}
DEFAULT_FEATURE_SET = "static_no_process"
FEATURE_SET_ALIASES = {
    "at_open": "static_no_process",
    "in_review": "in_review_final",
}


BASE_LOGISTIC_FEATURES: Tuple[FeatureSpec, ...] = (
    FeatureSpec("changed_lines"),
    FeatureSpec("added_lines"),
    FeatureSpec("deleted_lines"),
    FeatureSpec("file_count"),
    FeatureSpec("directory_count"),
    FeatureSpec("top_level_directory_count"),
    FeatureSpec("extension_count"),
    FeatureSpec("language_count"),
    FeatureSpec("entropy_of_change", transform="identity"),
    FeatureSpec("commits"),
    FeatureSpec("comments"),
    FeatureSpec("review_comments"),
    FeatureSpec("new_file_count"),
    FeatureSpec("removed_file_count"),
    FeatureSpec("renamed_file_count"),
    FeatureSpec("modified_file_count"),
    FeatureSpec("new_file_ratio", transform="identity"),
    FeatureSpec("code_file_count"),
    FeatureSpec("test_file_count"),
    FeatureSpec("docs_file_count"),
    FeatureSpec("generated_file_count"),
    FeatureSpec("config_file_count"),
    FeatureSpec("migration_file_count"),
    FeatureSpec("ci_deploy_file_count"),
    FeatureSpec("lockfile_count"),
    FeatureSpec("auth_permission_file_count"),
    FeatureSpec("public_api_file_count"),
    FeatureSpec("sensitive_file_count"),
    FeatureSpec("sensitive_area_count"),
    FeatureSpec("max_file_prior_prs"),
    FeatureSpec("sum_file_prior_prs"),
    FeatureSpec("max_dir_prior_prs"),
    FeatureSpec("sum_dir_prior_prs"),
    FeatureSpec("max_top_level_dir_prior_prs"),
    FeatureSpec("sum_top_level_dir_prior_prs"),
    FeatureSpec("max_file_prior_reverts"),
    FeatureSpec("max_dir_prior_reverts"),
    FeatureSpec("sum_file_prior_reverts"),
    FeatureSpec("sum_dir_prior_reverts"),
    FeatureSpec("max_file_prior_authors"),
    FeatureSpec("sum_file_prior_authors"),
    FeatureSpec("max_dir_prior_authors"),
    FeatureSpec("sum_dir_prior_authors"),
    FeatureSpec("max_top_level_dir_prior_authors"),
    FeatureSpec("sum_top_level_dir_prior_authors"),
    FeatureSpec("min_file_days_since_last_change"),
    FeatureSpec("avg_file_days_since_last_change"),
    FeatureSpec("max_file_days_since_last_change"),
    FeatureSpec("max_file_prior_prs_90d"),
    FeatureSpec("sum_file_prior_prs_90d"),
    FeatureSpec("max_dir_prior_prs_90d"),
    FeatureSpec("sum_dir_prior_prs_90d"),
    FeatureSpec("author_repo_prior_prs"),
    FeatureSpec("author_repo_recent_prs_90d"),
    FeatureSpec("author_max_file_prior_prs"),
    FeatureSpec("author_sum_file_prior_prs"),
    FeatureSpec("author_max_dir_prior_prs"),
    FeatureSpec("author_sum_dir_prior_prs"),
    FeatureSpec("author_max_top_level_dir_prior_prs"),
    FeatureSpec("author_sum_top_level_dir_prior_prs"),
    FeatureSpec("author_created_file_count"),
    FeatureSpec("author_created_file_ratio", transform="identity"),
    FeatureSpec("only_new_files", transform="bool"),
    FeatureSpec("db_or_storage_changed", transform="bool"),
    FeatureSpec("ingest_or_pipeline_changed", transform="bool"),
    FeatureSpec("billing_or_quota_changed", transform="bool"),
    FeatureSpec("security_or_privacy_changed", transform="bool"),
    FeatureSpec("ownership_or_org_changed", transform="bool"),
    FeatureSpec("sensitive_area_changed", transform="bool"),
    FeatureSpec("title_fix_like", transform="bool"),
    FeatureSpec("title_revert_like", transform="bool"),
    FeatureSpec("title_refactor_like", transform="bool"),
    FeatureSpec("body_has_test_plan", transform="bool"),
    FeatureSpec("body_says_no_tests", transform="bool"),
    FeatureSpec("hotfix_like_text", transform="bool"),
    FeatureSpec("references_other_pr", transform="bool"),
    FeatureSpec("docs_only", transform="bool"),
    FeatureSpec("tests_only", transform="bool"),
    FeatureSpec("generated_only", transform="bool"),
    FeatureSpec("tests_changed", transform="bool"),
    FeatureSpec("code_changed_without_test_signal", transform="bool"),
    FeatureSpec("config_or_env_changed", transform="bool"),
    FeatureSpec("migration_changed", transform="bool"),
    FeatureSpec("ci_or_deploy_changed", transform="bool"),
    FeatureSpec("lockfile_changed", transform="bool"),
    FeatureSpec("auth_or_permission_changed", transform="bool"),
    FeatureSpec("public_api_changed", transform="bool"),
    FeatureSpec("source_type", transform="category", category_value="bot"),
    FeatureSpec("source_type", transform="category", category_value="dependency_bot"),
)


LOGISTIC_FEATURES: Tuple[FeatureSpec, ...] = BASE_LOGISTIC_FEATURES


SELECTED_STATIC_V1_FEATURES: Tuple[FeatureSpec, ...] = (
    FeatureSpec("changed_lines"),
    FeatureSpec("changed_lines_percentile_repo", transform="identity"),
    FeatureSpec("added_lines"),
    FeatureSpec("deleted_lines"),
    FeatureSpec("deleted_line_ratio", transform="identity"),
    FeatureSpec("file_count"),
    FeatureSpec("file_count_percentile_repo", transform="identity"),
    FeatureSpec("directory_count"),
    FeatureSpec("directory_count_percentile_repo", transform="identity"),
    FeatureSpec("top_level_directory_count"),
    FeatureSpec("entropy_of_change", transform="identity"),
    FeatureSpec("new_file_ratio", transform="identity"),
    FeatureSpec("only_new_files", transform="bool"),
    FeatureSpec("removed_file_count"),
    FeatureSpec("renamed_file_count"),
    FeatureSpec("max_file_churn_ratio", transform="identity"),
    FeatureSpec("max_file_churn_ratio_percentile_repo", transform="identity"),
    FeatureSpec("avg_file_churn_ratio", transform="identity"),
    FeatureSpec("sum_churn_over_base_sloc", transform="identity"),
    FeatureSpec("sum_churn_over_base_sloc_percentile_repo", transform="identity"),
    FeatureSpec("known_prior_file_size_count"),
    FeatureSpec("large_relative_churn", transform="bool"),
    FeatureSpec("max_file_prior_prs"),
    FeatureSpec("sum_file_prior_prs"),
    FeatureSpec("max_dir_prior_prs"),
    FeatureSpec("sum_dir_prior_prs"),
    FeatureSpec("max_file_prior_authors"),
    FeatureSpec("max_dir_prior_authors"),
    FeatureSpec("author_repo_prior_prs"),
    FeatureSpec("author_repo_recent_prs_90d"),
    FeatureSpec("author_touched_file_ratio", transform="identity"),
    FeatureSpec("author_touched_dir_ratio", transform="identity"),
    FeatureSpec("author_file_experience_share", transform="identity"),
    FeatureSpec("author_dir_experience_share", transform="identity"),
    FeatureSpec("author_created_file_ratio", transform="identity"),
    FeatureSpec("max_file_prior_reverts"),
    FeatureSpec("sum_file_prior_reverts"),
    FeatureSpec("max_dir_prior_reverts"),
    FeatureSpec("sum_dir_prior_reverts"),
    FeatureSpec("max_file_prior_bad_outcomes"),
    FeatureSpec("max_file_prior_bad_outcomes_percentile_repo", transform="identity"),
    FeatureSpec("sum_file_prior_bad_outcomes"),
    FeatureSpec("max_dir_prior_bad_outcomes"),
    FeatureSpec("max_dir_prior_bad_outcomes_percentile_repo", transform="identity"),
    FeatureSpec("sum_dir_prior_bad_outcomes"),
    FeatureSpec("max_file_prior_bad_outcomes_90d"),
    FeatureSpec("max_dir_prior_bad_outcomes_90d"),
    FeatureSpec("max_file_prior_bad_outcomes_365d"),
    FeatureSpec("max_dir_prior_bad_outcomes_365d"),
    FeatureSpec("docs_only", transform="bool"),
    FeatureSpec("tests_only", transform="bool"),
    FeatureSpec("generated_only", transform="bool"),
    FeatureSpec("tests_changed", transform="bool"),
    FeatureSpec("code_changed_without_test_signal", transform="bool"),
    FeatureSpec("migration_changed", transform="bool"),
    FeatureSpec("ci_or_deploy_changed", transform="bool"),
    FeatureSpec("lockfile_changed", transform="bool"),
    FeatureSpec("auth_or_permission_changed", transform="bool"),
    FeatureSpec("public_api_changed", transform="bool"),
    FeatureSpec("db_or_storage_changed", transform="bool"),
    FeatureSpec("ingest_or_pipeline_changed", transform="bool"),
    FeatureSpec("security_or_privacy_changed", transform="bool"),
    FeatureSpec("ownership_or_org_changed", transform="bool"),
    FeatureSpec("sensitive_area_changed", transform="bool"),
    FeatureSpec("comment_only", transform="bool"),
    FeatureSpec("whitespace_only", transform="bool"),
    FeatureSpec("touches_error_handling", transform="bool"),
    FeatureSpec("touches_async_or_concurrency", transform="bool"),
    FeatureSpec("touches_serialization", transform="bool"),
    FeatureSpec("touches_data_deletion", transform="bool"),
    FeatureSpec("title_fix_like", transform="bool"),
    FeatureSpec("title_revert_like", transform="bool"),
    FeatureSpec("title_refactor_like", transform="bool"),
    FeatureSpec("body_has_test_plan", transform="bool"),
    FeatureSpec("body_says_no_tests", transform="bool"),
    FeatureSpec("references_other_pr", transform="bool"),
    FeatureSpec("source_type", transform="category", category_value="bot"),
    FeatureSpec("source_type", transform="category", category_value="dependency_bot"),
    FeatureSpec("source_type", transform="category", category_value="codemod"),
    FeatureSpec("source_type", transform="category", category_value="ai_generated"),
)


def canonical_feature_set(feature_set: str) -> str:
    return FEATURE_SET_ALIASES.get(feature_set, feature_set)


def feature_specs_for(feature_set: str) -> Tuple[FeatureSpec, ...]:
    feature_set = canonical_feature_set(feature_set)
    if feature_set == "legacy":
        legacy_names = {
            "changed_lines",
            "added_lines",
            "deleted_lines",
            "file_count",
            "directory_count",
            "top_level_directory_count",
            "extension_count",
            "language_count",
            "entropy_of_change",
            "commits",
            "comments",
            "review_comments",
            "code_file_count",
            "test_file_count",
            "docs_file_count",
            "generated_file_count",
            "config_file_count",
            "migration_file_count",
            "ci_deploy_file_count",
            "lockfile_count",
            "auth_permission_file_count",
            "public_api_file_count",
            "max_file_prior_prs",
            "max_dir_prior_prs",
            "max_file_prior_reverts",
            "max_dir_prior_reverts",
            "sum_file_prior_reverts",
            "sum_dir_prior_reverts",
            "docs_only",
            "tests_only",
            "generated_only",
            "tests_changed",
            "code_changed_without_test_signal",
            "config_or_env_changed",
            "migration_changed",
            "ci_or_deploy_changed",
            "lockfile_changed",
            "auth_or_permission_changed",
            "public_api_changed",
            "source_type",
        }
        return tuple(spec for spec in BASE_LOGISTIC_FEATURES if spec.name in legacy_names)
    if feature_set == "static_no_process":
        return tuple(spec for spec in BASE_LOGISTIC_FEATURES if spec.name not in PROCESS_FEATURES)
    if feature_set == "selected_static_v1":
        return SELECTED_STATIC_V1_FEATURES
    if feature_set == "in_review_final":
        return BASE_LOGISTIC_FEATURES
    raise ValueError(f"unknown feature_set: {feature_set}")


def train_logistic_baseline(
    feature_rows: Sequence[Dict[str, Any]],
    outcome_name: str,
    train_fraction: float = 0.8,
    epochs: int = 800,
    learning_rate: float = 0.05,
    l2: float = 0.01,
    class_balance: bool = True,
    include_unmerged: bool = False,
    feature_set: str = DEFAULT_FEATURE_SET,
    validation_fraction: float = 0.1,
    percentile_mode: str = "as_of",
    maturity_days: int = 0,
) -> Dict[str, Any]:
    """Train and evaluate an interpretable logistic baseline."""

    if not 0 < train_fraction < 1:
        raise ValueError("train_fraction must be between 0 and 1")
    if not 0 <= validation_fraction < 1:
        raise ValueError("validation_fraction must be between 0 and 1")
    if train_fraction + validation_fraction >= 1:
        raise ValueError("train_fraction + validation_fraction must be less than 1")
    if maturity_days < 0:
        raise ValueError("maturity_days must be non-negative")

    canonical_set = canonical_feature_set(feature_set)
    scored_rows = score_feature_rows(feature_rows, percentile_mode=percentile_mode)
    evaluated_rows = [
        row for row in scored_rows if include_unmerged or row.get("outcomes", {}).get("is_merged")
    ]
    evaluated_rows.sort(key=lambda row: row.get("created_at") or "")
    evaluated_rows_before_maturity = len(evaluated_rows)
    maturity_cutoff = None
    if maturity_days:
        created_values = [
            parse_github_time(row.get("created_at"))
            for row in evaluated_rows
            if row.get("created_at")
        ]
        created_values = [value for value in created_values if value]
        if not created_values:
            raise ValueError("maturity_days requires rows with created_at timestamps")
        maturity_cutoff_dt = max(created_values) - timedelta(days=maturity_days)
        maturity_cutoff = maturity_cutoff_dt.isoformat().replace("+00:00", "Z")
        evaluated_rows = [
            row
            for row in evaluated_rows
            if (parse_github_time(row.get("created_at")) or maturity_cutoff_dt) <= maturity_cutoff_dt
        ]
    if len(evaluated_rows) < 2:
        raise ValueError("at least two evaluated rows are required")

    train_rows, validation_rows, test_rows = split_chronological_rows(
        evaluated_rows, train_fraction, validation_fraction
    )
    train_labels = labels_for_rows(train_rows, outcome_name)
    validation_labels = labels_for_rows(validation_rows, outcome_name)
    test_labels = labels_for_rows(test_rows, outcome_name)
    if sum(train_labels) == 0:
        raise ValueError(f"training split has zero positive {outcome_name} labels")

    feature_specs = feature_specs_for(canonical_set)
    train_matrix_raw = raw_feature_matrix(train_rows, feature_specs)
    normalizer = fit_normalizer(train_matrix_raw)
    train_matrix = apply_normalizer(train_matrix_raw, normalizer)
    fit = fit_logistic_regression(
        train_matrix,
        train_labels,
        epochs=epochs,
        learning_rate=learning_rate,
        l2=l2,
        class_balance=class_balance,
    )

    modeled_rows = apply_logistic_model(
        scored_rows,
        fit,
        normalizer,
        feature_specs,
        percentile_mode=percentile_mode,
    )
    train_keys = row_keys(train_rows)
    validation_keys = row_keys(validation_rows)
    test_keys = row_keys(test_rows)
    modeled_train_rows = [row for row in modeled_rows if row_key(row) in train_keys]
    modeled_validation_rows = [row for row in modeled_rows if row_key(row) in validation_keys]
    modeled_test_rows = [row for row in modeled_rows if row_key(row) in test_keys]
    evaluated_keys = train_keys | validation_keys | test_keys
    modeled_evaluated_rows = [row for row in modeled_rows if row_key(row) in evaluated_keys]

    score_paths = [
        ("logistic_probability", ("prediction", "logistic_probability")),
        ("rule_percentile", ("prediction", "risk_percentile_repo")),
        ("churn_percentile", ("prediction", "churn_percentile_repo")),
    ]
    model = {
        "schema_version": 1,
        "model_type": "logistic_regression",
        "outcome_name": outcome_name,
        "feature_set": canonical_set,
        "requested_feature_set": feature_set,
        "train_fraction": train_fraction,
        "validation_fraction": validation_fraction,
        "test_fraction": round(1 - train_fraction - validation_fraction, 8),
        "split": "chronological_train_validation_test",
        "percentile_mode": percentile_mode,
        "include_unmerged": include_unmerged,
        "maturity_days": maturity_days,
        "maturity_cutoff_created_at": maturity_cutoff,
        "evaluated_rows_before_maturity": evaluated_rows_before_maturity,
        "maturity_excluded_rows": evaluated_rows_before_maturity - len(evaluated_rows),
        "epochs": epochs,
        "learning_rate": learning_rate,
        "l2": l2,
        "class_balance": class_balance,
        "intercept": round(fit["intercept"], 8),
        "loss": fit["loss"],
        "features": serialize_weights(fit["weights"], normalizer, feature_specs),
        "train": {
            "rows": len(train_rows),
            "positive_outcomes": sum(train_labels),
            "created_at_min": train_rows[0].get("created_at"),
            "created_at_max": train_rows[-1].get("created_at"),
        },
        "validation": {
            "rows": len(validation_rows),
            "positive_outcomes": sum(validation_labels),
            "created_at_min": validation_rows[0].get("created_at") if validation_rows else None,
            "created_at_max": validation_rows[-1].get("created_at") if validation_rows else None,
        },
        "test": {
            "rows": len(test_rows),
            "positive_outcomes": sum(test_labels),
            "created_at_min": test_rows[0].get("created_at"),
            "created_at_max": test_rows[-1].get("created_at"),
        },
    }
    return {
        "model": model,
        "modeled_rows": modeled_rows,
        "train_evaluation": evaluate_prediction_scores(
            modeled_train_rows,
            outcome_name=outcome_name,
            score_paths=score_paths,
            merged_only=False,
        ),
        "validation_evaluation": evaluate_prediction_scores(
            modeled_validation_rows,
            outcome_name=outcome_name,
            score_paths=score_paths,
            merged_only=False,
        ),
        "test_evaluation": evaluate_prediction_scores(
            modeled_test_rows,
            outcome_name=outcome_name,
            score_paths=score_paths,
            merged_only=False,
        ),
        "all_evaluation": evaluate_prediction_scores(
            modeled_evaluated_rows,
            outcome_name=outcome_name,
            score_paths=score_paths,
            merged_only=False,
        ),
    }


def split_chronological_rows(
    rows: Sequence[Dict[str, Any]], train_fraction: float, validation_fraction: float
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    row_count = len(rows)
    train_count = int(round(row_count * train_fraction))
    train_count = max(1, min(train_count, row_count - 1))
    remaining_count = row_count - train_count
    validation_count = int(round(row_count * validation_fraction))
    if remaining_count <= 1:
        validation_count = 0
    else:
        validation_count = max(0, min(validation_count, remaining_count - 1))
    test_start = train_count + validation_count
    return (
        list(rows[:train_count]),
        list(rows[train_count:test_start]),
        list(rows[test_start:]),
    )


def labels_for_rows(rows: Sequence[Dict[str, Any]], outcome_name: str) -> List[int]:
    return [1 if row.get("outcomes", {}).get(outcome_name) else 0 for row in rows]


def raw_feature_matrix(
    rows: Sequence[Dict[str, Any]], specs: Sequence[FeatureSpec]
) -> List[List[float]]:
    return [[feature_value(row, spec) for spec in specs] for row in rows]


def feature_value(row: Dict[str, Any], spec: FeatureSpec) -> float:
    features = row.get("prediction_features") or {}
    if spec.transform == "category":
        return 1.0 if features.get(spec.name) == spec.category_value else 0.0
    if spec.transform == "bool":
        return 1.0 if features.get(spec.name) else 0.0
    value = safe_float(features.get(spec.name))
    if spec.transform == "log1p":
        return math.log1p(max(value, 0.0))
    return value


def safe_float(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def fit_normalizer(matrix: Sequence[Sequence[float]]) -> Dict[str, List[float]]:
    if not matrix:
        return {"means": [], "scales": []}
    column_count = len(matrix[0])
    means: List[float] = []
    scales: List[float] = []
    for index in range(column_count):
        values = [row[index] for row in matrix]
        mean = sum(values) / len(values)
        variance = sum((value - mean) ** 2 for value in values) / len(values)
        scale = math.sqrt(variance)
        means.append(mean)
        scales.append(scale if scale > 1e-12 else 1.0)
    return {"means": means, "scales": scales}


def apply_normalizer(
    matrix: Sequence[Sequence[float]], normalizer: Dict[str, List[float]]
) -> List[List[float]]:
    means = normalizer["means"]
    scales = normalizer["scales"]
    return [[(value - means[index]) / scales[index] for index, value in enumerate(row)] for row in matrix]


def fit_logistic_regression(
    matrix: Sequence[Sequence[float]],
    labels: Sequence[int],
    epochs: int,
    learning_rate: float,
    l2: float,
    class_balance: bool,
) -> Dict[str, Any]:
    if not matrix:
        raise ValueError("training matrix is empty")
    positive_count = sum(labels)
    negative_count = len(labels) - positive_count
    if positive_count == 0 or negative_count == 0:
        raise ValueError("training split must contain both positive and negative labels")

    feature_count = len(matrix[0])
    weights = [0.0] * feature_count
    positive_rate = positive_count / len(labels)
    intercept = logit(positive_rate)
    sample_weights = class_weights(labels) if class_balance else [1.0] * len(labels)
    total_weight = sum(sample_weights)
    loss = 0.0

    for _ in range(epochs):
        grad_weights = [0.0] * feature_count
        grad_intercept = 0.0
        loss = 0.0
        for values, label, sample_weight in zip(matrix, labels, sample_weights):
            probability = sigmoid(intercept + dot(weights, values))
            error = (probability - label) * sample_weight
            grad_intercept += error
            for index, value in enumerate(values):
                grad_weights[index] += error * value
            loss += sample_weight * log_loss(label, probability)

        intercept -= learning_rate * (grad_intercept / total_weight)
        for index in range(feature_count):
            gradient = grad_weights[index] / total_weight + l2 * weights[index]
            weights[index] -= learning_rate * gradient

    loss = loss / total_weight + 0.5 * l2 * sum(weight * weight for weight in weights)
    return {
        "weights": weights,
        "intercept": intercept,
        "loss": round(loss, 8),
    }


def class_weights(labels: Sequence[int]) -> List[float]:
    positive_count = sum(labels)
    negative_count = len(labels) - positive_count
    positive_weight = len(labels) / (2 * positive_count)
    negative_weight = len(labels) / (2 * negative_count)
    return [positive_weight if label else negative_weight for label in labels]


def sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-value)
        return 1 / (1 + z)
    z = math.exp(value)
    return z / (1 + z)


def logit(value: float) -> float:
    value = min(max(value, 1e-6), 1 - 1e-6)
    return math.log(value / (1 - value))


def log_loss(label: int, probability: float) -> float:
    probability = min(max(probability, 1e-12), 1 - 1e-12)
    return -(label * math.log(probability) + (1 - label) * math.log(1 - probability))


def dot(weights: Sequence[float], values: Sequence[float]) -> float:
    return sum(weight * value for weight, value in zip(weights, values))


def apply_logistic_model(
    rows: Sequence[Dict[str, Any]],
    fit: Dict[str, Any],
    normalizer: Dict[str, List[float]],
    specs: Sequence[FeatureSpec],
    percentile_mode: str = "as_of",
) -> List[Dict[str, Any]]:
    raw_matrix = raw_feature_matrix(rows, specs)
    matrix = apply_normalizer(raw_matrix, normalizer)
    probabilities = [
        sigmoid(fit["intercept"] + dot(fit["weights"], values))
        for values in matrix
    ]
    percentiles_by_repo = percentile_values_for_rows(rows, probabilities, percentile_mode)
    modeled_rows: List[Dict[str, Any]] = []
    for row, probability, percentile in zip(rows, probabilities, percentiles_by_repo):
        modeled = dict(row)
        modeled["prediction"] = dict(row.get("prediction") or {})
        modeled["prediction"]["logistic_probability"] = round(probability, 6)
        modeled["prediction"]["logistic_percentile_repo"] = round(percentile, 3)
        modeled["prediction"]["logistic_percentile_mode"] = percentile_mode
        modeled["prediction"]["logistic_risk_label"] = risk_label_for_percentile(percentile)
        modeled_rows.append(modeled)
    return modeled_rows


def risk_label_for_percentile(percentile: float) -> str:
    if percentile >= 90:
        return "high"
    if percentile >= 70:
        return "medium"
    return "low"


def apply_serialized_logistic_model(
    rows: Sequence[Dict[str, Any]], model: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Apply a saved logistic model artifact to feature rows."""

    percentile_mode = model.get("percentile_mode", "as_of")
    scored_rows = score_feature_rows(rows, percentile_mode=percentile_mode)
    probabilities: List[float] = []
    for row in scored_rows:
        score = float(model["intercept"])
        for feature in model["features"]:
            raw_value = serialized_feature_value(row, feature)
            scale = float(feature.get("scale") or 1.0)
            normalized = (raw_value - float(feature.get("mean") or 0.0)) / scale
            score += float(feature["weight"]) * normalized
        probabilities.append(sigmoid(score))

    percentiles = percentile_values_for_rows(scored_rows, probabilities, percentile_mode)
    modeled_rows: List[Dict[str, Any]] = []
    for row, probability, percentile in zip(scored_rows, probabilities, percentiles):
        modeled = dict(row)
        modeled["prediction"] = dict(row.get("prediction") or {})
        modeled["prediction"]["logistic_probability"] = round(probability, 6)
        modeled["prediction"]["logistic_percentile_repo"] = round(percentile, 3)
        modeled["prediction"]["logistic_percentile_mode"] = percentile_mode
        modeled["prediction"]["logistic_risk_label"] = risk_label_for_percentile(percentile)
        modeled["prediction"]["logistic_outcome_name"] = model.get("outcome_name")
        modeled["prediction"]["logistic_feature_set"] = model.get("feature_set")
        modeled_rows.append(modeled)
    return modeled_rows


def serialized_feature_value(row: Dict[str, Any], feature: Dict[str, Any]) -> float:
    features = row.get("prediction_features") or {}
    transform = feature.get("transform")
    source_feature = feature.get("source_feature") or infer_source_feature(feature)
    if transform == "category":
        category_value = feature.get("category_value")
        if category_value is None and source_feature and feature.get("feature", "").startswith(
            f"{source_feature}_"
        ):
            category_value = feature["feature"][len(source_feature) + 1 :]
        return 1.0 if features.get(source_feature) == category_value else 0.0
    if transform == "bool":
        return 1.0 if features.get(source_feature) else 0.0
    value = safe_float(features.get(source_feature))
    if transform == "log1p":
        return math.log1p(max(value, 0.0))
    return value


def infer_source_feature(feature: Dict[str, Any]) -> str:
    name = feature.get("feature") or ""
    if feature.get("transform") == "category" and name.startswith("source_type_"):
        return "source_type"
    return name


def percentile_by_repo(rows: Sequence[Dict[str, Any]], values: Sequence[float]) -> List[float]:
    by_repo: Dict[str, List[float]] = {}
    for row, value in zip(rows, values):
        by_repo.setdefault(row.get("repo") or "", []).append(value)
    sorted_by_repo = {repo: sorted(repo_values) for repo, repo_values in by_repo.items()}
    return [
        percentile_rank(value, sorted_by_repo[row.get("repo") or ""])
        for row, value in zip(rows, values)
    ]


def percentile_rank(value: float, sorted_values: Sequence[float]) -> float:
    below_or_equal = 0
    for item in sorted_values:
        if item <= value:
            below_or_equal += 1
        else:
            break
    return 100 * below_or_equal / len(sorted_values) if sorted_values else 0.0


def serialize_weights(
    weights: Sequence[float],
    normalizer: Dict[str, List[float]],
    specs: Sequence[FeatureSpec],
) -> List[Dict[str, Any]]:
    return [
        {
            "feature": spec.output_name,
            "source_feature": spec.name,
            "category_value": spec.category_value,
            "weight": round(weight, 8),
            "transform": spec.transform,
            "mean": round(normalizer["means"][index], 8),
            "scale": round(normalizer["scales"][index], 8),
        }
        for index, (spec, weight) in enumerate(zip(specs, weights))
    ]


def row_key(row: Dict[str, Any]) -> Tuple[str, int]:
    return (row.get("repo") or "", int(row.get("number") or 0))


def row_keys(rows: Sequence[Dict[str, Any]]) -> set[Tuple[str, int]]:
    return {row_key(row) for row in rows}


def logistic_markdown_report(result: Dict[str, Any]) -> str:
    model = result["model"]
    lines = [
        "# Logistic Regression Baseline",
        "",
        f"- Outcome: `{model['outcome_name']}`",
        f"- Feature set: `{model.get('feature_set', 'legacy')}`",
        (
            f"- Split: {model['split']} "
            f"{model['train_fraction']:.0%} train / "
            f"{model.get('validation_fraction', 0):.0%} validation / "
            f"{model.get('test_fraction', 1 - model['train_fraction']):.0%} test"
        ),
        f"- Percentile mode: `{model.get('percentile_mode', 'global')}`",
        f"- Class balance: {model['class_balance']}",
        (
            f"- Maturity window: {model.get('maturity_days', 0)} days "
            f"({model.get('maturity_excluded_rows', 0)} newest rows excluded)"
        ),
        f"- Train rows: {model['train']['rows']} ({model['train']['positive_outcomes']} positives)",
        f"- Validation rows: {model.get('validation', {}).get('rows', 0)} ({model.get('validation', {}).get('positive_outcomes', 0)} positives)",
        f"- Test rows: {model['test']['rows']} ({model['test']['positive_outcomes']} positives)",
        f"- L2: {model['l2']}",
        f"- Epochs: {model['epochs']}",
        "",
        "## Validation Evaluation",
        "",
        markdown_report(result["validation_evaluation"]),
        "",
        "## Test Evaluation",
        "",
        markdown_report(result["test_evaluation"]),
        "",
        "## All Evaluated Rows",
        "",
        markdown_report(result["all_evaluation"]),
        "",
        "## Largest Positive Weights",
        "",
        "| Feature | Weight | Transform |",
        "| --- | ---: | --- |",
    ]
    for feature in sorted(model["features"], key=lambda item: item["weight"], reverse=True)[:15]:
        lines.append(f"| `{feature['feature']}` | {feature['weight']:.4f} | {feature['transform']} |")
    lines.extend(
        [
            "",
            "## Largest Negative Weights",
            "",
            "| Feature | Weight | Transform |",
            "| --- | ---: | --- |",
        ]
    )
    for feature in sorted(model["features"], key=lambda item: item["weight"])[:15]:
        lines.append(f"| `{feature['feature']}` | {feature['weight']:.4f} | {feature['transform']} |")
    lines.append("")
    return "\n".join(lines)
