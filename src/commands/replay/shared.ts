/**
 * Shared helpers for replay commands.
 */

import { getReplay, getReplayRecordingSegments } from "../../lib/api-client.js";
import { ApiError, ResolutionError } from "../../lib/errors.js";
import { withProgress } from "../../lib/polling.js";
import type {
  ReplayDetails,
  ReplayRecordingSegments,
} from "../../types/index.js";

type ReplayProjectScopeValidation = {
  replay: ReplayDetails;
  projectId?: string;
  replayId: string;
  org: string;
  project?: string;
  command: string;
};

type ReplaySegmentsOptions = {
  org: string;
  replay: ReplayDetails;
  replayId: string;
  project?: string;
  json: boolean;
};

export async function fetchReplayDetailsForCommand(
  org: string,
  replayId: string,
  command: string
): Promise<ReplayDetails> {
  try {
    return await getReplay(org, replayId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ResolutionError(
        `Replay '${replayId}'`,
        "not found",
        `${command} ${org}/${replayId}`,
        [
          "Check that you are querying the right organization",
          "The replay may be past your retention window",
        ]
      );
    }
    throw error;
  }
}

export function validateReplayProjectScope({
  replay,
  projectId,
  replayId,
  org,
  project,
  command,
}: ReplayProjectScopeValidation): void {
  if (project === undefined || projectId === undefined) {
    return;
  }

  const replayProjectId = replay.project_id;
  if (replayProjectId === null || replayProjectId === undefined) {
    return;
  }

  if (String(projectId) !== String(replayProjectId)) {
    throw new ResolutionError(
      `Replay '${replayId}'`,
      `is not in project '${project}'`,
      `${command} ${org}/${project}/${replayId}`,
      [`Open the org-scoped replay instead: ${command} ${org}/${replayId}`]
    );
  }
}

export async function fetchReplaySegmentsForCommand({
  org,
  replay,
  replayId,
  project,
  json,
}: ReplaySegmentsOptions): Promise<ReplayRecordingSegments> {
  const projectSlugOrId =
    replay.project_id !== null && replay.project_id !== undefined
      ? String(replay.project_id)
      : project;

  if (
    !projectSlugOrId ||
    replay.is_archived ||
    (replay.count_segments ?? 0) <= 0
  ) {
    return [];
  }

  return await withProgress(
    {
      message: `Fetching replay recording segments (${replay.count_segments})...`,
      json,
    },
    () =>
      getReplayRecordingSegments(org, projectSlugOrId, replayId, {
        expectedSegments: replay.count_segments,
      })
  );
}
