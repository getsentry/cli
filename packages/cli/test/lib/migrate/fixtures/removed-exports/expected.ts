// TODO(sentry-javascript-v11): `SentrySpanProcessor` was removed: export your own OpenTelemetry spans over OTLP using `Sentry.getOtlpTracesEndpoint()` instead
// TODO(sentry-javascript-v11): `SentrySampler` was removed: export your own OpenTelemetry spans over OTLP using `Sentry.getOtlpTracesEndpoint()` instead
import { SentrySpanProcessor, SentrySampler } from "@sentry/opentelemetry";
// TODO(sentry-javascript-v11): `generateInstrumentOnce` was removed: it wrapped OpenTelemetry's `registerInstrumentations` and is no longer needed
import { generateInstrumentOnce } from "@sentry/node";
import { captureException } from "@sentry/core";

export { SentrySpanProcessor, SentrySampler, generateInstrumentOnce, captureException };
