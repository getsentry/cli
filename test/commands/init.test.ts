/**
 * Init Command Tests
 *
 * Tests for the sentry init command and wizard flag mapping.
 */

import { describe, expect, test } from "bun:test";
import { _buildWizardArgs, type WizardOptions } from "../../src/lib/wizard.js";

describe("buildWizardArgs", () => {
  test("returns empty array when no options provided", () => {
    const args = _buildWizardArgs({});
    expect(args).toEqual([]);
  });

  test("maps integration option to -i flag", () => {
    const args = _buildWizardArgs({ integration: "nextjs" });
    expect(args).toEqual(["-i", "nextjs"]);
  });

  test("maps org option to --org flag", () => {
    const args = _buildWizardArgs({ org: "my-org" });
    expect(args).toEqual(["--org", "my-org"]);
  });

  test("maps project option to --project flag", () => {
    const args = _buildWizardArgs({ project: "my-project" });
    expect(args).toEqual(["--project", "my-project"]);
  });

  test("maps url option to -u flag", () => {
    const args = _buildWizardArgs({ url: "https://sentry.example.com" });
    expect(args).toEqual(["-u", "https://sentry.example.com"]);
  });

  test("maps debug option to --debug flag", () => {
    const args = _buildWizardArgs({ debug: true });
    expect(args).toEqual(["--debug"]);
  });

  test("does not include --debug when debug is false", () => {
    const args = _buildWizardArgs({ debug: false });
    expect(args).not.toContain("--debug");
  });

  test("maps uninstall option to --uninstall flag", () => {
    const args = _buildWizardArgs({ uninstall: true });
    expect(args).toEqual(["--uninstall"]);
  });

  test("maps quiet option to --quiet flag", () => {
    const args = _buildWizardArgs({ quiet: true });
    expect(args).toEqual(["--quiet"]);
  });

  test("maps skipConnect option to --skip-connect flag", () => {
    const args = _buildWizardArgs({ skipConnect: true });
    expect(args).toEqual(["--skip-connect"]);
  });

  test("maps saas option to --saas flag", () => {
    const args = _buildWizardArgs({ saas: true });
    expect(args).toEqual(["--saas"]);
  });

  test("maps signup option to -s flag", () => {
    const args = _buildWizardArgs({ signup: true });
    expect(args).toEqual(["-s"]);
  });

  test("maps disableTelemetry option to --disable-telemetry flag", () => {
    const args = _buildWizardArgs({ disableTelemetry: true });
    expect(args).toEqual(["--disable-telemetry"]);
  });

  test("combines multiple options correctly", () => {
    const options: WizardOptions = {
      integration: "reactNative",
      org: "test-org",
      project: "test-project",
      debug: true,
      saas: true,
    };

    const args = _buildWizardArgs(options);

    expect(args).toContain("-i");
    expect(args).toContain("reactNative");
    expect(args).toContain("--org");
    expect(args).toContain("test-org");
    expect(args).toContain("--project");
    expect(args).toContain("test-project");
    expect(args).toContain("--debug");
    expect(args).toContain("--saas");
  });

  test("preserves argument order for predictable output", () => {
    const options: WizardOptions = {
      integration: "nextjs",
      org: "my-org",
      url: "https://custom.sentry.io",
      debug: true,
    };

    const args = _buildWizardArgs(options);

    // Verify the order matches the buildWizardArgs implementation
    expect(args).toEqual([
      "-i",
      "nextjs",
      "--org",
      "my-org",
      "-u",
      "https://custom.sentry.io",
      "--debug",
    ]);
  });

  test("handles all boolean flags together", () => {
    const options: WizardOptions = {
      debug: true,
      uninstall: true,
      quiet: true,
      skipConnect: true,
      saas: true,
      signup: true,
      disableTelemetry: true,
    };

    const args = _buildWizardArgs(options);

    expect(args).toContain("--debug");
    expect(args).toContain("--uninstall");
    expect(args).toContain("--quiet");
    expect(args).toContain("--skip-connect");
    expect(args).toContain("--saas");
    expect(args).toContain("-s");
    expect(args).toContain("--disable-telemetry");
    expect(args).toHaveLength(7);
  });
});
