/**
 * Links into the human-facing upgrade guide.
 *
 * Tasks name their own section. There is no index mapping task ids to
 * anchors, because an index has to be kept in step with a document in another
 * repository. When it drifts, the link 404s while the bookkeeping still
 * passes.
 */

const BASE =
  "https://docs.sentry.io/platforms/javascript/migration/v10-to-v11/";

export function guide(anchor?: string): string {
  return anchor ? `${BASE}#${anchor}` : BASE;
}
