import { describe, expect, test } from "bun:test";
import { closeFreshTtyForwarding } from "../../../src/lib/init/stdin-reopen.js";

describe("closeFreshTtyForwarding", () => {
  test("is a no-op when forwarding was never installed", () => {
    expect(() => closeFreshTtyForwarding()).not.toThrow();
  });

  test("is idempotent across repeated calls", () => {
    expect(() => {
      closeFreshTtyForwarding();
      closeFreshTtyForwarding();
      closeFreshTtyForwarding();
    }).not.toThrow();
  });
});
