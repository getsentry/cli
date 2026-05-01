/**
 * Tests for custom CA certificate loading and TLS error detection.
 *
 * isTlsCertError is a pure function tested thoroughly here.
 * CA loading tests use temp files and env sandboxing.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  __resetForTests,
  getCustomCaSource,
  getCustomTlsOptions,
  getTlsCertErrorMessage,
  isTlsCertError,
  warnIfSaasWithEnvCa,
} from "../../src/lib/custom-ca.js";
import { setDefaultCaCert } from "../../src/lib/db/defaults.js";
import { useTestConfigDir } from "../helpers.js";

// ---------------------------------------------------------------------------
// isTlsCertError — pure detection tests
// ---------------------------------------------------------------------------

describe("isTlsCertError", () => {
  test("detects 'unable to get local issuer certificate'", () => {
    expect(
      isTlsCertError(new Error("unable to get local issuer certificate"))
    ).toBe(true);
  });

  test("detects 'unable to verify the first certificate'", () => {
    expect(
      isTlsCertError(new Error("unable to verify the first certificate"))
    ).toBe(true);
  });

  test("detects UNABLE_TO_VERIFY_LEAF_SIGNATURE", () => {
    expect(isTlsCertError(new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE"))).toBe(
      true
    );
  });

  test("does NOT detect CERT_HAS_EXPIRED (not a CA trust issue)", () => {
    expect(isTlsCertError(new Error("CERT_HAS_EXPIRED"))).toBe(false);
  });

  test("does NOT detect ERR_TLS_CERT_ALTNAME_INVALID (not a CA trust issue)", () => {
    expect(isTlsCertError(new Error("ERR_TLS_CERT_ALTNAME_INVALID"))).toBe(
      false
    );
  });

  test("detects DEPTH_ZERO_SELF_SIGNED_CERT", () => {
    expect(isTlsCertError(new Error("DEPTH_ZERO_SELF_SIGNED_CERT"))).toBe(true);
  });

  test("detects SELF_SIGNED_CERT_IN_CHAIN", () => {
    expect(isTlsCertError(new Error("SELF_SIGNED_CERT_IN_CHAIN"))).toBe(true);
  });

  test("detects pattern within larger message", () => {
    expect(
      isTlsCertError(
        new Error(
          "request to https://sentry.io failed, reason: unable to get local issuer certificate"
        )
      )
    ).toBe(true);
  });

  test("returns false for non-TLS errors", () => {
    expect(isTlsCertError(new Error("ECONNREFUSED"))).toBe(false);
    expect(isTlsCertError(new Error("fetch failed"))).toBe(false);
    expect(isTlsCertError(new Error("timeout"))).toBe(false);
    expect(isTlsCertError(new Error("network error"))).toBe(false);
  });

  test("getTlsCertErrorMessage extracts root cause from wrapped error", () => {
    const cause = new Error("unable to get local issuer certificate");
    const wrapper = new TypeError("fetch failed");
    wrapper.cause = cause;
    expect(getTlsCertErrorMessage(wrapper)).toBe(
      "unable to get local issuer certificate"
    );
  });

  test("getTlsCertErrorMessage returns undefined for non-TLS errors", () => {
    expect(getTlsCertErrorMessage(new Error("ECONNREFUSED"))).toBeUndefined();
  });

  test("detects TLS error wrapped in error.cause (Node.js fetch pattern)", () => {
    const cause = new Error("unable to get local issuer certificate");
    const wrapper = new TypeError("fetch failed");
    wrapper.cause = cause;
    expect(isTlsCertError(wrapper)).toBe(true);
  });

  test("detects deeply nested error.cause chain", () => {
    const root = new Error("SELF_SIGNED_CERT_IN_CHAIN");
    const mid = new Error("request failed");
    mid.cause = root;
    const outer = new TypeError("fetch failed");
    outer.cause = mid;
    expect(isTlsCertError(outer)).toBe(true);
  });

  test("returns false for non-TLS error.cause", () => {
    const cause = new Error("ECONNREFUSED");
    const wrapper = new TypeError("fetch failed");
    wrapper.cause = cause;
    expect(isTlsCertError(wrapper)).toBe(false);
  });

  test("returns false for non-Error values", () => {
    expect(isTlsCertError("unable to get local issuer certificate")).toBe(
      false
    );
    expect(isTlsCertError(null)).toBe(false);
    expect(isTlsCertError(undefined)).toBe(false);
    expect(isTlsCertError(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CA loading — requires DB + env sandboxing
// ---------------------------------------------------------------------------

describe("custom CA loading", () => {
  const getConfigDir = useTestConfigDir("custom-ca-");
  const CERT_PEM =
    "-----BEGIN CERTIFICATE-----\nMIIBxyz...\n-----END CERTIFICATE-----\n";

  let savedNodeExtra: string | undefined;
  let savedSslCert: string | undefined;

  beforeEach(() => {
    __resetForTests();
    savedNodeExtra = process.env.NODE_EXTRA_CA_CERTS;
    savedSslCert = process.env.SSL_CERT_FILE;
    delete process.env.NODE_EXTRA_CA_CERTS;
    delete process.env.SSL_CERT_FILE;
  });

  afterEach(() => {
    if (savedNodeExtra !== undefined) {
      process.env.NODE_EXTRA_CA_CERTS = savedNodeExtra;
    } else {
      delete process.env.NODE_EXTRA_CA_CERTS;
    }
    if (savedSslCert !== undefined) {
      process.env.SSL_CERT_FILE = savedSslCert;
    } else {
      delete process.env.SSL_CERT_FILE;
    }
  });

  test("returns undefined when no CAs configured", async () => {
    const result = await getCustomTlsOptions();
    expect(result).toBeUndefined();
    expect(getCustomCaSource()).toBe("none");
  });

  test("loads CA from stored default (highest priority)", async () => {
    const certPath = join(getConfigDir(), "ca.pem");
    writeFileSync(certPath, CERT_PEM);
    setDefaultCaCert(certPath);

    const result = await getCustomTlsOptions();
    expect(result).toBeDefined();
    expect(result?.tls.ca).toBe(CERT_PEM);
    expect(getCustomCaSource()).toBe("default");
  });

  test("loads CA from NODE_EXTRA_CA_CERTS", async () => {
    const certPath = join(getConfigDir(), "extra-ca.pem");
    writeFileSync(certPath, CERT_PEM);
    process.env.NODE_EXTRA_CA_CERTS = certPath;

    const result = await getCustomTlsOptions();
    expect(result).toBeDefined();
    expect(result?.tls.ca).toBe(CERT_PEM);
    expect(getCustomCaSource()).toBe("env");
  });

  test("loads CA from SSL_CERT_FILE as fallback", async () => {
    const certPath = join(getConfigDir(), "ssl-cert.pem");
    writeFileSync(certPath, CERT_PEM);
    process.env.SSL_CERT_FILE = certPath;

    const result = await getCustomTlsOptions();
    expect(result).toBeDefined();
    expect(result?.tls.ca).toBe(CERT_PEM);
    expect(getCustomCaSource()).toBe("env");
  });

  test("stored default takes priority over env vars", async () => {
    const defaultPath = join(getConfigDir(), "default-ca.pem");
    const envPath = join(getConfigDir(), "env-ca.pem");
    writeFileSync(defaultPath, CERT_PEM);
    writeFileSync(
      envPath,
      "-----BEGIN CERTIFICATE-----\nDIFFERENT\n-----END CERTIFICATE-----\n"
    );
    setDefaultCaCert(defaultPath);
    process.env.NODE_EXTRA_CA_CERTS = envPath;

    const result = await getCustomTlsOptions();
    expect(result?.tls.ca).toBe(CERT_PEM);
    expect(getCustomCaSource()).toBe("default");
  });

  test("NODE_EXTRA_CA_CERTS takes priority over SSL_CERT_FILE", async () => {
    const extraPath = join(getConfigDir(), "extra.pem");
    const sslPath = join(getConfigDir(), "ssl.pem");
    writeFileSync(extraPath, CERT_PEM);
    writeFileSync(
      sslPath,
      "-----BEGIN CERTIFICATE-----\nSSL\n-----END CERTIFICATE-----\n"
    );
    process.env.NODE_EXTRA_CA_CERTS = extraPath;
    process.env.SSL_CERT_FILE = sslPath;

    const result = await getCustomTlsOptions();
    expect(result?.tls.ca).toBe(CERT_PEM);
  });

  test("returns undefined when cert file does not exist", async () => {
    process.env.NODE_EXTRA_CA_CERTS = "/nonexistent/path/ca.pem";

    const result = await getCustomTlsOptions();
    expect(result).toBeUndefined();
    expect(getCustomCaSource()).toBe("none");
  });

  test("returns undefined when cert file is not valid PEM", async () => {
    const certPath = join(getConfigDir(), "not-pem.txt");
    writeFileSync(certPath, "this is not a PEM file");
    process.env.NODE_EXTRA_CA_CERTS = certPath;

    const result = await getCustomTlsOptions();
    expect(result).toBeUndefined();
    expect(getCustomCaSource()).toBe("none");
  });

  test("caches result across calls", async () => {
    const certPath = join(getConfigDir(), "cached.pem");
    writeFileSync(certPath, CERT_PEM);
    process.env.NODE_EXTRA_CA_CERTS = certPath;

    const first = await getCustomTlsOptions();
    // Even if env var changes, cached result stays
    process.env.NODE_EXTRA_CA_CERTS = "/different/path";
    const second = await getCustomTlsOptions();
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// SaaS warning
// ---------------------------------------------------------------------------

describe("warnIfSaasWithEnvCa", () => {
  const getConfigDir = useTestConfigDir("saas-warn-");
  const CERT_PEM =
    "-----BEGIN CERTIFICATE-----\nMIIBxyz...\n-----END CERTIFICATE-----\n";

  let savedNodeExtra: string | undefined;

  beforeEach(() => {
    __resetForTests();
    savedNodeExtra = process.env.NODE_EXTRA_CA_CERTS;
    delete process.env.NODE_EXTRA_CA_CERTS;
    delete process.env.SSL_CERT_FILE;
  });

  afterEach(() => {
    if (savedNodeExtra !== undefined) {
      process.env.NODE_EXTRA_CA_CERTS = savedNodeExtra;
    } else {
      delete process.env.NODE_EXTRA_CA_CERTS;
    }
  });

  test("does not warn for stored default CAs targeting SaaS", async () => {
    const certPath = join(getConfigDir(), "ca.pem");
    writeFileSync(certPath, CERT_PEM);
    setDefaultCaCert(certPath);
    await getCustomTlsOptions();

    // Should not throw or warn — source is "default" not "env"
    warnIfSaasWithEnvCa("https://us.sentry.io/api/0/organizations/");
    expect(getCustomCaSource()).toBe("default");
  });

  test("does not warn for env CAs targeting self-hosted", async () => {
    const certPath = join(getConfigDir(), "ca.pem");
    writeFileSync(certPath, CERT_PEM);
    process.env.NODE_EXTRA_CA_CERTS = certPath;
    await getCustomTlsOptions();

    // Self-hosted URL — no warning
    warnIfSaasWithEnvCa("https://sentry.example.com/api/0/");
    expect(getCustomCaSource()).toBe("env");
  });
});
