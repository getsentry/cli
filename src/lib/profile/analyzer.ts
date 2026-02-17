/**
 * Profile Analyzer
 *
 * Utilities for analyzing flamegraph data to extract hot paths,
 * identify performance hotspots, and generate insights.
 */

import type {
  Flamegraph,
  FlamegraphFrame,
  FlamegraphFrameInfo,
  HotPath,
  ProfileAnalysis,
} from "../../types/index.js";

/** Nanoseconds per millisecond */
const NS_PER_MS = 1_000_000;

/**
 * Convert nanoseconds to milliseconds.
 */
export function nsToMs(ns: number): number {
  return ns / NS_PER_MS;
}

/**
 * Format duration in milliseconds to a compact human-readable string.
 * Shows appropriate precision based on magnitude.
 *
 * Named `formatDurationMs` to distinguish from `formatDuration` in
 * `formatters/human.ts` which takes seconds and returns verbose strings.
 */
export function formatDurationMs(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms >= 100) {
    const rounded = Math.round(ms);
    // Rounding can push past the 1000ms boundary (e.g. 999.5 → 1000)
    if (rounded >= 1000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${rounded}ms`;
  }
  if (ms >= 10) {
    const formatted = ms.toFixed(1);
    // toFixed(1) can push past 100ms boundary (e.g. 99.95 → "100.0")
    if (Number.parseFloat(formatted) >= 100) {
      return `${Math.round(ms)}ms`;
    }
    return `${formatted}ms`;
  }
  if (ms >= 1) {
    const formatted = ms.toFixed(2);
    // toFixed(2) can push past 10ms boundary (e.g. 9.999 → "10.00")
    if (Number.parseFloat(formatted) >= 10) {
      return `${ms.toFixed(1)}ms`;
    }
    return `${formatted}ms`;
  }
  // Sub-millisecond
  const us = ms * 1000;
  if (us >= 1) {
    const rounded = Math.round(us);
    // Rounding can push past 1ms boundary (e.g. 0.9995ms → 1000µs)
    if (rounded >= 1000) {
      return `${ms.toFixed(2)}ms`;
    }
    return `${us.toFixed(0)}µs`;
  }
  return `${(us * 1000).toFixed(0)}ns`;
}

/**
 * Check if a flamegraph has valid profile data.
 */
export function hasProfileData(flamegraph: Flamegraph): boolean {
  return (
    flamegraph.profiles.length > 0 &&
    flamegraph.shared.frames.length > 0 &&
    flamegraph.shared.frame_infos.length > 0
  );
}

/**
 * Get the total self time across all frames.
 * This gives the total CPU time spent in all functions.
 */
function getTotalSelfTime(flamegraph: Flamegraph): number {
  let total = 0;
  for (const info of flamegraph.shared.frame_infos) {
    total += info.sumSelfTime;
  }
  return total;
}

/**
 * Extract hot paths from flamegraph data.
 * Returns the top N call stacks by CPU time.
 *
 * @param flamegraph - The flamegraph data
 * @param limit - Maximum number of hot paths to return
 * @param userCodeOnly - Filter to only user application code
 * @returns Array of hot paths sorted by CPU time (descending)
 */
export function analyzeHotPaths(
  flamegraph: Flamegraph,
  limit: number,
  userCodeOnly: boolean
): HotPath[] {
  const { frames, frame_infos } = flamegraph.shared;
  const totalSelfTime = getTotalSelfTime(flamegraph);

  if (totalSelfTime === 0 || frames.length === 0) {
    return [];
  }

  // Build frame index to info mapping
  const frameInfoMap: Array<{
    frame: FlamegraphFrame;
    info: FlamegraphFrameInfo;
    index: number;
  }> = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const info = frame_infos[i];
    if (!(frame && info)) {
      continue;
    }

    // Filter by user code if requested
    if (userCodeOnly && !frame.is_application) {
      continue;
    }

    frameInfoMap.push({ frame, info, index: i });
  }

  // Sort by self time (most CPU-intensive frames first)
  frameInfoMap.sort((a, b) => b.info.sumSelfTime - a.info.sumSelfTime);

  // Take top N
  const topFrames = frameInfoMap.slice(0, limit);

  // Convert to HotPath format
  return topFrames.map(({ frame, info }) => ({
    frames: [frame], // Single frame for now (could expand to full call stack)
    frameInfo: info,
    percentage: (info.sumSelfTime / totalSelfTime) * 100,
  }));
}

/**
 * Calculate aggregate percentiles from flamegraph data.
 * Returns p75, p95, p99 in milliseconds.
 */
export function calculatePercentiles(flamegraph: Flamegraph): {
  p75: number;
  p95: number;
  p99: number;
} {
  const { frame_infos } = flamegraph.shared;

  if (frame_infos.length === 0) {
    return { p75: 0, p95: 0, p99: 0 };
  }

  // Aggregate percentiles across all frames (weighted average would be better,
  // but for simplicity we use max which represents worst-case)
  let maxP75 = 0;
  let maxP95 = 0;
  let maxP99 = 0;

  for (const info of frame_infos) {
    maxP75 = Math.max(maxP75, info.p75Duration);
    maxP95 = Math.max(maxP95, info.p95Duration);
    maxP99 = Math.max(maxP99, info.p99Duration);
  }

  return {
    p75: nsToMs(maxP75),
    p95: nsToMs(maxP95),
    p99: nsToMs(maxP99),
  };
}

/**
 * Get total sample count from flamegraph.
 */
function getTotalSamples(flamegraph: Flamegraph): number {
  let total = 0;
  for (const profile of flamegraph.profiles) {
    total += profile.samples.length;
  }
  return total;
}

/** Options for flamegraph analysis */
type AnalyzeOptions = {
  /** The transaction name being analyzed */
  transactionName: string;
  /** The time period of the analysis (e.g., "7d") */
  period: string;
  /** Maximum hot paths to include */
  limit: number;
  /** Filter to user application code only */
  userCodeOnly: boolean;
};

/**
 * Analyze a flamegraph and return structured analysis data.
 *
 * @param flamegraph - The flamegraph data from the API
 * @param options - Analysis options
 * @returns Structured profile analysis
 */
export function analyzeFlamegraph(
  flamegraph: Flamegraph,
  options: AnalyzeOptions
): ProfileAnalysis {
  const { transactionName, period, limit, userCodeOnly } = options;
  const hotPaths = analyzeHotPaths(flamegraph, limit, userCodeOnly);
  const percentiles = calculatePercentiles(flamegraph);
  const totalSamples = getTotalSamples(flamegraph);

  return {
    transactionName,
    platform: flamegraph.platform,
    period,
    percentiles,
    hotPaths,
    totalSamples,
    userCodeOnly,
  };
}
