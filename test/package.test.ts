import { describe, expect, test } from "bun:test";

describe("package.json", () => {
  test("has no runtime dependencies", async () => {
    const pkg: { dependencies?: Record<string, string> } =
      await Bun.file("package.json").json();

    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
