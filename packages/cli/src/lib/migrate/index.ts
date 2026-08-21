// biome-ignore-all lint/performance/noBarrelFile: intentional public API
/**
 * Sentry SDK migration engine.
 *
 * Public surface for the `sentry migrate` command and for tests. See
 * `framework.ts` for what a migration and a task are.
 */

export type { FileFilter, TaskApi, Workspace } from "./api.js";
export { createApi, createWorkspace, finalizeWorkspace } from "./api.js";
export {
  collect,
  findSentryInitOptions,
  JS_EXTENSIONS,
  parseSource,
} from "./ast.js";
export type { CheckTaskOptions } from "./check-task.js";
export { defineCheckTask } from "./check-task.js";
export { annotator, applyEdits } from "./edits.js";
export type {
  Migration,
  MigrationFit,
  MigrationTask,
  ProjectProbe,
  TaskWithOptions,
} from "./framework.js";
export {
  collectTasks,
  defineMigration,
  defineMigrationTask,
} from "./framework.js";
export { createProbe } from "./probe.js";
export type { FileChange, MigrationResult, RunOptions } from "./run.js";
export { applyMigration, planMigration } from "./run.js";
export {
  describeMigrations,
  MIGRATIONS,
  NoMigrationError,
  selectMigration,
} from "./select.js";
export type { Edit, Finding } from "./types.js";
