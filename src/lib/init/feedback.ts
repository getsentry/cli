export type InitFeedbackOutcome = "success" | "cancelled" | "failed";

const FEEDBACK_COMMANDS: Record<InitFeedbackOutcome, string> = {
  success: '$ sentry cli feedback "sentry init worked well"',
  cancelled: '$ sentry cli feedback "sentry init was cancelled"',
  failed: '$ sentry cli feedback "sentry init failed"',
};

const FEEDBACK_COPY: Record<InitFeedbackOutcome, string[]> = {
  success: [
    "Nice, setup made it through.",
    "Tell us what felt great or rough:\n",
  ],
  cancelled: [
    "Sad to see setup stop. Was something going sideways?",
    "Tell us so we can fix it:\n",
  ],
  failed: ["Setup hit a wall.", "Tell us what happened so we can fix it:\n"],
};

export function formatFeedbackHint(outcome: InitFeedbackOutcome): string {
  return [...FEEDBACK_COPY[outcome], FEEDBACK_COMMANDS[outcome]].join("\n");
}
