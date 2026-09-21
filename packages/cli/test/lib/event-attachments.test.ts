/**
 * Event attachment helper tests.
 */

import type { EventAttachmentDetailsResponse } from "@sentry/api";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/lib/api-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/api-client.js")>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [
      k,
      typeof v === "function" ? vi.fn(v) : v,
    ])
  );
});

// biome-ignore lint/performance/noNamespaceImport: needed for vi.mocked access
import * as apiClient from "../../src/lib/api-client.js";
import {
  attachmentDownloadHint,
  attachmentDownloadPath,
  eventProjectSlug,
  formatEventAttachments,
  jsonEventAttachments,
  tryListEventAttachments,
} from "../../src/lib/event-attachments.js";
import type { SentryEvent } from "../../src/types/index.js";

const ATTACHMENT: EventAttachmentDetailsResponse = {
  id: "attachment-1",
  event_id: "abc123def456abc123def456abc123de",
  type: "event.attachment",
  name: "screenshot.png",
  mimetype: "image/png",
  dateCreated: "2026-07-16T12:00:00Z",
  size: 2048,
  headers: {},
  sha1: null,
};

describe("eventProjectSlug", () => {
  test("reads projectSlug", () => {
    expect(
      eventProjectSlug({
        eventID: "abc",
        projectSlug: "frontend",
      } as SentryEvent)
    ).toBe("frontend");
  });

  test("reads nested project.slug", () => {
    expect(
      eventProjectSlug({
        eventID: "abc",
        project: { slug: "frontend" },
      } as SentryEvent)
    ).toBe("frontend");
  });

  test("reads string project", () => {
    expect(
      eventProjectSlug({
        eventID: "abc",
        project: "frontend",
      } as SentryEvent)
    ).toBe("frontend");
  });

  test("returns undefined when absent", () => {
    expect(eventProjectSlug({ eventID: "abc" } as SentryEvent)).toBeUndefined();
  });
});

describe("attachmentDownloadPath", () => {
  test("builds the sentry api download path", () => {
    expect(attachmentDownloadPath("acme", "frontend", "evt1", "att1")).toBe(
      "projects/acme/frontend/events/evt1/attachments/att1/?download=1"
    );
  });
});

describe("jsonEventAttachments", () => {
  test("adds download when org and project are known", () => {
    expect(
      jsonEventAttachments("acme", "frontend", "evt1", [ATTACHMENT])
    ).toEqual([
      {
        ...ATTACHMENT,
        download:
          "projects/acme/frontend/events/evt1/attachments/attachment-1/?download=1",
      },
    ]);
  });

  test("omits download without project", () => {
    expect(
      jsonEventAttachments("acme", undefined, "evt1", [ATTACHMENT])
    ).toEqual([{ ...ATTACHMENT }]);
  });
});

describe("formatEventAttachments", () => {
  test("returns empty string when there are no attachments", () => {
    expect(formatEventAttachments([])).toBe("");
  });

  test("renders name, size, and id", () => {
    const output = formatEventAttachments([ATTACHMENT]);
    expect(output).toContain("Attachments");
    expect(output).toContain("screenshot.png");
    expect(output).toContain("2.0 KB");
    expect(output).toContain("attachment-1");
  });
});

describe("attachmentDownloadHint", () => {
  test("returns undefined without attachments or project", () => {
    expect(attachmentDownloadHint("org", "proj", "evt", [])).toBeUndefined();
    expect(
      attachmentDownloadHint("org", undefined, "evt", [ATTACHMENT])
    ).toBeUndefined();
  });

  test("includes a quoted sentry api command", () => {
    const hint = attachmentDownloadHint("acme", "frontend", "evt1", [
      ATTACHMENT,
      { ...ATTACHMENT, id: "attachment-2", name: "log.txt" },
    ]);
    expect(hint).toContain("sentry api");
    expect(hint).toContain("?download=1");
    expect(hint).toContain("screenshot.png");
    expect(hint).toContain("(1 more)");
  });
});

describe("tryListEventAttachments", () => {
  beforeEach(() => {
    vi.mocked(apiClient.listEventAttachments).mockReset();
  });

  afterEach(() => {
    vi.mocked(apiClient.listEventAttachments).mockReset();
  });

  test("returns [] without a project slug", async () => {
    await expect(
      tryListEventAttachments("org", undefined, "evt")
    ).resolves.toEqual([]);
    expect(apiClient.listEventAttachments).not.toHaveBeenCalled();
  });

  test("returns listed attachments", async () => {
    vi.mocked(apiClient.listEventAttachments).mockResolvedValue([ATTACHMENT]);
    await expect(
      tryListEventAttachments("org", "proj", "evt")
    ).resolves.toEqual([ATTACHMENT]);
    expect(apiClient.listEventAttachments).toHaveBeenCalledWith(
      "org",
      "proj",
      "evt"
    );
  });

  test("returns [] when listing fails", async () => {
    vi.mocked(apiClient.listEventAttachments).mockRejectedValue(
      new Error("attachments unavailable")
    );
    await expect(
      tryListEventAttachments("org", "proj", "evt")
    ).resolves.toEqual([]);
  });
});
