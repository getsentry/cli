/**
 * Core types for the migration engine.
 *
 * The engine is a set of pure tasks over source text. A task never writes to
 * disk and never reads anything outside the `TaskApi` it is handed, so every
 * task is testable as "files in, files out" against a fixture.
 */

/** A single textual replacement, expressed as a half-open byte range. */
export type Edit = {
  start: number;
  end: number;
  text: string;
};

/**
 * Something a task noticed. `fixed` findings are reported as a diff; `manual`
 * findings become entries in the migration's report.
 */
export type Finding = {
  /** Id of the task that emitted it, which is how the report groups entries. */
  taskId: string;
  kind: "fixed" | "manual";
  file: string;
  /** 1-indexed. */
  line: number;
  message: string;
};

/** A finding as a task emits it. The runner stamps the task id on. */
export type RawFinding = Omit<Finding, "taskId" | "file">;
