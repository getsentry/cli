/**
 * Two renderers over one source of truth.
 *
 * Human text and the JSON contract are both functions of `CheckResult[]`, so
 * there is no display logic that can drift from machine output — and no
 * display decision can change what a machine consumer receives.
 */

import { detectAgent } from "../detect-agent.js";
import { colorTag, renderMarkdown } from "../formatters/markdown.js";
import { safeFilePath } from "./redact.js";
import type {
  Capture,
  CapturedBlock,
  CheckResult,
  CheckStatus,
  ServerFacts,
} from "./types.js";

/** Bump when a consumer-visible field changes shape. */
const SCHEMA_VERSION = 1;

/** Capture as serialized: keys and cwd stay in memory, not in the report. */
type PublicCapture = Omit<Capture, "cwd" | "initSites" | "buildConfigs"> & {
  initSites: Omit<CapturedBlock, "keys">[];
  buildConfigs: Omit<CapturedBlock, "keys">[];
};

export type DoctorReport = {
  schema_version: number;
  cli_version: string;
  timestamp: string;
  /** On the report, not a render argument, so `human` stays a pure function. */
  elapsed_ms: number;
  capture: PublicCapture;
  server: ServerFacts;
  results: CheckResult[];
};

function withoutKeys({ keys: _keys, ...rest }: CapturedBlock) {
  return rest;
}

/** Every result, passes included — a display decision must not change this. */
export function buildReport(args: {
  capture: Capture;
  server: ServerFacts;
  results: readonly CheckResult[];
  cliVersion: string;
  timestamp: string;
  elapsedMs: number;
}): DoctorReport {
  return {
    schema_version: SCHEMA_VERSION,
    cli_version: args.cliVersion,
    timestamp: args.timestamp,
    elapsed_ms: args.elapsedMs,
    // Keys and cwd stay on the in-memory Capture; they are not report fields.
    capture: {
      ecosystems: args.capture.ecosystems,
      dsns: args.capture.dsns,
      initSites: args.capture.initSites.map(withoutKeys),
      buildConfigs: args.capture.buildConfigs.map(withoutKeys),
      manifests: args.capture.manifests,
      incomplete: args.capture.incomplete,
    },
    server: args.server,
    results: [...args.results],
  };
}

function byStatus(
  results: readonly CheckResult[],
  status: CheckStatus
): CheckResult[] {
  return results.filter((r) => r.status === status);
}

/** Warnings never fail the run; there is no `--strict`. */
export function exitCodeFor(results: readonly CheckResult[]): 0 | 1 {
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

/**
 * The one-line conclusion. "2 failed" does not tell you whether Sentry works;
 * "configured but has never received an event" does. Counts live in the footer,
 * where they answer a different question.
 */
export function verdictFor(results: readonly CheckResult[]): string {
  const failures = byStatus(results, "fail");
  if (failures.length === 0) {
    const warnings = byStatus(results, "warn").length;
    return warnings > 0
      ? "Sentry looks healthy, with some configuration worth reviewing."
      : "Sentry looks healthy.";
  }

  const byId = new Map(failures.map((f) => [f.id, f]));
  if (byId.has("dsn.present")) {
    return "Sentry is not configured in this project.";
  }
  if (byId.has("dsn.placeholder") || byId.has("dsn.resolves")) {
    return "Sentry's DSN does not point at a project you can send events to.";
  }
  if (byId.has("project.key_active")) {
    return "Sentry is configured but its key is no longer accepting events.";
  }
  if (byId.has("project.first_event")) {
    return "Sentry is configured but has never received an event.";
  }
  if (byId.has("init.present")) {
    return "Sentry is installed but never initialized.";
  }
  const first = failures[0];
  return first ? first.detail : "Sentry has problems worth fixing.";
}

/** One numbered instruction per unique remediation, safe to hand to a coding agent. */
export function fixBlock(results: readonly CheckResult[]): string[] {
  const seen = new Set<string>();
  return byStatus(results, "fail").flatMap((r) => {
    if (!r.remediation) {
      return [];
    }
    const where = (r.evidence ?? [])
      .map((e) => {
        const file = safeFilePath(e.file) ?? "[invalid path]";
        return e.line === undefined ? file : `${file}:${e.line}`;
      })
      .join(", ");
    const line = where ? `${r.remediation} (${where})` : r.remediation;
    if (seen.has(line)) {
      return [];
    }
    seen.add(line);
    return [line];
  });
}

const GLYPHS: Record<CheckStatus, { plain: string; color: string }> = {
  pass: { plain: "✓", color: "green" },
  fail: { plain: "✗", color: "red" },
  warn: { plain: "⚠", color: "yellow" },
  // No existing precedent in the repo for a skip glyph; `-` reads as "not run".
  skip: { plain: "-", color: "muted" },
};

const ID_COLUMN = 22;

function renderRow(result: CheckResult, plain: boolean): string[] {
  const glyph = GLYPHS[result.status];
  const mark = plain ? glyph.plain : colorTag(glyph.color, glyph.plain);
  // padEnd alone is a no-op once an id reaches ID_COLUMN, so glue a space first.
  const id = `${result.id} `.padEnd(ID_COLUMN);
  const lines = [`  ${mark} ${id}${result.detail}`];

  for (const e of result.evidence ?? []) {
    const at = e.line === undefined ? e.file : `${e.file}:${e.line}`;
    lines.push(`  ${" ".repeat(ID_COLUMN + 2)}${at}`);
  }
  return lines;
}

function section(
  title: string,
  results: readonly CheckResult[],
  plain: boolean
): string[] {
  if (results.length === 0) {
    return [];
  }
  return [
    "",
    `### ${title}`,
    "",
    ...results.flatMap((r) => renderRow(r, plain)),
  ];
}

/**
 * `plain` drops color and glyph decoration. Callers set it inside an agent —
 * the same decision as the init banner suppression at wizard-runner.ts:608,
 * where decoration "wastes tokens and adds noise to structured output without
 * value to the agent."
 */
export function renderHuman(args: {
  results: readonly CheckResult[];
  elapsedMs: number;
  plain?: boolean;
}): string {
  const { results, elapsedMs } = args;
  const plain = args.plain ?? false;

  const passes = byStatus(results, "pass");
  const failures = byStatus(results, "fail");
  const warnings = byStatus(results, "warn");
  const skips = byStatus(results, "skip");

  const verdictGlyph = GLYPHS[failures.length > 0 ? "fail" : "pass"];
  const mark = plain
    ? verdictGlyph.plain
    : colorTag(verdictGlyph.color, verdictGlyph.plain);

  const lines: string[] = [
    "# 💊 Sentry Doctor",
    "",
    `${mark} ${verdictFor(results)}`,
    ...section("Failures", failures, plain),
    ...section("Warnings", warnings, plain),
    ...section("Passed", passes, plain),
    // Skips sort last so they stay visible without competing with failures.
    ...section("Skipped", skips, plain),
  ];

  const fixes = fixBlock(results);
  if (fixes.length > 0) {
    lines.push("", "### Fix", "");
    fixes.forEach((fix, i) => {
      lines.push(`  ${i + 1}. ${fix}`);
    });
  }

  const counts = [
    `${passes.length} passed`,
    failures.length > 0 ? `${failures.length} failed` : "",
    warnings.length > 0 ? `${warnings.length} warnings` : "",
    skips.length > 0 ? `${skips.length} skipped` : "",
  ].filter(Boolean);

  lines.push(
    "",
    `${counts.join(" · ")}   (${(elapsedMs / 1000).toFixed(1)}s)`,
    ""
  );

  return lines.join("\n");
}

/**
 * The `output.human` formatter. Takes only the report, so the framework can
 * call it without knowing anything about how doctor ran.
 */
export function formatDoctorReport(report: DoctorReport): string {
  const plain = detectAgent() !== undefined;
  const text = renderHuman({
    results: report.results,
    elapsedMs: report.elapsed_ms,
    plain,
  });
  return plain ? text : renderMarkdown(text);
}
