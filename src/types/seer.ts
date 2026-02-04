/**
 * Seer API Types
 *
 * Types for Sentry's Seer Autofix API.
 * Only SolutionArtifactSchema is used for runtime validation (in extractSolution).
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

export type ProgressMessage = {
  message: string;
  timestamp: string;
  type?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Relevant Code File
// ─────────────────────────────────────────────────────────────────────────────

export type RelevantCodeFile = {
  file_path: string;
  repo_name: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Reproduction Step
// ─────────────────────────────────────────────────────────────────────────────

export type ReproductionStep = {
  title: string;
  code_snippet_and_analysis: string;
  is_most_important_event?: boolean;
  relevant_code_file?: RelevantCodeFile;
  timeline_item_type?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Root Cause
// ─────────────────────────────────────────────────────────────────────────────

export type RootCause = {
  id: number;
  description: string;
  relevant_repos?: string[];
  reproduction_urls?: string[];
  root_cause_reproduction?: ReproductionStep[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Root Cause Selection
// ─────────────────────────────────────────────────────────────────────────────

export type RootCauseSelection = {
  cause_id: number;
  instruction?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Autofix Step
// ─────────────────────────────────────────────────────────────────────────────

export type AutofixStep = {
  id: string;
  key: string;
  status: string;
  title: string;
  progress?: ProgressMessage[];
  causes?: RootCause[];
  selection?: RootCauseSelection;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Repository Info
// ─────────────────────────────────────────────────────────────────────────────

export type RepositoryInfo = {
  integration_id?: number;
  url?: string;
  external_id: string;
  name: string;
  provider?: string;
  default_branch?: string;
  is_readable?: boolean;
  is_writeable?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Codebase Info
// ─────────────────────────────────────────────────────────────────────────────

export type CodebaseInfo = {
  repo_external_id: string;
  file_changes?: unknown[];
  is_readable?: boolean;
  is_writeable?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// PR Info (from completed fix)
// ─────────────────────────────────────────────────────────────────────────────

export type PullRequestInfo = {
  pr_number?: number;
  pr_url?: string;
  repo_name?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Solution Artifact (from plan command)
// Used for runtime validation in extractSolution()
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

export type AutofixState = {
  run_id: number;
  status: string;
  updated_at?: string;
  request?: {
    organization_id?: number;
    project_id?: number;
    repos?: unknown[];
  };
  codebases?: Record<string, CodebaseInfo>;
  steps?: AutofixStep[];
  repositories?: RepositoryInfo[];
  coding_agents?: Record<string, unknown>;
  created_at?: string;
  completed_at?: string;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Autofix Response (GET /issues/{id}/autofix/)
// ─────────────────────────────────────────────────────────────────────────────

export type AutofixResponse = {
  autofix: AutofixState | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Update Payloads
// ─────────────────────────────────────────────────────────────────────────────

export type SelectRootCausePayload = {
  type: "select_root_cause";
  cause_id: number;
  stopping_point?: "solution" | "code_changes" | "open_pr";
};

export type SelectSolutionPayload = {
  type: "select_solution";
};

export type CreatePrPayload = {
  type: "create_pr";
};

export type AutofixUpdatePayload =
  | SelectRootCausePayload
  | SelectSolutionPayload
  | CreatePrPayload;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an autofix status is terminal (no more updates expected).
 *
 * @param status - The status string to check
 * @returns True if the status indicates completion (COMPLETED, ERROR, CANCELLED)
 */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as AutofixStatus);
}

/**
 * Extract root causes from autofix state steps.
 *
 * @param state - The autofix state containing analysis steps
 * @returns Array of root causes, or empty array if none found
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
