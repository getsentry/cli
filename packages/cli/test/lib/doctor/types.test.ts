import { describe, expect, it } from "vitest";
import {
  type Capture,
  type Check,
  type CheckContext,
  runChecks,
  type ServerFacts,
} from "../../../src/lib/doctor/types.js";

const capture: Capture = {
  cwd: "/tmp/app",
  ecosystems: [],
  dsns: [],
  initSites: [],
  buildConfigs: [],
  manifests: {},
};
const server: ServerFacts = { reachable: false };
const ctx: CheckContext = { capture, server };

describe("runChecks", () => {
  it("flattens checks that return arrays", () => {
    const check: Check = {
      id: "multi",
      run: () => [
        { id: "multi.a", status: "pass", detail: "a" },
        { id: "multi.b", status: "warn", detail: "b" },
      ],
    };
    expect(runChecks([check], ctx).map((r) => r.id)).toEqual([
      "multi.a",
      "multi.b",
    ]);
  });

  it("converts a throwing check into a skip and keeps going", () => {
    const boom: Check = {
      id: "boom",
      run: () => {
        throw new Error("kaboom");
      },
    };
    const ok: Check = {
      id: "ok",
      run: () => ({ id: "ok", status: "pass", detail: "fine" }),
    };

    const results = runChecks([boom, ok], ctx);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: "boom", status: "skip" });
    expect(results[0]?.detail).toContain("kaboom");
    expect(results[1]).toMatchObject({ id: "ok", status: "pass" });
  });
});
