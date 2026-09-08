import { describe, expect, test } from "vitest";
import {
  appendBounded,
  decodeEnvelope,
  getPreferredStreamUrl,
  getStreamUrlFromHash,
  getStreamUrlFromStorage,
} from "./spotlight.js";

describe("getStreamUrlFromHash", () => {
  test("accepts a loopback stream URL", () => {
    expect(
      getStreamUrlFromHash(
        "#stream=http%3A%2F%2Flocalhost%3A8969%2Fstream"
      )
    ).toBe("http://localhost:8969/stream");
  });

  test("rejects a non-loopback stream URL", () => {
    expect(
      getStreamUrlFromHash("#stream=http%3A%2F%2Fexample.com%2Fstream")
    ).toBeUndefined();
  });

  test("restores a valid saved loopback stream URL", () => {
    expect(getStreamUrlFromStorage("http://127.0.0.1:8969/stream")).toBe(
      "http://127.0.0.1:8969/stream"
    );
  });

  test("rejects a saved non-loopback stream URL", () => {
    expect(getStreamUrlFromStorage("http://example.com/stream")).toBeUndefined();
  });

  test("prefers a fresh CLI fragment over a saved stream URL", () => {
    expect(
      getPreferredStreamUrl(
        "#stream=http%3A%2F%2Flocalhost%3A9000%2Fstream",
        "http://127.0.0.1:8969/stream"
      )
    ).toBe("http://localhost:9000/stream");
  });
});

describe("decodeEnvelope", () => {
  test("turns envelope items into displayable feed entries", () => {
    expect(
      decodeEnvelope(
        '[{"sdk":{"name":"sentry.node"}},[[{"type":"transaction"},{"transaction":"GET /users","timestamp":1}]]]',
        "event-1"
      )
    ).toEqual([
      {
        id: "event-1:0",
        type: "transaction",
        timestamp: 1,
        text: '{\n  "transaction": "GET /users",\n  "timestamp": 1\n}',
      },
    ]);
  });

  test("rejects malformed envelopes", () => {
    expect(() => decodeEnvelope("not json", "event-1")).toThrow(
      "Invalid Sentry envelope"
    );
  });
});

describe("appendBounded", () => {
  test("keeps the newest 500 items", () => {
    const entries = Array.from({ length: 501 }, (_, index) => ({
      id: String(index),
      type: "transaction",
      text: String(index),
    }));

    const result = appendBounded([], entries);

    expect(result).toHaveLength(500);
    expect(result[0]?.id).toBe("1");
    expect(result.at(-1)?.id).toBe("500");
  });
});
