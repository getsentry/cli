import { describe, expect, it } from "bun:test";
import { PLATFORMS, normalizePlatform } from "../../src/lib/platforms.js";

describe("PLATFORMS", () => {
  it("contains common platform identifiers", () => {
    expect(PLATFORMS).toContain("node");
    expect(PLATFORMS).toContain("javascript");
    expect(PLATFORMS).toContain("javascript-nextjs");
    expect(PLATFORMS).toContain("python");
  });
});

describe("normalizePlatform", () => {
  it("passes through valid platforms unchanged", () => {
    expect(normalizePlatform("node")).toBe("node");
    expect(normalizePlatform("javascript")).toBe("javascript");
    expect(normalizePlatform("javascript-nextjs")).toBe("javascript-nextjs");
    expect(normalizePlatform("python-django")).toBe("python-django");
    expect(normalizePlatform("react-native")).toBe("react-native");
  });

  it("maps javascript-node to node", () => {
    expect(normalizePlatform("javascript-node")).toBe("node");
  });

  it("maps javascript-express to node-express", () => {
    expect(normalizePlatform("javascript-express")).toBe("node-express");
  });

  it("maps Node.js framework variants to node", () => {
    expect(normalizePlatform("javascript-hono")).toBe("node");
    expect(normalizePlatform("javascript-koa")).toBe("node");
    expect(normalizePlatform("javascript-fastify")).toBe("node");
    expect(normalizePlatform("node-hono")).toBe("node");
    expect(normalizePlatform("node-koa")).toBe("node");
    expect(normalizePlatform("node-fastify")).toBe("node");
  });

  it("maps NestJS variants to node", () => {
    expect(normalizePlatform("javascript-nestjs")).toBe("node");
    expect(normalizePlatform("javascript-nest")).toBe("node");
    expect(normalizePlatform("node-nestjs")).toBe("node");
  });

  it("maps javascript-bun to bun", () => {
    expect(normalizePlatform("javascript-bun")).toBe("bun");
  });

  it("maps javascript-react-native to react-native", () => {
    expect(normalizePlatform("javascript-react-native")).toBe("react-native");
  });

  it("maps javascript-browser to javascript", () => {
    expect(normalizePlatform("javascript-browser")).toBe("javascript");
  });

  it("maps javascript-electron to electron", () => {
    expect(normalizePlatform("javascript-electron")).toBe("electron");
  });

  it("normalizes dots to hyphens", () => {
    expect(normalizePlatform("javascript.nextjs")).toBe("javascript-nextjs");
    expect(normalizePlatform("python.django")).toBe("python-django");
  });

  it("strips sentry- prefix from full registry keys", () => {
    expect(normalizePlatform("sentry-javascript-nextjs")).toBe(
      "javascript-nextjs"
    );
  });

  it("handles dot-notation registry keys with sentry prefix", () => {
    // sentry.javascript.node → sentry-javascript-node → javascript-node → node
    expect(normalizePlatform("sentry.javascript.node")).toBe("node");
  });

  it("returns unknown platforms unchanged for API validation", () => {
    expect(normalizePlatform("unknown-platform")).toBe("unknown-platform");
  });
});
