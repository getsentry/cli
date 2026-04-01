/**
 * Dataset constants for the Sentry Events/Explore API
 *
 * Used for validation and documentation. The Events API requires a valid
 * `dataset` query parameter; invalid values cause generic 500 errors.
 */

/** Valid dataset names for the Sentry Events/Explore API (`/events/` endpoint) */
export const EVENTS_API_DATASETS = [
  "spans",
  "transactions",
  "logs",
  "errors",
  "discover",
] as const;

/** Type for Events API dataset values */
export type EventsApiDataset = (typeof EVENTS_API_DATASETS)[number];
