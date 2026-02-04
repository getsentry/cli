import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractDsnsFromContent,
  extractFirstDsnFromContent,
  scanCodeForDsns,
  scanCodeForFirstDsn,
} from "../../../src/lib/dsn/code-scanner.js";

describe("Code Scanner", () => {
  const testDir = join(import.meta.dir, ".test-code-scanner");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.SENTRY_URL;
  });

  describe("extractDsnsFromContent", () => {
    test("extracts DSN from JavaScript code", () => {
      const content = `
        Sentry.init({
          dsn: "https://abc123@o123.ingest.sentry.io/456"
        });
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://abc123@o123.ingest.sentry.io/456"]);
    });

    test("extracts DSN from Python code", () => {
      const content = `
        sentry_sdk.init(
            dsn="https://abc123@o123.ingest.sentry.io/456"
        )
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://abc123@o123.ingest.sentry.io/456"]);
    });

    test("extracts DSN from Go code", () => {
      const content = `
        sentry.Init(sentry.ClientOptions{
          Dsn: "https://abc123@o123.ingest.sentry.io/456",
        })
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://abc123@o123.ingest.sentry.io/456"]);
    });

    test("extracts DSN from constant assignment", () => {
      const content = `
        const SENTRY_DSN = "https://abc123@o123.ingest.sentry.io/456";
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://abc123@o123.ingest.sentry.io/456"]);
    });

    test("extracts multiple DSNs", () => {
      const content = `
        const PROD_DSN = "https://prod@o123.ingest.sentry.io/111";
        const DEV_DSN = "https://dev@o456.ingest.sentry.io/222";
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toHaveLength(2);
      expect(dsns).toContain("https://prod@o123.ingest.sentry.io/111");
      expect(dsns).toContain("https://dev@o456.ingest.sentry.io/222");
    });

    test("deduplicates DSNs", () => {
      const content = `
        const DSN1 = "https://abc@o123.ingest.sentry.io/456";
        const DSN2 = "https://abc@o123.ingest.sentry.io/456";
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toHaveLength(1);
    });

    test("ignores single-line comments with //", () => {
      const content = `
        // const DSN = "https://abc123@o123.ingest.sentry.io/456";
        const REAL_DSN = "https://real@o456.ingest.sentry.io/789";
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://real@o456.ingest.sentry.io/789"]);
    });

    test("ignores Python/shell comments with #", () => {
      const content = `
        # DSN = "https://abc123@o123.ingest.sentry.io/456"
        REAL_DSN = "https://real@o456.ingest.sentry.io/789"
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://real@o456.ingest.sentry.io/789"]);
    });

    test("ignores HTML comments with <!--", () => {
      const content = `
        <!-- <script>const DSN = "https://abc123@o123.ingest.sentry.io/456";</script> -->
        <script>const DSN = "https://real@o456.ingest.sentry.io/789";</script>
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://real@o456.ingest.sentry.io/789"]);
    });

    test("ignores C-style block comment lines starting with /*", () => {
      const content = `
        /* const DSN = "https://abc123@o123.ingest.sentry.io/456"; */
        const REAL_DSN = "https://real@o456.ingest.sentry.io/789";
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://real@o456.ingest.sentry.io/789"]);
    });

    test("ignores JSDoc/multi-line comment continuation lines starting with *", () => {
      const content = `
        /**
         * DSN: "https://abc123@o123.ingest.sentry.io/456"
         */
        const REAL_DSN = "https://real@o456.ingest.sentry.io/789";
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://real@o456.ingest.sentry.io/789"]);
    });

    test("ignores SQL comments with --", () => {
      const content = `
        -- INSERT INTO config VALUES ('dsn', 'https://abc123@o123.ingest.sentry.io/456');
        INSERT INTO config VALUES ('dsn', 'https://real@o456.ingest.sentry.io/789');
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://real@o456.ingest.sentry.io/789"]);
    });

    test("ignores Python triple-quote docstrings", () => {
      const content = `
        '''https://abc123@o123.ingest.sentry.io/456'''
        DSN = "https://real@o456.ingest.sentry.io/789"
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://real@o456.ingest.sentry.io/789"]);
    });

    test("returns empty array for content without DSNs", () => {
      const content = `
        const config = { debug: true };
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual([]);
    });

    test("only accepts *.sentry.io hosts for SaaS", () => {
      const content = `
        const REAL = "https://abc@o123.ingest.sentry.io/456";
        const FAKE = "https://abc@fake.example.com/456";
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://abc@o123.ingest.sentry.io/456"]);
    });

    test("accepts self-hosted DSNs when SENTRY_URL is set", () => {
      process.env.SENTRY_URL = "https://sentry.mycompany.com:9000";
      const content = `
        const DSN = "https://abc@sentry.mycompany.com:9000/123";
      `;
      const dsns = extractDsnsFromContent(content);
      expect(dsns).toEqual(["https://abc@sentry.mycompany.com:9000/123"]);
    });

    test("rejects SaaS DSNs when SENTRY_URL is set (self-hosted mode)", () => {
      process.env.SENTRY_URL = "https://sentry.mycompany.com:9000";
      const content = `
        const SAAS_DSN = "https://abc@o123.ingest.sentry.io/456";
        const SELF_HOSTED_DSN = "https://def@sentry.mycompany.com:9000/789";
      `;
      const dsns = extractDsnsFromContent(content);
      // Only the self-hosted DSN should be accepted
      expect(dsns).toEqual(["https://def@sentry.mycompany.com:9000/789"]);
    });

    test("throws ConfigError when SENTRY_URL is invalid", () => {
      process.env.SENTRY_URL = "not-a-valid-url";
      const content = `
        const SAAS_DSN = "https://abc@o123.ingest.sentry.io/456";
      `;

      // Invalid SENTRY_URL should throw immediately since nothing will work
      expect(() => extractDsnsFromContent(content)).toThrow(
        /SENTRY_URL.*not a valid URL/
      );
    });
  });

  describe("extractFirstDsnFromContent", () => {
    test("returns first DSN", () => {
      const content = `
        const DSN1 = "https://first@o123.ingest.sentry.io/111";
        const DSN2 = "https://second@o456.ingest.sentry.io/222";
      `;
      const dsn = extractFirstDsnFromContent(content);
      expect(dsn).toBe("https://first@o123.ingest.sentry.io/111");
    });

    test("returns null when no DSN found", () => {
      const dsn = extractFirstDsnFromContent("no dsn here");
      expect(dsn).toBeNull();
    });
  });

  describe("scanCodeForFirstDsn", () => {
    test("finds DSN in root file", async () => {
      writeFileSync(
        join(testDir, "config.ts"),
        'const DSN = "https://abc@o123.ingest.sentry.io/456";'
      );

      const result = await scanCodeForFirstDsn(testDir);
      expect(result?.raw).toBe("https://abc@o123.ingest.sentry.io/456");
      expect(result?.source).toBe("code");
      expect(result?.sourcePath).toBe("config.ts");
    });

    test("finds DSN in subdirectory", async () => {
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(
        join(testDir, "src/sentry.ts"),
        'Sentry.init({ dsn: "https://abc@o123.ingest.sentry.io/456" });'
      );

      const result = await scanCodeForFirstDsn(testDir);
      expect(result?.raw).toBe("https://abc@o123.ingest.sentry.io/456");
      expect(result?.sourcePath).toBe("src/sentry.ts");
    });

    test("returns null when no DSN found", async () => {
      writeFileSync(join(testDir, "index.ts"), "console.log('hello');");

      const result = await scanCodeForFirstDsn(testDir);
      expect(result).toBeNull();
    });

    test("skips node_modules directory", async () => {
      mkdirSync(join(testDir, "node_modules/some-package"), {
        recursive: true,
      });
      writeFileSync(
        join(testDir, "node_modules/some-package/index.js"),
        'const DSN = "https://abc@o123.ingest.sentry.io/456";'
      );

      const result = await scanCodeForFirstDsn(testDir);
      expect(result).toBeNull();
    });

    test("respects gitignore", async () => {
      writeFileSync(join(testDir, ".gitignore"), "ignored/");
      mkdirSync(join(testDir, "ignored"), { recursive: true });
      writeFileSync(
        join(testDir, "ignored/config.ts"),
        'const DSN = "https://ignored@o123.ingest.sentry.io/456";'
      );
      writeFileSync(
        join(testDir, "real.ts"),
        'const DSN = "https://real@o456.ingest.sentry.io/789";'
      );

      const result = await scanCodeForFirstDsn(testDir);
      expect(result?.raw).toBe("https://real@o456.ingest.sentry.io/789");
    });

    test("infers packagePath for monorepo structure", async () => {
      // Use depth 2 (packages/frontend/sentry.ts) to stay within MAX_SCAN_DEPTH
      mkdirSync(join(testDir, "packages/frontend"), { recursive: true });
      writeFileSync(
        join(testDir, "packages/frontend/sentry.ts"),
        'const DSN = "https://abc@o123.ingest.sentry.io/456";'
      );

      const result = await scanCodeForFirstDsn(testDir);
      expect(result?.packagePath).toBe("packages/frontend");
    });

    test("scans various file types", async () => {
      // Test Python
      writeFileSync(
        join(testDir, "app.py"),
        'sentry_sdk.init(dsn="https://py@o123.ingest.sentry.io/1")'
      );

      let result = await scanCodeForFirstDsn(testDir);
      expect(result?.raw).toBe("https://py@o123.ingest.sentry.io/1");

      // Clean and test Go
      rmSync(join(testDir, "app.py"));
      writeFileSync(
        join(testDir, "main.go"),
        'sentry.Init(sentry.ClientOptions{Dsn: "https://go@o123.ingest.sentry.io/2"})'
      );

      result = await scanCodeForFirstDsn(testDir);
      expect(result?.raw).toBe("https://go@o123.ingest.sentry.io/2");

      // Clean and test Ruby
      rmSync(join(testDir, "main.go"));
      writeFileSync(
        join(testDir, "config.rb"),
        'Sentry.init do |config|\n  config.dsn = "https://rb@o123.ingest.sentry.io/3"\nend'
      );

      result = await scanCodeForFirstDsn(testDir);
      expect(result?.raw).toBe("https://rb@o123.ingest.sentry.io/3");
    });
  });

  describe("scanCodeForDsns", () => {
    test("finds all DSNs across multiple files", async () => {
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(
        join(testDir, "src/frontend.ts"),
        'const DSN = "https://frontend@o123.ingest.sentry.io/111";'
      );
      writeFileSync(
        join(testDir, "src/backend.ts"),
        'const DSN = "https://backend@o456.ingest.sentry.io/222";'
      );

      const results = await scanCodeForDsns(testDir);
      expect(results).toHaveLength(2);

      const dsns = results.map((r) => r.raw);
      expect(dsns).toContain("https://frontend@o123.ingest.sentry.io/111");
      expect(dsns).toContain("https://backend@o456.ingest.sentry.io/222");
    });

    test("deduplicates same DSN from multiple files", async () => {
      writeFileSync(
        join(testDir, "a.ts"),
        'const DSN = "https://same@o123.ingest.sentry.io/456";'
      );
      writeFileSync(
        join(testDir, "b.ts"),
        'const DSN = "https://same@o123.ingest.sentry.io/456";'
      );

      const results = await scanCodeForDsns(testDir);
      expect(results).toHaveLength(1);
    });

    test("returns empty array when no DSNs found", async () => {
      writeFileSync(join(testDir, "index.ts"), "console.log('hello');");

      const results = await scanCodeForDsns(testDir);
      expect(results).toEqual([]);
    });
  });
});
