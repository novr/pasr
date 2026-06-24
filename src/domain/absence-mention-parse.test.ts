import { describe, expect, it } from "vitest";
import {
  buildAbsenceMentionPrompt,
  buildMentionConfirmPayload,
  MENTION_NOTE_MAX_LEN,
  parseAbsenceMentionAiResponse,
  parseAbsenceMentionFromAiRun,
  parseMentionConfirmPayload,
  stripAppMentionText
} from "./absence-mention-parse";

describe("absence-mention-parse", () => {
  it("stripAppMentionText removes mention and trims", () => {
    expect(stripAppMentionText("<@U123> 明日 通院")).toBe("明日 通院");
    expect(stripAppMentionText("<@U123>   ")).toBe("");
    expect(stripAppMentionText("  <@UBOT>  <@UUSER> 午後休  ")).toBe("午後休");
  });

  it("parseAbsenceMentionAiResponse parses JSON and validates dates", () => {
    expect(
      parseAbsenceMentionAiResponse(
        '{"startDate":"2026-06-20","endDate":"2026-06-25","note":"通院"}'
      )
    ).toEqual({
      startDate: "2026-06-20",
      endDate: "2026-06-25",
      note: "通院"
    });
  });

  it("parseAbsenceMentionAiResponse accepts fenced JSON and empty endDate", () => {
    expect(
      parseAbsenceMentionAiResponse(
        '```json\n{"startDate":"2026-06-20","endDate":"","note":""}\n```'
      )
    ).toEqual({
      startDate: "2026-06-20",
      endDate: "2026-06-20"
    });
  });

  it("parseAbsenceMentionAiResponse rejects invalid dates", () => {
    expect(parseAbsenceMentionAiResponse('{"startDate":"2026-13-01","endDate":"2026-06-20"}')).toBeUndefined();
    expect(parseAbsenceMentionAiResponse("not json")).toBeUndefined();
  });

  it("parseAbsenceMentionFromAiRun accepts object response from JSON mode", () => {
    expect(
      parseAbsenceMentionFromAiRun({
        response: {
          startDate: "2026-06-24",
          endDate: "2026-06-24",
          note: "午前通院"
        }
      })
    ).toEqual({
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      note: "午前通院"
    });
  });

  it("parseAbsenceMentionFromAiRun accepts string response", () => {
    expect(
      parseAbsenceMentionFromAiRun({
        response: '{"startDate":"2026-06-24","endDate":"2026-06-24","note":"午前通院"}'
      })
    ).toEqual({
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      note: "午前通院"
    });
  });

  it("parseAbsenceMentionFromAiRun accepts snake_case fields", () => {
    expect(
      parseAbsenceMentionFromAiRun({
        response: {
          start_date: "2026-06-24",
          end_date: "2026-06-24",
          note: "午前通院"
        }
      })
    ).toEqual({
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      note: "午前通院"
    });
  });

  it("parseAbsenceMentionAiResponse truncates long note", () => {
    const longNote = "a".repeat(MENTION_NOTE_MAX_LEN + 10);
    const parsed = parseAbsenceMentionAiResponse(
      JSON.stringify({ startDate: "2026-06-20", endDate: "2026-06-20", note: longNote })
    );
    expect(parsed?.note?.length).toBe(MENTION_NOTE_MAX_LEN);
    expect(parsed?.noteTruncated).toBe(true);
  });

  it("buildAbsenceMentionPrompt includes today and user text", () => {
    const messages = buildAbsenceMentionPrompt("2026-06-23", "明日 休み");
    expect(messages[0]?.content).toContain("2026-06-23");
    expect(messages.at(-1)?.content).toBe("明日 休み");
  });

  it("parseMentionConfirmPayload validates dates and omits absenceListId", () => {
    const value = JSON.stringify(
      buildMentionConfirmPayload({
        userId: "U1",
        channelId: "C1",
        draft: { startDate: "2026-06-25", endDate: "2026-06-25", note: "通院" }
      })
    );
    expect(parseMentionConfirmPayload(value)).toEqual({
      v: 1,
      userId: "U1",
      channelId: "C1",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      note: "通院"
    });
    expect(parseMentionConfirmPayload('{"v":1,"userId":"U1","channelId":"C1","startDate":"2026-99-99","endDate":"2026-06-25"}')).toBeUndefined();
  });
});
