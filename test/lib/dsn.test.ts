/**
 * DSN Parsing Tests
 *
 * Unit tests for DSN parsing and validation logic.
 */

import { describe, expect, test } from "bun:test";
import type { DetectedDsn } from "../../src/lib/dsn/index.js";
import {
  createDetectedDsn,
  createDsnFingerprint,
  extractOrgIdFromHost,
  inferPackagePath,
  isValidDsn,
  parseDsn,
} from "../../src/lib/dsn/index.js";

describe("extractOrgIdFromHost", () => {
  test("extracts org ID from US ingest host", () => {
    const result = extractOrgIdFromHost("o1169445.ingest.us.sentry.io");
    expect(result).toBe("1169445");
  });

  test("extracts org ID from EU ingest host", () => {
    const result = extractOrgIdFromHost("o123.ingest.de.sentry.io");
    expect(result).toBe("123");
  });

  test("extracts org ID from default ingest host", () => {
    const result = extractOrgIdFromHost("o999.ingest.sentry.io");
    expect(result).toBe("999");
  });

  test("returns null for self-hosted host", () => {
    const result = extractOrgIdFromHost("sentry.mycompany.com");
    expect(result).toBeNull();
  });

  test("returns null for non-Sentry host", () => {
    const result = extractOrgIdFromHost("example.com");
    expect(result).toBeNull();
  });
});

describe("parseDsn", () => {
  test("parses valid SaaS DSN with org ID", () => {
    const dsn = "https://abc123@o1169445.ingest.us.sentry.io/4505229541441536";
    const result = parseDsn(dsn);

    expect(result).toEqual({
      protocol: "https",
      publicKey: "abc123",
      host: "o1169445.ingest.us.sentry.io",
      projectId: "4505229541441536",
      orgId: "1169445",
    });
  });

  test("parses valid self-hosted DSN without org ID", () => {
    const dsn = "https://abc123@sentry.mycompany.com/1";
    const result = parseDsn(dsn);

    expect(result).toEqual({
      protocol: "https",
      publicKey: "abc123",
      host: "sentry.mycompany.com",
      projectId: "1",
      orgId: undefined,
    });
  });

  test("parses DSN with http protocol", () => {
    const dsn = "http://key@o123.ingest.sentry.io/456";
    const result = parseDsn(dsn);

    expect(result).toEqual({
      protocol: "http",
      publicKey: "key",
      host: "o123.ingest.sentry.io",
      projectId: "456",
      orgId: "123",
    });
  });

  test("returns null for DSN without public key", () => {
    const dsn = "https://sentry.io/123";
    const result = parseDsn(dsn);
    expect(result).toBeNull();
  });

  test("returns null for DSN without project ID", () => {
    const dsn = "https://key@o123.ingest.sentry.io/";
    const result = parseDsn(dsn);
    expect(result).toBeNull();
  });

  test("returns null for invalid URL", () => {
    const dsn = "not-a-url";
    const result = parseDsn(dsn);
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = parseDsn("");
    expect(result).toBeNull();
  });

  test("handles DSN with path segments", () => {
    const dsn = "https://key@o123.ingest.sentry.io/api/456";
    const result = parseDsn(dsn);

    expect(result?.projectId).toBe("456");
  });
});

describe("isValidDsn", () => {
  test("returns true for valid SaaS DSN", () => {
    const dsn = "https://abc123@o1169445.ingest.us.sentry.io/4505229541441536";
    expect(isValidDsn(dsn)).toBe(true);
  });

  test("returns true for valid self-hosted DSN", () => {
    const dsn = "https://abc123@sentry.mycompany.com/1";
    expect(isValidDsn(dsn)).toBe(true);
  });

  test("returns false for invalid DSN", () => {
    const dsn = "https://sentry.io/123";
    expect(isValidDsn(dsn)).toBe(false);
  });

  test("returns false for non-URL string", () => {
    const dsn = "not-a-url";
    expect(isValidDsn(dsn)).toBe(false);
  });
});

describe("createDsnFingerprint", () => {
  /** Helper to create a minimal DetectedDsn for testing */
  function makeDsn(orgId: string, projectId: string): DetectedDsn {
    return {
      raw: `https://key@o${orgId}.ingest.sentry.io/${projectId}`,
      protocol: "https",
      publicKey: "key",
      host: `o${orgId}.ingest.sentry.io`,
      projectId,
      orgId,
      source: "env",
    };
  }

  test("creates fingerprint from multiple DSNs", () => {
    const dsns = [makeDsn("123", "456"), makeDsn("123", "789")];
    const result = createDsnFingerprint(dsns);
    expect(result).toBe("123:456,123:789");
  });

  test("sorts fingerprint alphabetically", () => {
    const dsns = [makeDsn("999", "111"), makeDsn("123", "456")];
    const result = createDsnFingerprint(dsns);
    expect(result).toBe("123:456,999:111");
  });

  test("deduplicates same DSN from multiple sources", () => {
    const dsn1 = makeDsn("123", "456");
    dsn1.source = "env";
    const dsn2 = makeDsn("123", "456");
    dsn2.source = "file";

    const result = createDsnFingerprint([dsn1, dsn2]);
    expect(result).toBe("123:456");
  });

  test("includes DSNs without orgId using host as prefix (self-hosted)", () => {
    const saas = makeDsn("123", "456");
    const selfHosted: DetectedDsn = {
      raw: "https://key@sentry.mycompany.com/1",
      protocol: "https",
      publicKey: "key",
      host: "sentry.mycompany.com",
      projectId: "1",
      orgId: undefined,
      source: "env",
    };

    const result = createDsnFingerprint([saas, selfHosted]);
    // Self-hosted uses host:projectId, SaaS uses orgId:projectId
    expect(result).toBe("123:456,sentry.mycompany.com:1");
  });

  test("returns empty string for empty array", () => {
    const result = createDsnFingerprint([]);
    expect(result).toBe("");
  });

  test("returns host-based fingerprint for self-hosted DSNs", () => {
    const selfHosted: DetectedDsn = {
      raw: "https://key@sentry.mycompany.com/1",
      protocol: "https",
      publicKey: "key",
      host: "sentry.mycompany.com",
      projectId: "1",
      orgId: undefined,
      source: "env",
    };

    const result = createDsnFingerprint([selfHosted]);
    expect(result).toBe("sentry.mycompany.com:1");
  });
});

describe("createDetectedDsn", () => {
  test("creates DetectedDsn from valid DSN string", () => {
    const result = createDetectedDsn(
      "https://abc123@o1169445.ingest.us.sentry.io/4505229541441536",
      "env"
    );

    expect(result).toEqual({
      raw: "https://abc123@o1169445.ingest.us.sentry.io/4505229541441536",
      protocol: "https",
      publicKey: "abc123",
      host: "o1169445.ingest.us.sentry.io",
      projectId: "4505229541441536",
      orgId: "1169445",
      source: "env",
      sourcePath: undefined,
      packagePath: undefined,
    });
  });

  test("includes sourcePath when provided", () => {
    const result = createDetectedDsn(
      "https://abc123@o123.ingest.sentry.io/456",
      "code",
      "src/config.ts"
    );

    expect(result?.sourcePath).toBe("src/config.ts");
  });

  test("includes packagePath when provided", () => {
    const result = createDetectedDsn(
      "https://abc123@o123.ingest.sentry.io/456",
      "code",
      "packages/web/src/config.ts",
      "packages/web"
    );

    expect(result?.packagePath).toBe("packages/web");
  });

  test("returns null for invalid DSN", () => {
    const result = createDetectedDsn("not-a-valid-dsn", "env");
    expect(result).toBeNull();
  });

  test("returns null for DSN without public key", () => {
    const result = createDetectedDsn("https://sentry.io/123", "env");
    expect(result).toBeNull();
  });
});

describe("inferPackagePath", () => {
  test("infers package path from packages/ directory", () => {
    const result = inferPackagePath("packages/frontend/src/index.ts");
    expect(result).toBe("packages/frontend");
  });

  test("infers package path from apps/ directory", () => {
    const result = inferPackagePath("apps/web/.env");
    expect(result).toBe("apps/web");
  });

  test("infers package path from libs/ directory", () => {
    const result = inferPackagePath("libs/shared/config.ts");
    expect(result).toBe("libs/shared");
  });

  test("infers package path from modules/ directory", () => {
    const result = inferPackagePath("modules/auth/index.ts");
    expect(result).toBe("modules/auth");
  });

  test("infers package path from services/ directory", () => {
    const result = inferPackagePath("services/api/server.ts");
    expect(result).toBe("services/api");
  });

  test("returns undefined for root project files", () => {
    const result = inferPackagePath("src/index.ts");
    expect(result).toBeUndefined();
  });

  test("returns undefined for top-level files", () => {
    const result = inferPackagePath(".env");
    expect(result).toBeUndefined();
  });

  test("returns undefined for non-monorepo directories", () => {
    const result = inferPackagePath("other/path/file.ts");
    expect(result).toBeUndefined();
  });
});
