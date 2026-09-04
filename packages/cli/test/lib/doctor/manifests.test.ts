import { describe, expect, it } from "vitest";
import {
  isManifest,
  parseManifest,
} from "../../../src/lib/doctor/manifests.js";

describe("parseManifest", () => {
  it("reads Sentry deps out of package.json", () => {
    const parsed = parseManifest(
      "package.json",
      JSON.stringify({
        dependencies: { "@sentry/node": "^8.42.0", express: "^4" },
        devDependencies: { "@sentry/vite-plugin": "2.22.0" },
      })
    );

    expect(parsed?.deps).toEqual({
      "@sentry/node": "^8.42.0",
      "@sentry/vite-plugin": "2.22.0",
    });
  });

  it("reads Sentry deps out of a Gradle file", () => {
    const parsed = parseManifest(
      "app/build.gradle",
      'implementation "io.sentry:sentry-android:7.14.0"'
    );
    expect(parsed?.deps["io.sentry:sentry-android"]).toBe("7.14.0");
  });

  it("reads Sentry deps out of requirements.txt", () => {
    const parsed = parseManifest("requirements.txt", "sentry-sdk==2.18.0\n");
    expect(parsed?.deps["sentry-sdk"]).toBe("2.18.0");
  });

  it("returns null when no Sentry dependency is present", () => {
    expect(parseManifest("requirements.txt", "flask==3.0.0\n")).toBeNull();
  });

  it("identifies manifests by basename", () => {
    expect(isManifest("package.json")).toBe(true);
    expect(isManifest("pubspec.yaml")).toBe(true);
    expect(isManifest("index.ts")).toBe(false);
  });
});
