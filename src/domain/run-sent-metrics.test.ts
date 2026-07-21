import { describe, expect, it } from "vitest";
import { formatRunSentForAdmin, formatRunSentForOps } from "./run-sent-metrics";

describe("formatRunSentForAdmin", () => {
  it("shows channel and dm breakdown when available", () => {
    expect(formatRunSentForAdmin({ sent: 3, sentChannels: 2, sentDms: 1 })).toBe(
      "sent=3 (ch=2, dm=1)"
    );
  });

  it("falls back for legacy summaries without breakdown", () => {
    expect(formatRunSentForAdmin({ sent: 3 })).toBe("sent=3 (CH+DM)");
  });
});

describe("formatRunSentForOps", () => {
  it("shows channel and dm breakdown when available", () => {
    expect(formatRunSentForOps({ sent: 3, sentChannels: 2, sentDms: 1 })).toBe(
      "sent_channels=2 sent_dms=1 sent=3"
    );
  });

  it("falls back for legacy input without breakdown", () => {
    expect(formatRunSentForOps({ sent: 1 })).toBe("sent=1");
  });
});
