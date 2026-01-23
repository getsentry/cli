/**
 * Autofix API Types
 *
 * Zod schemas and TypeScript types for Sentry's Seer Autofix API.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Status Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Possible autofix run statuses */
export const AUTOFIX_STATUSES = [
  "PROCESSING",
  "COMPLETED",
  "ERROR",
  "CANCELLED",
  "NEED_MORE_INFORMATION",
  "WAITING_FOR_USER_RESPONSE",
] as const;

export type AutofixStatus = (typeof AUTOFIX_STATUSES)[number];

/** Terminal statuses that indicate the run has finished */
export const TERMINAL_STATUSES: AutofixStatus[] = [
  "COMPLETED",
  "ERROR",
  "CANCELLED",
];

/** Stopping point values for autofix runs */
export const STOPPING_POINTS = [
  "root_cause",
  "solution",
  "code_changes",
  "open_pr",
] as const;

export type StoppingPoint = (typeof STOPPING_POINTS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Progress Message
// ─────────────────────────────────────────────────────────────────────────────

export const ProgressMessageSchema = z.object({
  message: z.string(),
  timestamp: z.string(),
  type: z.string().optional(),
});

export type ProgressMessage = z.infer<typeof ProgressMessageSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Relevant Code File
// ─────────────────────────────────────────────────────────────────────────────

export const RelevantCodeFileSchema = z.object({
  file_path: z.string(),
  repo_name: z.string(),
});

export type RelevantCodeFile = z.infer<typeof RelevantCodeFileSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Reproduction Step
// ─────────────────────────────────────────────────────────────────────────────

export const ReproductionStepSchema = z.object({
  title: z.string(),
  code_snippet_and_analysis: z.string(),
  is_most_important_event: z.boolean().optional(),
  relevant_code_file: RelevantCodeFileSchema.optional(),
  timeline_item_type: z.string().optional(),
});

export type ReproductionStep = z.infer<typeof ReproductionStepSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Root Cause
// ─────────────────────────────────────────────────────────────────────────────

export const RootCauseSchema = z.object({
  id: z.number(),
  description: z.string(),
  relevant_repos: z.array(z.string()).optional(),
  reproduction_urls: z.array(z.string()).optional(),
  root_cause_reproduction: z.array(ReproductionStepSchema).optional(),
});

export type RootCause = z.infer<typeof RootCauseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Root Cause Selection
// ─────────────────────────────────────────────────────────────────────────────

export const RootCauseSelectionSchema = z.object({
  cause_id: z.number(),
  instruction: z.string().nullable().optional(),
});

export type RootCauseSelection = z.infer<typeof RootCauseSelectionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Autofix Step
// ─────────────────────────────────────────────────────────────────────────────

export const AutofixStepSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    status: z.string(),
    title: z.string(),
    progress: z.array(ProgressMessageSchema).optional(),
    causes: z.array(RootCauseSchema).optional(),
    selection: RootCauseSelectionSchema.optional(),
  })
  .passthrough(); // Allow additional fields like artifacts

export type AutofixStep = z.infer<typeof AutofixStepSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Repository Info
// ─────────────────────────────────────────────────────────────────────────────

export const RepositoryInfoSchema = z.object({
  integration_id: z.number().optional(),
  url: z.string().optional(),
  external_id: z.string(),
  name: z.string(),
  provider: z.string().optional(),
  default_branch: z.string().optional(),
  is_readable: z.boolean().optional(),
  is_writeable: z.boolean().optional(),
});

export type RepositoryInfo = z.infer<typeof RepositoryInfoSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Codebase Info
// ─────────────────────────────────────────────────────────────────────────────

export const CodebaseInfoSchema = z.object({
  repo_external_id: z.string(),
  file_changes: z.array(z.unknown()).optional(),
  is_readable: z.boolean().optional(),
  is_writeable: z.boolean().optional(),
});

export type CodebaseInfo = z.infer<typeof CodebaseInfoSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PR Info (from completed fix)
// ─────────────────────────────────────────────────────────────────────────────

export const PullRequestInfoSchema = z.object({
  pr_number: z.number().optional(),
  pr_url: z.string().optional(),
  repo_name: z.string().optional(),
});

export type PullRequestInfo = z.infer<typeof PullRequestInfoSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Solution Artifact (from fix command)
// ─────────────────────────────────────────────────────────────────────────────

/** A single step in the solution plan */
export const SolutionStepSchema = z.object({
  title: z.string(),
  description: z.string(),
});

export type SolutionStep = z.infer<typeof SolutionStepSchema>;

/** Solution data containing the plan to fix the issue */
export const SolutionDataSchema = z.object({
  one_line_summary: z.string(),
  steps: z.array(SolutionStepSchema),
});

export type SolutionData = z.infer<typeof SolutionDataSchema>;

/** Solution artifact from the autofix response */
export const SolutionArtifactSchema = z.object({
  key: z.literal("solution"),
  data: SolutionDataSchema,
  reason: z.string().optional(),
});

export type SolutionArtifact = z.infer<typeof SolutionArtifactSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Autofix State
// ─────────────────────────────────────────────────────────────────────────────

export const AutofixStateSchema = z
  .object({
    run_id: z.number(),
    status: z.string(),
    updated_at: z.string().optional(),
    request: z
      .object({
        organization_id: z.number().optional(),
        project_id: z.number().optional(),
        repos: z.array(z.unknown()).optional(),
      })
      .optional(),
    codebases: z.record(z.string(), CodebaseInfoSchema).optional(),
    steps: z.array(AutofixStepSchema).optional(),
    repositories: z.array(RepositoryInfoSchema).optional(),
    coding_agents: z.record(z.string(), z.unknown()).optional(),
    created_at: z.string().optional(),
    completed_at: z.string().optional(),
  })
  .passthrough(); // Allow additional fields like blocks

export type AutofixState = z.infer<typeof AutofixStateSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Autofix Response (GET /issues/{id}/autofix/)
// ─────────────────────────────────────────────────────────────────────────────

export const AutofixResponseSchema = z.object({
  autofix: AutofixStateSchema.nullable(),
});

export type AutofixResponse = z.infer<typeof AutofixResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Update Payloads
// ─────────────────────────────────────────────────────────────────────────────

export const SelectRootCausePayloadSchema = z.object({
  type: z.literal("select_root_cause"),
  cause_id: z.number(),
  stopping_point: z.enum(["solution", "code_changes", "open_pr"]).optional(),
});

export type SelectRootCausePayload = z.infer<
  typeof SelectRootCausePayloadSchema
>;

export const SelectSolutionPayloadSchema = z.object({
  type: z.literal("select_solution"),
});

export type SelectSolutionPayload = z.infer<typeof SelectSolutionPayloadSchema>;

export const CreatePrPayloadSchema = z.object({
  type: z.literal("create_pr"),
});

export type CreatePrPayload = z.infer<typeof CreatePrPayloadSchema>;

export type AutofixUpdatePayload =
  | SelectRootCausePayload
  | SelectSolutionPayload
  | CreatePrPayload;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an autofix status is terminal (no more updates expected)
 */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as AutofixStatus);
}

/**
 * Extract root causes from autofix steps
 */
export function extractRootCauses(state: AutofixState): RootCause[] {
  if (!state.steps) {
    return [];
  }

  for (const step of state.steps) {
    if (step.key === "root_cause_analysis" && step.causes) {
      return step.causes;
    }
  }

  return [];
}

/** Artifact structure used in blocks and steps */
type ArtifactEntry = { key: string; data: unknown; reason?: string };

/** Structure that may contain artifacts */
type WithArtifacts = { artifacts?: ArtifactEntry[] };

/**
 * Search artifacts array for a solution artifact.
 */
function findSolutionInArtifacts(
  artifacts: ArtifactEntry[]
): SolutionArtifact | null {
  for (const artifact of artifacts) {
    if (artifact.key === "solution") {
      const result = SolutionArtifactSchema.safeParse(artifact);
      if (result.success) {
        return result.data;
      }
    }
  }
  return null;
}

/**
 * Search an array of containers (blocks or steps) for a solution artifact.
 */
function searchContainersForSolution(
  containers: WithArtifacts[]
): SolutionArtifact | null {
  for (const container of containers) {
    if (container.artifacts) {
      const solution = findSolutionInArtifacts(container.artifacts);
      if (solution) {
        return solution;
      }
    }
  }
  return null;
}

/**
 * Extract solution artifact from autofix state.
 * Searches through both blocks and steps for the solution artifact.
 *
 * @param state - Autofix state (may contain blocks or steps with artifacts)
 * @returns SolutionArtifact if found, null otherwise
 */
export function extractSolution(state: AutofixState): SolutionArtifact | null {
  // Access blocks and steps from passthrough fields
  const stateWithExtras = state as AutofixState & {
    blocks?: WithArtifacts[];
    steps?: WithArtifacts[];
  };

  // Search in blocks first (explorer mode / newer API)
  if (stateWithExtras.blocks) {
    const solution = searchContainersForSolution(stateWithExtras.blocks);
    if (solution) {
      return solution;
    }
  }

  // Search in steps (regular autofix API)
  if (stateWithExtras.steps) {
    const solution = searchContainersForSolution(stateWithExtras.steps);
    if (solution) {
      return solution;
    }
  }

  return null;
}
