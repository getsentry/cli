/**
 * Feedback formatter tests.
 */

import stringWidth from "string-width";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  formatFeedbackList,
  formatFeedbackView,
} from "../../../src/lib/formatters/feedback.js";
import type { SentryFeedback } from "../../../src/types/index.js";

const originalPlainOutput = process.env.SENTRY_PLAIN_OUTPUT;

function feedback(overrides: Partial<SentryFeedback> = {}): SentryFeedback {
  return {
    id: "1",
    shortId: "WEB-1",
    title: "User Feedback",
    issueCategory: "feedback",
    issueType: "feedback",
    status: "unresolved",
    hasSeen: false,
    firstSeen: "2026-07-16T12:00:00Z",
    project: { id: "1", slug: "web", name: "Web" },
    metadata: { message: "Button | failed\nwith **markdown**" },
    ...overrides,
  };
}

beforeAll(() => {
  process.env.SENTRY_PLAIN_OUTPUT = "1";
});

afterAll(() => {
  if (originalPlainOutput === undefined) {
    delete process.env.SENTRY_PLAIN_OUTPUT;
  } else {
    process.env.SENTRY_PLAIN_OUTPUT = originalPlainOutput;
  }
});

describe("formatFeedbackList", () => {
  test("renders anonymous, unread feedback without breaking the table", () => {
    const output = formatFeedbackList({
      feedback: [feedback()],
      hasMore: false,
      hasPrev: false,
      org: "test-org",
      project: "web",
    });

    expect(output).toContain("Anonymous");
    expect(output).toContain("Unread");
    expect(output).toContain("Button");
  });

  test("maps ignored feedback to Spam and combines name with email", () => {
    const output = formatFeedbackList({
      feedback: [
        feedback({
          status: "ignored",
          hasSeen: true,
          metadata: {
            message: "Spam",
            name: "Ada",
            contact_email: "ada@example.com",
          },
        }),
      ],
      hasMore: false,
      hasPrev: false,
      org: "test-org",
    });

    expect(output).toContain("Ada");
    expect(output).toContain("Spam");
    expect(output).toContain("Read");
  });

  test("does not label an absent read state as unread", () => {
    const output = formatFeedbackList({
      feedback: [feedback({ hasSeen: undefined })],
      hasMore: false,
      hasPrev: false,
      org: "test-org",
    });

    expect(output).toContain("Unknown");
    expect(output).not.toContain("Unread");
  });
});

describe("formatFeedbackView", () => {
  test("escapes message markdown while preserving multiple lines", () => {
    const output = formatFeedbackView({
      org: "test-org",
      feedback: feedback(),
      event: null,
      replayIds: [],
      attachments: [],
    });

    expect(output).toContain("Button | failed");
    expect(output).toContain("with **markdown**");
  });

  test("truncates long list messages but preserves the complete detail message", () => {
    const savedPlain = process.env.SENTRY_PLAIN_OUTPUT;
    const savedColumns = process.stdout.columns;
    const longMessage = `${"Checkout failed ".repeat(20)}\nTAIL **marker**`;
    process.env.SENTRY_PLAIN_OUTPUT = "0";
    process.stdout.columns = 60;

    try {
      const item = feedback({ metadata: { message: longMessage } });
      const listOutput = formatFeedbackList({
        feedback: [item],
        hasMore: false,
        hasPrev: false,
        org: "test-org",
        project: "web",
      });
      const viewOutput = formatFeedbackView({
        org: "test-org",
        feedback: item,
        event: null,
        replayIds: [],
        attachments: [],
      });

      expect(listOutput).toContain("…");
      expect(
        Math.max(...listOutput.split("\n").map((line) => stringWidth(line)))
      ).toBeLessThanOrEqual(60);
      expect(viewOutput).toContain("TAIL **marker**");
    } finally {
      if (savedPlain === undefined) {
        delete process.env.SENTRY_PLAIN_OUTPUT;
      } else {
        process.env.SENTRY_PLAIN_OUTPUT = savedPlain;
      }
      process.stdout.columns = savedColumns;
    }
  });
});
