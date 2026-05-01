function splitReplayDuration(totalSeconds: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const rounded = Math.max(0, Math.round(totalSeconds));
  return {
    days: Math.floor(rounded / 86_400),
    hours: Math.floor((rounded % 86_400) / 3600),
    minutes: Math.floor((rounded % 3600) / 60),
    seconds: rounded % 60,
  };
}

function pluralize(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}

/**
 * Format a replay duration for compact table output.
 */
export function formatReplayDurationCompact(
  seconds: number | null | undefined
): string {
  if (seconds === null || seconds === undefined) {
    return "—";
  }

  const parts = splitReplayDuration(seconds);
  if (parts.days > 0) {
    return parts.hours > 0
      ? `${parts.days}d ${parts.hours}h`
      : `${parts.days}d`;
  }
  if (parts.hours > 0) {
    return parts.minutes > 0
      ? `${parts.hours}h ${parts.minutes}m`
      : `${parts.hours}h`;
  }
  if (parts.minutes > 0) {
    return parts.seconds > 0
      ? `${parts.minutes}m ${parts.seconds}s`
      : `${parts.minutes}m`;
  }
  return `${parts.seconds}s`;
}

/**
 * Format a replay duration for verbose detail output.
 */
export function formatReplayDurationVerbose(seconds: number): string {
  const parts = splitReplayDuration(seconds);
  if (parts.days > 0) {
    return parts.hours > 0
      ? `${pluralize(parts.days, "day")} and ${pluralize(parts.hours, "hour")}`
      : pluralize(parts.days, "day");
  }
  if (parts.hours > 0) {
    return parts.minutes > 0
      ? `${pluralize(parts.hours, "hour")} and ${pluralize(parts.minutes, "minute")}`
      : pluralize(parts.hours, "hour");
  }
  if (parts.minutes > 0) {
    return parts.seconds > 0
      ? `${pluralize(parts.minutes, "minute")} and ${pluralize(parts.seconds, "second")}`
      : pluralize(parts.minutes, "minute");
  }
  return pluralize(parts.seconds, "second");
}
