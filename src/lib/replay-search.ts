import type { ReplayDetails, ReplayListItem } from "../types/index.js";

type ReplayLike = ReplayListItem | ReplayDetails;
type ReplayFieldResolver = (replay: ReplayLike) => unknown;

const REPLAY_FIELD_ALIASES = {
  count_screens: "count_urls",
  error_id: "error_ids",
  info_id: "info_ids",
  release: "releases",
  screen: "urls",
  screens: "urls",
  seen_by_me: "has_viewed",
  trace: "trace_ids",
  trace_id: "trace_ids",
  url: "urls",
  "user.ip_address": "user.ip",
  viewed_by_me: "has_viewed",
  warning_id: "warning_ids",
} as const satisfies Record<string, string>;

/** Default field set for replay rows shown in `sentry explore --dataset replays`. */
export const DEFAULT_REPLAY_EXPLORE_FIELDS = [
  "id",
  "started_at",
  "duration",
  "count_errors",
  "count_rage_clicks",
  "count_dead_clicks",
  "url",
  "user.email",
] as const;

function firstValue<T>(values: T[] | undefined): T | undefined {
  return values && values.length > 0 ? values[0] : undefined;
}

/** Return the best available human label for the replay user. */
export function getReplayUserLabel(replay: ReplayLike): string | undefined {
  const user = replay.user;
  if (!user) {
    return;
  }

  return (
    user.display_name ??
    user.username ??
    user.email ??
    user.id ??
    user.ip ??
    undefined
  );
}

const REPLAY_FIELD_RESOLVERS: Record<string, ReplayFieldResolver> = {
  activity: (replay) => replay.activity,
  browser: (replay) => replay.browser?.name,
  "browser.name": (replay) => replay.browser?.name,
  "browser.version": (replay) => replay.browser?.version,
  count_dead_clicks: (replay) => replay.count_dead_clicks,
  count_errors: (replay) => replay.count_errors,
  count_infos: (replay) => replay.count_infos,
  count_rage_clicks: (replay) => replay.count_rage_clicks,
  count_screens: (replay) => replay.count_urls,
  count_segments: (replay) => replay.count_segments,
  count_traces: (replay) => replay.trace_ids?.length,
  count_urls: (replay) => replay.count_urls,
  count_warnings: (replay) => replay.count_warnings,
  device: (replay) => replay.device?.name,
  "device.brand": (replay) => replay.device?.brand,
  "device.family": (replay) => replay.device?.family,
  "device.model": (replay) => replay.device?.model,
  "device.model_id": (replay) => replay.device?.model_id,
  "device.name": (replay) => replay.device?.name,
  dist: (replay) => replay.dist,
  duration: (replay) => replay.duration,
  environment: (replay) => replay.environment,
  error_id: (replay) => firstValue(replay.error_ids),
  error_ids: (replay) => replay.error_ids,
  finished_at: (replay) => replay.finished_at,
  has_viewed: (replay) => replay.has_viewed,
  id: (replay) => replay.id,
  info_id: (replay) => firstValue(replay.info_ids),
  info_ids: (replay) => replay.info_ids,
  is_archived: (replay) => replay.is_archived,
  os: (replay) => replay.os?.name,
  "os.name": (replay) => replay.os?.name,
  "os.version": (replay) => replay.os?.version,
  platform: (replay) => replay.platform,
  project_id: (replay) => replay.project_id,
  release: (replay) => firstValue(replay.releases),
  releases: (replay) => replay.releases,
  replay_type: (replay) => replay.replay_type,
  screen: (replay) => firstValue(replay.urls),
  screens: (replay) => replay.urls,
  sdk: (replay) => replay.sdk?.name,
  "sdk.name": (replay) => replay.sdk?.name,
  "sdk.version": (replay) => replay.sdk?.version,
  seen_by_me: (replay) => replay.has_viewed,
  started_at: (replay) => replay.started_at,
  trace: (replay) => firstValue(replay.trace_ids),
  trace_id: (replay) => firstValue(replay.trace_ids),
  trace_ids: (replay) => replay.trace_ids,
  url: (replay) => firstValue(replay.urls),
  urls: (replay) => replay.urls,
  user: (replay) => getReplayUserLabel(replay),
  "user.email": (replay) => replay.user?.email,
  "user.geo.city": (replay) => replay.user?.geo?.city,
  "user.geo.country_code": (replay) => replay.user?.geo?.country_code,
  "user.geo.region": (replay) => replay.user?.geo?.region,
  "user.geo.subdivision": (replay) => replay.user?.geo?.subdivision,
  "user.id": (replay) => replay.user?.id,
  "user.ip": (replay) => replay.user?.ip,
  "user.ip_address": (replay) => replay.user?.ip,
  "user.username": (replay) => replay.user?.username,
  viewed_by_me: (replay) => replay.has_viewed,
  warning_id: (replay) => firstValue(replay.warning_ids),
  warning_ids: (replay) => replay.warning_ids,
};

function replayRequestRoot(field: string): string {
  const normalized: string =
    REPLAY_FIELD_ALIASES[field as keyof typeof REPLAY_FIELD_ALIASES] ?? field;

  switch (normalized) {
    case "browser.name":
    case "browser.version":
      return "browser";
    case "device.brand":
    case "device.family":
    case "device.model":
    case "device.model_id":
    case "device.name":
      return "device";
    case "os.name":
    case "os.version":
      return "os";
    case "sdk.name":
    case "sdk.version":
      return "sdk";
    case "count_traces":
      return "trace_ids";
    case "user.email":
    case "user.geo.city":
    case "user.geo.country_code":
    case "user.geo.region":
    case "user.geo.subdivision":
    case "user.id":
    case "user.ip":
    case "user.username":
      return "user";
    default:
      return normalized;
  }
}

/** Return whether the CLI can render a replay field in replay search outputs. */
export function isSupportedReplayField(field: string): boolean {
  return field in REPLAY_FIELD_RESOLVERS;
}

/** List the replay fields the CLI can render in replay search outputs. */
export function listSupportedReplayFields(): string[] {
  return Object.keys(REPLAY_FIELD_RESOLVERS).sort();
}

/**
 * Map requested replay output fields to the top-level replay API fields required
 * to materialize them.
 */
export function getReplayRequestFields(fields: string[]): string[] {
  const roots = new Set<string>(["id"]);

  for (const field of fields) {
    roots.add(replayRequestRoot(field));
  }

  return [...roots];
}

/** Extract a replay field value for CLI search/display output. */
export function getReplayFieldValue(
  replay: ReplayLike,
  field: string
): unknown {
  const resolver = REPLAY_FIELD_RESOLVERS[field];
  if (!resolver) {
    throw new Error(`Unsupported replay field: ${field}`);
  }
  return resolver(replay);
}
