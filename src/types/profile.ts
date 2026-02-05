/**
 * Profiling API Types
 *
 * Types for Sentry's profiling API responses including flamegraph data
 * and profile functions. Zod schemas provide runtime validation.
 */

import { z } from "zod";

// Flamegraph Types

/**
 * A single frame in a flamegraph call stack.
 * Contains source location and whether it's application code.
 */
export const FlamegraphFrameSchema = z
  .object({
    /** Source file path */
    file: z.string(),
    /** Image/module name (for native code) */
    image: z.string().optional(),
    /** Whether this is user application code (vs library/system) */
    is_application: z.boolean(),
    /** Line number in source file */
    line: z.number(),
    /** Function name */
    name: z.string(),
    /** Full file path */
    path: z.string().optional(),
    /** Unique identifier for deduplication */
    fingerprint: z.number(),
  })
  .passthrough();

export type FlamegraphFrame = z.infer<typeof FlamegraphFrameSchema>;

/**
 * Statistics for a single frame across all samples.
 * Contains timing percentiles and aggregate counts.
 */
export const FlamegraphFrameInfoSchema = z
  .object({
    /** Number of times this frame appears */
    count: z.number(),
    /** Total weight/time in this frame */
    weight: z.number(),
    /** Sum of all durations (nanoseconds) */
    sumDuration: z.number(),
    /** Sum of self time only (excluding children) */
    sumSelfTime: z.number(),
    /** 75th percentile duration (nanoseconds) */
    p75Duration: z.number(),
    /** 95th percentile duration (nanoseconds) */
    p95Duration: z.number(),
    /** 99th percentile duration (nanoseconds) */
    p99Duration: z.number(),
  })
  .passthrough();

export type FlamegraphFrameInfo = z.infer<typeof FlamegraphFrameInfoSchema>;

/**
 * Metadata for a single profile within a flamegraph.
 */
export const FlamegraphProfileMetadataSchema = z
  .object({
    project_id: z.number(),
    profile_id: z.string(),
    /** Start timestamp (Unix epoch) */
    start: z.number(),
    /** End timestamp (Unix epoch) */
    end: z.number(),
  })
  .passthrough();

export type FlamegraphProfileMetadata = z.infer<
  typeof FlamegraphProfileMetadataSchema
>;

/**
 * A single profile with sample data.
 * Contains the actual call stack samples and timing weights.
 */
export const FlamegraphProfileSchema = z
  .object({
    /** End value for the profile timeline */
    endValue: z.number(),
    /** Whether this is the main thread */
    isMainThread: z.boolean(),
    /** Thread/profile name */
    name: z.string(),
    /** Sample data: arrays of frame indices representing call stacks */
    samples: z.array(z.array(z.number())),
    /** Start value for the profile timeline */
    startValue: z.number(),
    /** Thread ID */
    threadID: z.number(),
    /** Profile type (e.g., "sampled") */
    type: z.string(),
    /** Time unit (e.g., "nanoseconds") */
    unit: z.string(),
    /** Time weights for each sample */
    weights: z.array(z.number()),
    /** Sample durations in nanoseconds */
    sample_durations_ns: z.array(z.number()).optional(),
    /** Sample counts */
    sample_counts: z.array(z.number()).optional(),
  })
  .passthrough();

export type FlamegraphProfile = z.infer<typeof FlamegraphProfileSchema>;

/**
 * Complete flamegraph response from the profiling API.
 * Contains all frames, profiles, and aggregate statistics.
 */
export const FlamegraphSchema = z
  .object({
    /** Index of the active/main profile */
    activeProfileIndex: z.number(),
    /** Additional metadata */
    metadata: z.record(z.unknown()).optional(),
    /** Platform/language (e.g., "python", "node") */
    platform: z.string(),
    /** Array of profile data with samples */
    profiles: z.array(FlamegraphProfileSchema),
    /** Project ID */
    projectID: z.number(),
    /** Shared data across all profiles */
    shared: z.object({
      /** All unique frames in the flamegraph */
      frames: z.array(FlamegraphFrameSchema),
      /** Statistics for each frame (parallel array to frames) */
      frame_infos: z.array(FlamegraphFrameInfoSchema),
      /** Profile metadata */
      profiles: z.array(FlamegraphProfileMetadataSchema),
    }),
    /** Transaction name this flamegraph represents */
    transactionName: z.string().optional(),
    /** Additional metrics */
    metrics: z.unknown().optional(),
  })
  .passthrough();

export type Flamegraph = z.infer<typeof FlamegraphSchema>;

// Explore Events API Types (for profile_functions dataset)

/**
 * A row from the profile_functions dataset query.
 * Used for listing transactions with profile data.
 */
export const ProfileFunctionRowSchema = z
  .object({
    /** Transaction name */
    transaction: z.string().optional(),
    /** Number of profiles/samples */
    "count()": z.number().optional(),
    /** 75th percentile duration */
    "p75(function.duration)": z.number().optional(),
    /** 95th percentile duration */
    "p95(function.duration)": z.number().optional(),
  })
  .passthrough();

export type ProfileFunctionRow = z.infer<typeof ProfileFunctionRowSchema>;

/**
 * Response from the Explore Events API for profile_functions dataset.
 */
export const ProfileFunctionsResponseSchema = z.object({
  data: z.array(ProfileFunctionRowSchema),
  meta: z
    .object({
      fields: z.record(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export type ProfileFunctionsResponse = z.infer<
  typeof ProfileFunctionsResponseSchema
>;

// Analyzed Profile Types (for CLI output)

/**
 * A hot path (call stack) identified from profile analysis.
 */
export type HotPath = {
  /** Frames in the call stack (leaf to root) */
  frames: FlamegraphFrame[];
  /** Frame info for the leaf frame */
  frameInfo: FlamegraphFrameInfo;
  /** Percentage of total CPU time */
  percentage: number;
};

/**
 * Analyzed profile data ready for display.
 */
export type ProfileAnalysis = {
  /** Transaction name */
  transactionName: string;
  /** Platform (e.g., "python", "node") */
  platform: string;
  /** Time period analyzed */
  period: string;
  /** Performance percentiles (in milliseconds) */
  percentiles: {
    p75: number;
    p95: number;
    p99: number;
  };
  /** Top hot paths by CPU time */
  hotPaths: HotPath[];
  /** Total number of samples analyzed */
  totalSamples: number;
  /** Whether analysis focused on user code only */
  userCodeOnly: boolean;
};
