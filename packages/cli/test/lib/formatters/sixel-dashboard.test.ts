import { describe, expect, test } from "vitest";
import {
  formatTimestamp,
  renderDashboardAsSixel,
} from "../../../src/lib/formatters/sixel-dashboard.js";
import type { DecodedImage } from "../../../src/lib/sixel-image.js";

describe("formatTimestamp", () => {
  const timestamp = Date.UTC(2024, 0, 15, 10, 30) / 1000;
  const date = new Date(timestamp * 1000);

  test("uses clock time for periods shorter than two days", () => {
    expect(formatTimestamp(timestamp, 1)).toBe(
      `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    );
  });

  test("formats the Unix epoch instead of treating it as missing", () => {
    const epoch = new Date(0);
    expect(formatTimestamp(0, 1)).toBe(
      `${String(epoch.getHours()).padStart(2, "0")}:${String(epoch.getMinutes()).padStart(2, "0")}`
    );
    expect(formatTimestamp(0, 7)).toBe(
      `${String(epoch.getMonth() + 1).padStart(2, "0")}/${String(epoch.getDate()).padStart(2, "0")}`
    );
  });

  test("uses calendar dates for multi-day periods", () => {
    expect(formatTimestamp(timestamp, 7)).toBe(
      `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`
    );
    expect(formatTimestamp(timestamp, 31)).toBe(`Jan ${date.getDate()}`);
  });
});

function renderWidget(displayType: string): {
  image: DecodedImage;
  result: ReturnType<typeof renderDashboardAsSixel>;
} {
  let captured: DecodedImage | undefined;
  const result = renderDashboardAsSixel(
    {
      widgets: [
        {
          title: "Requests",
          displayType,
          layout: { x: 0, y: 0, w: 6, h: 2 },
          data: {
            type: "timeseries",
            series: [
              {
                label: "count()",
                values: [
                  { timestamp: 1_700_000_000, value: 1 },
                  { timestamp: 1_700_000_060, value: 4 },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      pixelWidth: 120,
      cellWidth: 10,
      cellHeight: 20,
      renderTextContent: () => [],
      encodeImage(image) {
        captured = image;
        return "rendered";
      },
    }
  );

  if (!captured) {
    throw new Error("Test encoder did not receive a dashboard image");
  }
  return { image: captured, result };
}

function countPixels(
  image: DecodedImage,
  color: [number, number, number]
): number {
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (
      image.data[offset] === color[0] &&
      image.data[offset + 1] === color[1] &&
      image.data[offset + 2] === color[2]
    ) {
      count += 1;
    }
  }
  return count;
}

describe("dashboard chart rendering", () => {
  test("uses heatmap cells only for heatmap widgets", () => {
    const heatmapCell: [number, number, number] = [80, 120, 200];
    const line = renderWidget("line");
    const heatmap = renderWidget("heatmap");

    expect(line.result).toEqual({ output: "rendered" });
    expect(heatmap.result).toEqual({ output: "rendered" });
    expect(countPixels(line.image, heatmapCell)).toBe(0);
    expect(countPixels(heatmap.image, heatmapCell)).toBeGreaterThan(0);
  });
});
