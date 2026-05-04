/**
 * Terminal Color Scheme Detection
 *
 * Auto-detects whether the terminal has a dark or light background
 * and provides matching color palettes. Dark terminals get the
 * standard Sentry purple palette; light terminals get darker,
 * higher-contrast variants.
 *
 * Detection priority:
 *   1. `SENTRY_THEME=dark|light` env var override
 *   2. `COLORFGBG` env var (standard: `"15;0"` = light-on-dark bg)
 *   3. Default to `"dark"` (most terminals)
 */

export type ColorScheme = "dark" | "light";

export type ThemePalette = {
  accent: string;
  primary: string;
  muted: string;
  mutedDim: string;
  info: string;
  warn: string;
  error: string;
  success: string;
};

const DARK_PALETTE: ThemePalette = {
  accent: "#7553FF",
  primary: "#8B6AC8",
  muted: "gray",
  mutedDim: "#555555",
  info: "#9C84D4",
  warn: "#FDB81B",
  error: "#fe4144",
  success: "#83da90",
};

const LIGHT_PALETTE: ThemePalette = {
  accent: "#5538A8",
  primary: "#6C4EBA",
  muted: "#666666",
  mutedDim: "#999999",
  info: "#5D3EB2",
  warn: "#B8860B",
  error: "#b91c1c",
  success: "#15803d",
};

/** Detect terminal color scheme from environment. */
export function detectColorScheme(): ColorScheme {
  const override = process.env.SENTRY_THEME;
  if (override === "light" || override === "dark") {
    return override;
  }
  const colorFgBg = process.env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.split(";");
    const bg = Number.parseInt(parts.at(-1) ?? "", 10);
    if (!Number.isNaN(bg) && bg > 8) {
      return "light";
    }
  }
  return "dark";
}

/** Get the theme palette for the detected or specified scheme. */
export function getThemePalette(scheme?: ColorScheme): ThemePalette {
  const resolved = scheme ?? detectColorScheme();
  return resolved === "light" ? LIGHT_PALETTE : DARK_PALETTE;
}
