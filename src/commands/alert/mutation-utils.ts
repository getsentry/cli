import { ValidationError } from "../../lib/errors.js";

const ISSUE_MATCH_MODES = new Set(["all", "any"]);
const METRIC_DATASET_VALUES = new Set([
  "errors",
  "transactions",
  "sessions",
  "events",
  "spans",
  "metrics",
]);
const METRIC_TIME_WINDOWS = new Set([
  1, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440,
]);

export function parseMatchMode(
  value: string | undefined,
  field: "action-match" | "filter-match"
): "all" | "any" | undefined {
  if (value === undefined || value === "") {
    return;
  }
  const normalized = value.trim().toLowerCase();
  if (ISSUE_MATCH_MODES.has(normalized)) {
    return normalized as "all" | "any";
  }
  throw new ValidationError(
    `${field} must be 'all' or 'any' (got ${JSON.stringify(value)}).`,
    field
  );
}

export function parseStatusFlag(
  value: string | undefined
): "active" | "disabled" | undefined {
  if (value === undefined || value === "") {
    return;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "active" || normalized === "disabled") {
    return normalized;
  }
  throw new ValidationError(
    `Status must be 'active' or 'disabled' (got ${JSON.stringify(value)}).`,
    "status"
  );
}

function parseJsonValue(raw: string, field: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError(
      `${field} must be valid JSON (got ${JSON.stringify(raw)}).`,
      field
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toObject(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ValidationError(`${field} entries must be JSON objects.`, field);
  }
  return value;
}

export function parseJsonObjectList(
  values: readonly string[] | undefined,
  field: string
): Record<string, unknown>[] | undefined {
  if (!values || values.length === 0) {
    return;
  }

  if (values.length === 1) {
    const onlyValue = values[0];
    if (onlyValue === undefined) {
      return;
    }
    const parsed = parseJsonValue(onlyValue, field);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => toObject(entry, field));
    }
    return [toObject(parsed, field)];
  }

  return values.map((value) => toObject(parseJsonValue(value, field), field));
}

export function validateIssueRuleArrays(
  conditions: readonly Record<string, unknown>[] | undefined,
  actions: readonly Record<string, unknown>[] | undefined,
  field: "conditions" | "actions"
): void {
  if (field === "conditions") {
    if (!conditions || conditions.length === 0) {
      throw new ValidationError(
        "Pass at least one --condition JSON object.",
        "condition"
      );
    }
    return;
  }

  if (!actions || actions.length === 0) {
    throw new ValidationError(
      "Pass at least one --action JSON object.",
      "action"
    );
  }
}

export function normalizeProjectList(
  projects: readonly string[] | undefined
): string[] | undefined {
  if (!projects || projects.length === 0) {
    return;
  }

  const values = projects
    .flatMap((project) => project.split(","))
    .map((project) => project.trim())
    .filter((project) => project.length > 0);
  return values.length > 0 ? values : undefined;
}

export function validateMetricDataset(dataset: string): void {
  const normalized = dataset.trim().toLowerCase();
  if (METRIC_DATASET_VALUES.has(normalized)) {
    return;
  }
  throw new ValidationError(
    `dataset must be one of: ${[...METRIC_DATASET_VALUES].join(", ")}.`,
    "dataset"
  );
}

export function validateMetricTimeWindow(timeWindow: number): void {
  if (METRIC_TIME_WINDOWS.has(timeWindow)) {
    return;
  }
  throw new ValidationError(
    `timeWindow must be one of: ${[...METRIC_TIME_WINDOWS].join(", ")} minutes.`,
    "timeWindow"
  );
}

export function validateMetricTriggers(
  triggers: readonly Record<string, unknown>[] | undefined
): void {
  if (!triggers || triggers.length === 0) {
    throw new ValidationError(
      "Pass at least one --trigger JSON object.",
      "trigger"
    );
  }

  for (const trigger of triggers) {
    const threshold = trigger.alertThreshold;
    if (typeof threshold !== "number" && typeof threshold !== "string") {
      throw new ValidationError(
        "Each trigger must include alertThreshold.",
        "trigger"
      );
    }
    const actions = trigger.actions;
    if (!Array.isArray(actions) || actions.length === 0) {
      throw new ValidationError(
        "Each trigger must include a non-empty actions array.",
        "trigger"
      );
    }
  }
}

export function statusToMetricValue(status: "active" | "disabled"): 0 | 1 {
  return status === "active" ? 0 : 1;
}
