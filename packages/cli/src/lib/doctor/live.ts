/**
 * The one write doctor can perform, and only when asked.
 *
 * Delivery is the real test: if the POST resolves, this machine can reach
 * ingest, which is the only failure mode the other liveness signals cannot
 * see. The search poll is a bonus confirmation, and its absence is a warning
 * rather than a failure — Sentry's index lags, and calling a healthy install
 * broken because of that lag is worse than saying "sent, not yet visible".
 */

import { createEventEnvelope, makeDsn, serializeEnvelope } from "@sentry/core";
import { queryEvents } from "../api/explore.js";
import { sendEnvelopeRequest } from "../envelope/transport.js";
import { logger } from "../logger.js";
import type { Capture, CheckResult, ServerFacts } from "./types.js";

const ID = "live.roundtrip";
// First attempt is immediate; the rest are 2s apart → ~1 min.
const DEFAULT_POLL_ATTEMPTS = 31;
const DEFAULT_POLL_INTERVAL_MS = 2000;

export type LiveOptions = {
  pollAttempts?: number;
  pollIntervalMs?: number;
  /** Injected in tests so the search query is deterministic. */
  nonce?: string;
};

/**
 * A nonce that survives Sentry's search tokenizer and carries no user data.
 * Not crypto — it only has to be unlikely to collide with another probe.
 */
function makeNonce(): string {
  return `dr${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Build the serialized envelope for a probe event, or return a skip result. */
function buildProbeEnvelope(
  rawDsn: string,
  nonce: string
): { body: string | Uint8Array } | CheckResult {
  try {
    const dsnComponents = makeDsn(rawDsn);
    if (!dsnComponents) {
      return {
        id: ID,
        status: "skip",
        detail: `Could not parse DSN: ${rawDsn}`,
      };
    }
    const envelope = createEventEnvelope(
      {
        exception: {
          values: [
            {
              type: "TestError",
              value: `Test event from sentry doctor (${nonce}). Safe to delete.`,
            },
          ],
        },
        level: "error",
        tags: { source: "sentry-cli-doctor", probe: nonce },
        platform: "other",
      },
      dsnComponents
    );
    return { body: serializeEnvelope(envelope) };
  } catch (error) {
    return {
      id: ID,
      status: "skip",
      detail: `Could not build a test event for this DSN: ${(error as Error).message}`,
    };
  }
}

/** Poll the events search for this probe. Returns `true` if found. */
async function pollForEvent(
  org: string,
  project: string,
  nonce: string,
  poll: { attempts: number; intervalMs: number }
): Promise<boolean> {
  const { attempts, intervalMs } = poll;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      await sleep(intervalMs);
    }
    try {
      // Message text, not a custom tag: `probe:` is not searchable until
      // Sentry has indexed that tag key. The nonce is already in the event.
      const page = await queryEvents(org, {
        fields: ["title"],
        dataset: "errors",
        query: `project:${project} ${nonce}`,
        limit: 1,
        statsPeriod: "1h",
      });
      if ((page.data.data ?? []).length > 0) {
        return true;
      }
    } catch (error) {
      logger.debug("Doctor live-check search failed", error);
    }
  }
  return false;
}

function isCheckResult(v: { body?: unknown; id?: unknown }): v is CheckResult {
  return "id" in v;
}

export async function liveRoundtripCheck(
  capture: Capture,
  server: ServerFacts,
  options: LiveOptions = {}
): Promise<CheckResult> {
  const dsn = capture.dsns[0];

  if (!dsn) {
    return {
      id: ID,
      status: "skip",
      detail: "No DSN found, so there is nowhere to send a test event.",
    };
  }

  if (server.dsnMatchesProject === false) {
    return {
      id: ID,
      status: "fail",
      detail:
        "The configured DSN does not match any Sentry project you can access, so a test event would not show up where you can see it.",
      remediation:
        "Confirm the DSN belongs to a project in an organization you are a member of, then copy it again from Settings → Client Keys (DSN).",
    };
  }

  const nonce = options.nonce ?? makeNonce();
  const result = buildProbeEnvelope(dsn.raw, nonce);
  if (isCheckResult(result)) {
    return result;
  }

  try {
    await sendEnvelopeRequest(dsn.raw, result.body);
  } catch (error) {
    return {
      id: ID,
      status: "fail",
      detail: `The test event could not be delivered: ${(error as Error).message}`,
      remediation:
        "This machine cannot reach Sentry's ingest host. Check outbound HTTPS, any corporate proxy, and whether the DSN's host is allowed by your network policy. The same block will stop your application's events.",
    };
  }

  const accepted: CheckResult = {
    id: ID,
    status: "warn",
    detail:
      "The test event was accepted by Sentry but has not appeared in search yet; indexing can lag by a minute.",
  };

  const { org, project } = server;
  if (!(org && project)) {
    return accepted;
  }

  const found = await pollForEvent(org, project, nonce, {
    attempts: options.pollAttempts ?? DEFAULT_POLL_ATTEMPTS,
    intervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  });

  if (found) {
    return {
      id: ID,
      status: "pass",
      detail: `A test event was sent and arrived in ${org}/${project}.`,
    };
  }

  return accepted;
}
