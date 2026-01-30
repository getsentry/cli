/**
 * Upgrade Command Tests
 *
 * Tests for the sentry upgrade command registration and module exports.
 */

import { describe, expect, test } from "bun:test";
import { upgradeCommand } from "../../src/commands/upgrade.js";

describe("upgradeCommand", () => {
  test("is exported and defined", () => {
    expect(upgradeCommand).toBeDefined();
  });
});
