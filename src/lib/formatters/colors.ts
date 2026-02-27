/**
 * Terminal color utilities using Sentinel-inspired palette
 *
 * Provides consistent coloring for CLI output with semantic helpers.
 */

import chalk from "chalk";
import type { IssueLevel, IssueStatus } from "../../types/index.js";

// Color Palette (Full Sentinel palette)

const COLORS = {
  red: "#fe4144",
  green: "#83da90",
  yellow: "#FDB81B",
  blue: "#226DFC",
  magenta: "#FF45A8",
  white: "#f9f8f9",
  cyan: "#79B8FF",
  muted: "#898294",
} as const;

// Base Color Functions

export const red = (text: string): string => chalk.hex(COLORS.red)(text);
export const green = (text: string): string => chalk.hex(COLORS.green)(text);
export const yellow = (text: string): string => chalk.hex(COLORS.yellow)(text);
export const blue = (text: string): string => chalk.hex(COLORS.blue)(text);
export const magenta = (text: string): string =>
  chalk.hex(COLORS.magenta)(text);
export const white = (text: string): string => chalk.hex(COLORS.white)(text);
export const cyan = (text: string): string => chalk.hex(COLORS.cyan)(text);
export const muted = (text: string): string => chalk.hex(COLORS.muted)(text);
export const bold = (text: string): string => chalk.bold(text);
export const underline = (text: string): string => chalk.underline(text);
export const boldUnderline = (text: string): string =>
  chalk.bold.underline(text);

/**
 * Wrap text in an OSC 8 terminal hyperlink.
 *
 * On terminals that support OSC 8 (iTerm2, Windows Terminal, VS Code,
 * most modern emulators), the text becomes clickable. On terminals that
 * don't, the escape sequences are silently ignored and the text renders
 * normally.
 *
 * `string-width` treats OSC 8 sequences as zero-width, so column sizing
 * in tables is not affected.
 *
 * @param text - Display text
 * @param url - Target URL
 * @returns Text wrapped in OSC 8 hyperlink escape sequences
 */
export function terminalLink(text: string, url: string): string {
  // OSC 8 ; params ; URI ST  text  OSC 8 ; ; ST
  // Using BEL () as string terminator for broad compatibility
  return `]8;;${url}${text}]8;;`;
}

// Semantic Helpers

/** Format success messages (green) */
export const success = (text: string): string => green(text);

/** Format error messages (red) */
export const error = (text: string): string => red(text);

/** Format warning messages (yellow) */
export const warning = (text: string): string => yellow(text);

/** Format info messages (cyan) */
export const info = (text: string): string => cyan(text);

/** Format headers and dividers (muted) */
export const header = (text: string): string => muted(text);

// Status-based Coloring

const STATUS_COLORS: Record<IssueStatus, (text: string) => string> = {
  resolved: green,
  unresolved: yellow,
  ignored: muted,
};

/**
 * Color text based on issue status (case-insensitive)
 */
export function statusColor(text: string, status: string | undefined): string {
  const normalizedStatus = status?.toLowerCase() as IssueStatus;
  const colorFn = STATUS_COLORS[normalizedStatus] ?? STATUS_COLORS.unresolved;
  return colorFn(text);
}

// Level-based Coloring

const LEVEL_COLORS: Record<IssueLevel, (text: string) => string> = {
  fatal: red,
  error: red,
  warning: yellow,
  info: cyan,
  debug: muted,
};

/**
 * Color text based on issue level (case-insensitive)
 */
export function levelColor(text: string, level: string | undefined): string {
  const normalizedLevel = level?.toLowerCase() as IssueLevel;
  const colorFn = LEVEL_COLORS[normalizedLevel];
  return colorFn ? colorFn(text) : text;
}

// Fixability-based Coloring

/** Fixability tier labels returned by getSeerFixabilityLabel() */
export type FixabilityTier = "high" | "med" | "low";

const FIXABILITY_COLORS: Record<FixabilityTier, (text: string) => string> = {
  high: green,
  med: yellow,
  low: red,
};

/**
 * Color text based on Seer fixability tier.
 *
 * @param text - Text to colorize
 * @param tier - Fixability tier label (`"high"`, `"med"`, or `"low"`)
 */
export function fixabilityColor(text: string, tier: FixabilityTier): string {
  return FIXABILITY_COLORS[tier](text);
}
