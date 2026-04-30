/**
 * Sentry Tips
 *
 * Curated set of short product facts shown rotating in the sidebar of
 * the Ink sidebar while the wizard runs. Each tip should:
 *
 *   - fit comfortably in ~36 columns (the sidebar width) when wrapped
 *   - mention a concrete capability the user can apply after onboarding
 *   - avoid sales copy — the wizard isn't a marketing surface
 *
 * The runner picks one tip on mount and rotates through the rest on a
 * fixed interval, so the panel feels alive even during long-running
 * tool calls. Tips ARE NOT used by the LoggingUI path.
 */

export type SentryTip = {
  /** Short heading rendered as the section title. */
  title: string;
  /** 1–3 sentences of body text. Plain prose, no markdown. */
  body: string;
};

/**
 * Tip library. Order is the rotation order — keep highest-impact tips
 * first so users who only see the wizard for a few seconds catch them.
 */
export const SENTRY_TIPS: SentryTip[] = [
  {
    title: "Errors → Traces in one click",
    body: "Every error in Sentry is linked to the trace that produced it. From an issue page, jump straight to the full request waterfall to see what slow query or upstream call set off the failure.",
  },
  {
    title: "Session Replay shows the user's view",
    body: "Replay captures DOM mutations, network calls, and console logs alongside your error. Reproducing a bug becomes scrubbing a timeline instead of guessing from a stack trace.",
  },
  {
    title: "Tracing finds the slow piece",
    body: "Performance Monitoring surfaces the spans inside a transaction so you can see whether the database, an HTTP call, or your own code is the bottleneck — without adding manual timers.",
  },
  {
    title: "Alerts on real signals",
    body: "Configure alert rules on issue frequency, regression after release, or trace duration percentiles. Slack, PagerDuty, and email integrations route alerts to the right team automatically.",
  },
  {
    title: "Releases tie deploys to errors",
    body: "Tag every deploy with a release version and Sentry will tell you which commits introduced new issues, which were resolved by a release, and which are still regressing in production.",
  },
  {
    title: "Source maps make stack traces readable",
    body: "Upload source maps with each release (the wizard can set this up for you) and your minified production stack traces resolve back to original TypeScript/JSX line numbers.",
  },
  {
    title: "Cron monitoring catches missed jobs",
    body: "Wrap a scheduled job with Sentry's Crons SDK and get an alert when it fails or doesn't run on time — useful for nightly reports, billing rollups, and ETL pipelines.",
  },
  {
    title: "User Feedback widget",
    body: 'Drop a feedback widget on your site and Sentry attaches user reports directly to the matching error. No more triaging vague "the app broke" tickets without context.',
  },
  {
    title: "Profiling for hot code paths",
    body: "Continuous profiling samples your production code and shows which functions burn the most CPU. Pair with tracing to see exactly which transaction a slow function ran inside.",
  },
  {
    title: "AI Monitoring for LLM apps",
    body: "If your app calls an LLM, Sentry's AI Monitoring surfaces token cost, latency, and failure rate per model and per route. Catch a regression in prompt cost before the bill arrives.",
  },
  {
    title: "Seer: AI-powered debugging",
    body: "Run `sentry issue explain <issue-id>` after this wizard finishes to get an AI root-cause analysis of any error, with a suggested fix and the lines of code most likely responsible.",
  },
  {
    title: "Self-hosted is a flag away",
    body: "Sentry SaaS and self-hosted share the same SDK, the same wire protocol, and the same CLI. Set `SENTRY_URL` to point at your own instance — everything else just works.",
  },
];
