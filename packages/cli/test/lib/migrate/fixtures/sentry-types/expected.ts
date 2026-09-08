import type { Event, EventHint } from "@sentry/core";

export function scrub(event: Event, _hint: EventHint): Event {
  return event;
}
