/**
 * Timeseries → sixel chart renderer.
 *
 * Renders a Sentry timeseries result as a small inline sixel bar chart.
 * Builds a tiny RGBA bitmap, draws vertical/stacked bars colored by series,
 * then reuses the existing {@link encodeImageToSixel} encoder for a
 * terminal-ready DCS escape sequence.
 */

import type { TimeseriesResult } from "../../types/dashboard.js";
import { type DecodedImage, encodeImageToSixel } from "../sixel-image.js";

export type RenderSixelOpts = {
  /** Maximum pixel width of the rendered chart. */
  maxPixelWidth?: number;
  /** Maximum pixel height of the rendered chart. */
  maxPixelHeight?: number;
  /** Leave the background transparent instead of filling it. */
  backgroundTransparent?: boolean;
};

/** Default chart bitmap dimensions. */
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 120;

/** RGBA for the default background when transparency is off. */
const BACKGROUND_RGBA: [number, number, number, number] = [30, 30, 30, 255];

/**
 * Chart color palette matching the dashboard's categorical series colors.
 * Kept local to avoid a circular import with dashboard.ts.
 */
const SERIES_PALETTE = [
  "#7553FF",
  "#F0369A",
  "#C06F20",
  "#3D8F09",
  "#8B6AC8",
  "#E45560",
  "#B82D90",
  "#9E8B18",
  "#228A83",
  "#7B50D0",
] as const;

/** Get the color for a series by index. */
function chartColor(label: string, index: number): string {
  if (label === "Other") {
    return "#888888";
  }
  return SERIES_PALETTE[index % SERIES_PALETTE.length] ?? "#7553FF";
}

/**
 * Render a timeseries result as an inline sixel image.
 *
 * Returns a DCS sixel escape sequence, or `undefined` when the data is empty
 * or the bitmap has no drawable pixels.
 */
export function renderTimeseriesAsSixel(
  data: TimeseriesResult,
  opts: RenderSixelOpts = {}
): string | undefined {
  const {
    maxPixelWidth = DEFAULT_WIDTH,
    maxPixelHeight = DEFAULT_HEIGHT,
    backgroundTransparent = true,
  } = opts;

  if (
    data.series.length === 0 ||
    data.series.every((s) => s.values.length === 0)
  ) {
    return;
  }

  const width = Math.max(16, Math.floor(maxPixelWidth));
  const height = Math.max(8, Math.floor(maxPixelHeight));

  const img = createBitmap(width, height, backgroundTransparent);

  const isMulti = data.series.length > 1;
  if (isMulti) {
    drawStackedBars(img, data, width, height);
  } else {
    const first = data.series[0];
    if (first) {
      drawSingleSeriesBars(img, first, width, height);
    }
  }

  return encodeImageToSixel(img, width);
}

/** Create an RGBA bitmap, optionally transparent. */
function createBitmap(
  width: number,
  height: number,
  transparent: boolean
): DecodedImage {
  const size = width * height * 4;
  const data = new Uint8Array(size);
  if (!transparent) {
    const [r, g, b, a] = BACKGROUND_RGBA;
    for (let i = 0; i < size; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

/** Parse an RGB hex color into a 3-tuple. */
function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  if (normalized.length === 3) {
    const r0 = normalized[0];
    const g0 = normalized[1];
    const b0 = normalized[2];
    if (r0 && g0 && b0) {
      return [
        Number.parseInt(r0 + r0, 16),
        Number.parseInt(g0 + g0, 16),
        Number.parseInt(b0 + b0, 16),
      ];
    }
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

/** Draw a single-series bar chart into the bitmap. */
function drawSingleSeriesBars(
  img: DecodedImage,
  series: NonNullable<TimeseriesResult["series"][number]>,
  width: number,
  height: number
): void {
  const values = series.values.map((v) => v.value);
  if (values.length === 0) {
    return;
  }

  const maxVal = Math.max(...values, 1);
  const color = hexToRgb(chartColor(series.label, 0));
  const layout = computeBarLayout(width, values.length);

  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? 0;
    drawValueBar({ img, value, maxVal, index: i, height, color, layout });
  }
}

type BarLayout = {
  gap: number;
  barWidth: number;
};

/** Compute the gap and width for evenly distributed bars. */
function computeBarLayout(width: number, count: number): BarLayout {
  const gap = Math.max(1, Math.floor(width / count / 8));
  const barWidth = Math.max(1, Math.floor((width - (count - 1) * gap) / count));
  return { gap, barWidth };
}

/** Parameters for {@link drawValueBar}. */
type ValueBarOpts = {
  img: DecodedImage;
  value: number;
  maxVal: number;
  index: number;
  height: number;
  color: [number, number, number];
  layout: BarLayout;
};

/** Draw one bar for a single-series chart. */
function drawValueBar(opts: ValueBarOpts): void {
  const { img, value, maxVal, index, height, color, layout } = opts;
  const h = (value / maxVal) * height;
  const x0 = index * (layout.barWidth + layout.gap);
  drawRect(img, {
    x: x0,
    y: height - Math.round(h),
    w: layout.barWidth,
    h: Math.round(h),
    color,
  });
}

/** Draw a stacked multi-series bar chart into the bitmap. */
function drawStackedBars(
  img: DecodedImage,
  data: TimeseriesResult,
  width: number,
  height: number
): void {
  const firstSeries = data.series[0];
  if (!firstSeries) {
    return;
  }

  const bucketCount = firstSeries.values.length;
  if (bucketCount === 0) {
    return;
  }

  const totals = computeBucketTotals(data, bucketCount);
  const maxTotal = Math.max(...totals, 1);
  const layout = computeBarLayout(width, bucketCount);

  for (let b = 0; b < bucketCount; b++) {
    const total = totals[b];
    if (total === undefined) {
      continue;
    }
    drawStackedColumn({ img, data, bucket: b, maxTotal, height, layout });
  }
}

/** Sum each time bucket across all series. */
function computeBucketTotals(
  data: TimeseriesResult,
  bucketCount: number
): number[] {
  const totals = new Array<number>(bucketCount).fill(0);
  for (const s of data.series) {
    for (let i = 0; i < bucketCount; i++) {
      const total = totals[i];
      const point = s.values[i];
      if (total !== undefined && point) {
        totals[i] = total + point.value;
      }
    }
  }
  return totals;
}

/** Parameters for {@link drawStackedColumn}. */
type StackedColumnOpts = {
  img: DecodedImage;
  data: TimeseriesResult;
  bucket: number;
  maxTotal: number;
  height: number;
  layout: BarLayout;
};

/** Draw one stacked column for a given time bucket. */
function drawStackedColumn(opts: StackedColumnOpts): void {
  const { img, data, bucket, maxTotal, height, layout } = opts;
  const x0 = bucket * (layout.barWidth + layout.gap);
  let yBottom = height;

  for (let s = 0; s < data.series.length; s++) {
    const series = data.series[s];
    if (!series) {
      continue;
    }
    const point = series.values[bucket];
    const segmentValue = point?.value ?? 0;
    if (segmentValue <= 0 || yBottom <= 0) {
      continue;
    }

    const segmentHeight = Math.min(
      yBottom,
      Math.max(1, Math.round((segmentValue / maxTotal) * height))
    );
    const yTop = Math.max(0, yBottom - segmentHeight);
    const color = hexToRgb(chartColor(series.label, s));
    drawRect(img, {
      x: x0,
      y: yTop,
      w: layout.barWidth,
      h: yBottom - yTop,
      color,
    });
    yBottom = yTop;
  }
}

/** Parameters for {@link drawRect}. */
type RectOpts = {
  x: number;
  y: number;
  w: number;
  h: number;
  color: [number, number, number];
};

/** Fill a solid rectangle in the bitmap. */
function drawRect(img: DecodedImage, opts: RectOpts): void {
  const { x, y, w, h, color } = opts;
  for (let py = Math.max(0, y); py < Math.min(img.height, y + h); py++) {
    for (let px = Math.max(0, x); px < Math.min(img.width, x + w); px++) {
      const i = (py * img.width + px) * 4;
      img.data[i] = color[0];
      img.data[i + 1] = color[1];
      img.data[i + 2] = color[2];
      img.data[i + 3] = 255;
    }
  }
}
