import { z } from "zod";

/**
 * User geo metadata attached to a replay.
 */
export const ReplayGeoSchema = z
  .object({
    city: z.string().nullish().describe("City"),
    country_code: z.string().nullish().describe("Country code"),
    region: z.string().nullish().describe("Region"),
    subdivision: z.string().nullish().describe("Subdivision"),
  })
  .passthrough();

/**
 * User metadata attached to a replay.
 */
export const ReplayUserSchema = z
  .object({
    id: z.string().nullish().describe("User ID"),
    username: z.string().nullish().describe("Username"),
    email: z.string().nullish().describe("Email"),
    ip: z.string().nullish().describe("IP address"),
    display_name: z.string().nullish().describe("Display name"),
    geo: ReplayGeoSchema.optional().describe("Geo metadata"),
  })
  .passthrough();

/**
 * Browser metadata attached to a replay.
 */
export const ReplayBrowserSchema = z
  .object({
    name: z.string().nullish().describe("Browser name"),
    version: z.string().nullish().describe("Browser version"),
  })
  .passthrough();

/**
 * Operating system metadata attached to a replay.
 */
export const ReplayOsSchema = z
  .object({
    name: z.string().nullish().describe("OS name"),
    version: z.string().nullish().describe("OS version"),
  })
  .passthrough();

/**
 * SDK metadata attached to a replay.
 */
export const ReplaySdkSchema = z
  .object({
    name: z.string().nullish().describe("SDK name"),
    version: z.string().nullish().describe("SDK version"),
  })
  .passthrough();

/**
 * Device metadata attached to a replay.
 */
export const ReplayDeviceSchema = z
  .object({
    brand: z.string().nullish().describe("Device brand"),
    family: z.string().nullish().describe("Device family"),
    model: z.string().nullish().describe("Device model"),
    model_id: z.string().nullish().describe("Device model identifier"),
    name: z.string().nullish().describe("Device name"),
  })
  .passthrough();

/**
 * OTA update metadata attached to a replay.
 */
export const ReplayOtaUpdatesSchema = z
  .object({
    channel: z.string().nullish().describe("OTA update channel"),
    runtime_version: z.string().nullish().describe("OTA runtime version"),
    update_id: z.string().nullish().describe("OTA update ID"),
  })
  .passthrough();

/**
 * Replay tags keyed by tag name.
 *
 * Archived replay rows sometimes return an empty array instead of a tag map,
 * so the schema accepts both shapes.
 */
export const ReplayTagsSchema = z.union([
  z.record(z.array(z.string())).describe("Replay tags"),
  z.array(z.unknown()).describe("Archived replay tags placeholder"),
]);

/**
 * Known root fields that the replay list endpoint accepts in repeated `field=`
 * query params.
 *
 * These are intentionally the root field names expected by the backend
 * validator, not dotted nested field names.
 */
export const REPLAY_LIST_FIELDS = [
  "activity",
  "browser",
  "count_dead_clicks",
  "count_errors",
  "count_infos",
  "count_rage_clicks",
  "count_segments",
  "count_urls",
  "count_warnings",
  "device",
  "dist",
  "duration",
  "environment",
  "error_ids",
  "finished_at",
  "has_viewed",
  "id",
  "info_ids",
  "is_archived",
  "os",
  "platform",
  "project_id",
  "releases",
  "sdk",
  "started_at",
  "tags",
  "trace_ids",
  "urls",
  "user",
  "warning_ids",
] as const;

/**
 * A single replay row returned by the organization replay index endpoint.
 *
 * Duration is in seconds, matching the backend replay interchange format.
 */
export const ReplayListItemSchema = z
  .object({
    activity: z.number().nullable().optional().describe("Replay activity score"),
    browser: ReplayBrowserSchema.optional().describe("Browser metadata"),
    count_dead_clicks: z
      .number()
      .nullable()
      .optional()
      .describe("Dead click count"),
    count_errors: z
      .number()
      .nullable()
      .optional()
      .describe("Associated error count"),
    count_infos: z.number().nullable().optional().describe("Info event count"),
    count_rage_clicks: z
      .number()
      .nullable()
      .optional()
      .describe("Rage click count"),
    count_segments: z
      .number()
      .nullable()
      .optional()
      .describe("Recording segment count"),
    count_urls: z.number().nullable().optional().describe("Visited URL count"),
    count_warnings: z
      .number()
      .nullable()
      .optional()
      .describe("Warning event count"),
    device: ReplayDeviceSchema.optional().describe("Device metadata"),
    dist: z.string().nullable().optional().describe("Distribution"),
    duration: z
      .number()
      .nullable()
      .optional()
      .describe("Replay duration in seconds"),
    environment: z.string().nullable().optional().describe("Environment"),
    error_ids: z.array(z.string()).optional().describe("Linked error IDs"),
    finished_at: z
      .string()
      .nullable()
      .optional()
      .describe("Replay finish timestamp"),
    has_viewed: z
      .boolean()
      .nullable()
      .optional()
      .describe("Whether the current user has viewed the replay"),
    id: z.string().describe("Replay ID"),
    info_ids: z.array(z.string()).optional().describe("Linked info event IDs"),
    is_archived: z.boolean().nullable().optional().describe("Archived flag"),
    os: ReplayOsSchema.optional().describe("Operating system metadata"),
    platform: z.string().nullable().optional().describe("Platform"),
    project_id: z
      .string()
      .nullable()
      .optional()
      .describe("Numeric project ID"),
    releases: z.array(z.string()).optional().describe("Associated releases"),
    sdk: ReplaySdkSchema.optional().describe("SDK metadata"),
    started_at: z
      .string()
      .nullable()
      .optional()
      .describe("Replay start timestamp"),
    tags: ReplayTagsSchema.optional().describe("Replay tags"),
    trace_ids: z.array(z.string()).optional().describe("Linked trace IDs"),
    urls: z.array(z.string()).optional().describe("Visited URLs"),
    user: ReplayUserSchema.optional().describe("User metadata"),
    warning_ids: z
      .array(z.string())
      .optional()
      .describe("Linked warning event IDs"),
  })
  .passthrough()
  .describe("Replay list row");

/**
 * Click selector summaries attached to replay detail responses.
 */
export const ReplayClickSchema = z
  .record(z.unknown())
  .describe("Replay click selector summary");

/**
 * Full replay metadata returned by the replay detail endpoint.
 */
export const ReplayDetailsSchema = ReplayListItemSchema.extend({
  clicks: z.array(ReplayClickSchema).optional().describe("Replay click summaries"),
  ota_updates: ReplayOtaUpdatesSchema.optional().describe("OTA update metadata"),
  replay_type: z
    .string()
    .nullable()
    .optional()
    .describe("Replay type"),
}).describe("Replay details");

/** Envelope returned by the replay index endpoint. */
export const ReplayListResponseSchema = z
  .object({
    data: z.array(ReplayListItemSchema),
  })
  .passthrough();

/** Envelope returned by the replay detail endpoint. */
export const ReplayDetailsResponseSchema = z
  .object({
    data: ReplayDetailsSchema,
  })
  .passthrough();

export type ReplayGeo = z.infer<typeof ReplayGeoSchema>;
export type ReplayUser = z.infer<typeof ReplayUserSchema>;
export type ReplayBrowser = z.infer<typeof ReplayBrowserSchema>;
export type ReplayOs = z.infer<typeof ReplayOsSchema>;
export type ReplaySdk = z.infer<typeof ReplaySdkSchema>;
export type ReplayDevice = z.infer<typeof ReplayDeviceSchema>;
export type ReplayOtaUpdates = z.infer<typeof ReplayOtaUpdatesSchema>;
export type ReplayListItem = z.infer<typeof ReplayListItemSchema>;
export type ReplayDetails = z.infer<typeof ReplayDetailsSchema>;
export type ReplayListResponse = z.infer<typeof ReplayListResponseSchema>;
export type ReplayDetailsResponse = z.infer<typeof ReplayDetailsResponseSchema>;
