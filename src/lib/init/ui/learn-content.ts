/**
 * Educational Content Sequence
 *
 * Content blocks shown in the sidebar while the wizard runs. Each
 * block reveals line by line on a timer, transforming dead wait time
 * into product education. After all blocks complete, the panel falls
 * back to the rotating tip cards.
 */

export type ContentBlock = {
  title: string;
  lines: string[];
  /** Dwell time (ms) after all lines are revealed before advancing. */
  pauseMs: number;
};

export const LEARN_SEQUENCE: ContentBlock[] = [
  {
    title: "How Sentry Works",
    lines: [
      "Your App  →  SDK  →  Sentry",
      "",
      "The SDK captures errors, traces,",
      "and performance data from your",
      "running application and sends",
      "them to Sentry for analysis.",
    ],
    pauseMs: 4000,
  },
  {
    title: "Error Tracking",
    lines: [
      "Every crash is captured with:",
      "  • Stack trace",
      "  • Breadcrumbs (user actions)",
      "  • Device/browser context",
      "  • Release & commit info",
      "",
      "Errors are grouped into issues",
      "so you fix root causes, not",
      "individual reports.",
    ],
    pauseMs: 4000,
  },
  {
    title: "Performance Monitoring",
    lines: [
      "Traces show the full journey:",
      "",
      "  Request ─┬─ DB Query (120ms)",
      "           ├─ API Call (340ms)",
      "           └─ Render  (80ms)",
      "",
      "Find the slow piece without",
      "adding manual timers.",
    ],
    pauseMs: 4000,
  },
  {
    title: "Session Replay",
    lines: [
      "See exactly what the user saw:",
      "  DOM mutations, clicks,",
      "  network calls, and console",
      "  logs — all synced with your",
      "  error timeline.",
      "",
      "Debug by scrubbing a video,",
      "not guessing from a stack trace.",
    ],
    pauseMs: 4000,
  },
  {
    title: "Alerts & Integrations",
    lines: [
      "Get notified when it matters:",
      "  • Spike in error frequency",
      "  • New issue after deploy",
      "  • Slow transaction p95",
      "",
      "Routes to Slack, PagerDuty,",
      "Jira, or email automatically.",
    ],
    pauseMs: 4000,
  },
  {
    title: "What's Next?",
    lines: [
      "After this wizard finishes:",
      "",
      "  sentry issue list",
      "    → see your first errors",
      "",
      "  sentry issue explain <id>",
      "    → AI root-cause analysis",
      "",
      "  sentry trace list",
      "    → explore performance data",
    ],
    pauseMs: 5000,
  },
];
