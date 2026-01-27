/**
 * Telemetry Exit Timing E2E Tests
 *
 * Tests that the CLI exits quickly even when telemetry is enabled.
 * This verifies the @sentry/core patch that adds .unref() to flush timers.
 *
 * Without the patch, flush(3000) blocks for ~3 seconds due to non-unref'd timers.
 * With the patch, the process can exit immediately when there's nothing to send.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getCliCommand } from "../fixture.js";

const cliDir = join(import.meta.dir, "../..");

describe("telemetry exit timing", () => {
  test("process exits without waiting for flush timeout", async () => {
    const cmd = getCliCommand();

    // Baseline: telemetry disabled
    const disabledStart = performance.now();
    const disabledProc = Bun.spawn([...cmd, "--version"], {
      cwd: cliDir,
      env: { ...process.env, SENTRY_CLI_NO_TELEMETRY: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    await disabledProc.exited;
    const disabledDuration = performance.now() - disabledStart;

    // Test: telemetry enabled (with patched Sentry)
    // Remove SENTRY_CLI_NO_TELEMETRY to enable telemetry
    const envWithTelemetry = { ...process.env };
    delete envWithTelemetry.SENTRY_CLI_NO_TELEMETRY;

    const enabledStart = performance.now();
    const enabledProc = Bun.spawn([...cmd, "--version"], {
      cwd: cliDir,
      env: envWithTelemetry,
      stdout: "pipe",
      stderr: "pipe",
    });
    await enabledProc.exited;
    const enabledDuration = performance.now() - enabledStart;

    // Both should complete successfully
    expect(disabledProc.exitCode).toBe(0);
    expect(enabledProc.exitCode).toBe(0);

    // Enabled should not be significantly slower than disabled.
    // Allow 500ms overhead for Sentry init + potential network attempt,
    // but NOT the old 3000ms+ timeout behavior.
    expect(enabledDuration).toBeLessThan(disabledDuration + 500);

    // And definitely under 1.5 seconds total (old behavior was 3+ seconds)
    expect(enabledDuration).toBeLessThan(1500);
  });
});
