import { buildRouteMap } from "../../lib/route-map.js";
import { sendEnvelopeCommand } from "../send-envelope.js";
import { sendEventCommand } from "../send-event.js";

export const sendRoute = buildRouteMap({
  routes: {
    event: sendEventCommand,
    envelope: sendEnvelopeCommand,
  },
  docs: {
    brief: "Send events and envelopes to Sentry via DSN",
    fullDescription:
      "Send data directly to Sentry's ingest pipeline using DSN-based authentication.\n\n" +
      "No `sentry auth login` required — provide a DSN via --dsn or SENTRY_DSN env var.\n\n" +
      "Commands:\n" +
      "  event     Send a Sentry event (from flags or a JSON file)\n" +
      "  envelope  Send a pre-built Sentry envelope file\n\n" +
      "Examples:\n" +
      "  sentry send event -m 'Deploy check' -l info --tag env:prod\n" +
      "  sentry send event ./crash.json\n" +
      "  sentry send envelope ./captured.envelope",
    hideRoute: {},
  },
});
