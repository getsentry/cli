/**
 * Tests for host-scoped auth: setAuthToken persistence, getStoredAuthHost,
 * NULL-host lazy migration, host preservation across refresh-style updates.
 */

import { describe, expect, test } from "bun:test";
import {
  getStoredAuthHost,
  hasUsableStoredToken,
  setAuthToken,
} from "../../../src/lib/db/auth.js";
import { getDatabase } from "../../../src/lib/db/index.js";
import { useTestConfigDir } from "../../helpers.js";

describe("db/auth host scoping", () => {
  useTestConfigDir("auth-host-test-");

  test("setAuthToken persists explicit host", () => {
    setAuthToken("tok-1", undefined, undefined, {
      host: "https://sentry.acme.com",
    });
    expect(getStoredAuthHost()).toBe("https://sentry.acme.com");
  });

  test("setAuthToken normalizes host (lowercases + strips trailing slash)", () => {
    setAuthToken("tok-1", undefined, undefined, {
      host: "https://SENTRY.Acme.com/",
    });
    // normalizeOrigin lowercases + strips trailing slash
    expect(getStoredAuthHost()).toBe("https://sentry.acme.com");
  });

  test("setAuthToken without host explicit uses configured host", () => {
    const prevHost = process.env.SENTRY_HOST;
    process.env.SENTRY_HOST = "https://env-host.example.com";
    try {
      setAuthToken("tok-2");
      expect(getStoredAuthHost()).toBe("https://env-host.example.com");
    } finally {
      if (prevHost === undefined) {
        delete process.env.SENTRY_HOST;
      } else {
        process.env.SENTRY_HOST = prevHost;
      }
    }
  });

  test("setAuthToken without host falls back to DEFAULT_SENTRY_URL", () => {
    const prevHost = process.env.SENTRY_HOST;
    const prevUrl = process.env.SENTRY_URL;
    delete process.env.SENTRY_HOST;
    delete process.env.SENTRY_URL;
    try {
      setAuthToken("tok-3");
      expect(getStoredAuthHost()).toBe("https://sentry.io");
    } finally {
      if (prevHost !== undefined) {
        process.env.SENTRY_HOST = prevHost;
      }
      if (prevUrl !== undefined) {
        process.env.SENTRY_URL = prevUrl;
      }
    }
  });

  test("refresh-style update preserves existing host when options.host omitted", () => {
    setAuthToken("tok-initial", 3600, "refresh-tok", {
      host: "https://sentry.acme.com",
    });
    expect(getStoredAuthHost()).toBe("https://sentry.acme.com");

    // Simulate a refresh: new access token + same refresh token, no host
    setAuthToken("tok-refreshed", 3600, "refresh-tok");
    expect(getStoredAuthHost()).toBe("https://sentry.acme.com");
  });

  test("lazy migration: NULL host is backfilled from configured host on first access", () => {
    // Simulate a pre-v16 row: direct INSERT bypassing setAuthToken
    const db = getDatabase();
    db.query(
      "INSERT OR REPLACE INTO auth (id, token, host, updated_at) VALUES (1, 'legacy-token', NULL, ?)"
    ).run(Date.now());

    const prevHost = process.env.SENTRY_HOST;
    process.env.SENTRY_HOST = "https://legacy-configured.example.com";
    try {
      expect(getStoredAuthHost()).toBe("https://legacy-configured.example.com");
      // Second call reads the now-populated host
      expect(getStoredAuthHost()).toBe("https://legacy-configured.example.com");
      // Verify it was actually written to the DB
      const row = db.query("SELECT host FROM auth WHERE id = 1").get() as {
        host: string | null;
      };
      expect(row.host).toBe("https://legacy-configured.example.com");
    } finally {
      if (prevHost === undefined) {
        delete process.env.SENTRY_HOST;
      } else {
        process.env.SENTRY_HOST = prevHost;
      }
    }
  });

  test("lazy migration: NULL host with no configured host falls back to SaaS", () => {
    const db = getDatabase();
    db.query(
      "INSERT OR REPLACE INTO auth (id, token, host, updated_at) VALUES (1, 'legacy-token', NULL, ?)"
    ).run(Date.now());

    const prevHost = process.env.SENTRY_HOST;
    const prevUrl = process.env.SENTRY_URL;
    delete process.env.SENTRY_HOST;
    delete process.env.SENTRY_URL;
    try {
      expect(getStoredAuthHost()).toBe("https://sentry.io");
    } finally {
      if (prevHost !== undefined) {
        process.env.SENTRY_HOST = prevHost;
      }
      if (prevUrl !== undefined) {
        process.env.SENTRY_URL = prevUrl;
      }
    }
  });

  test("getStoredAuthHost returns undefined when no stored token", () => {
    // Nothing persisted
    expect(getStoredAuthHost()).toBeUndefined();
  });

  test("hasUsableStoredToken reflects stored row status", () => {
    expect(hasUsableStoredToken()).toBe(false);

    setAuthToken("tok-usable", 3600, "refresh", {
      host: "https://sentry.io",
    });
    expect(hasUsableStoredToken()).toBe(true);
  });
});
