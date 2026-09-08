import type { Event, EventHint } from "@sentry/types";

export function scrub(event: Event, _hint: EventHint): Event {
  return event;
}
