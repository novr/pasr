import { describe, expect, it } from "vitest";
import {
  MENTION_AI_INFER_CASES,
  MENTION_AI_INTEGRATION_TODAY
} from "../domain/mention/mention-ai-cases";
import {
  buildAbsenceMentionPrompt,
  buildMentionConfirmPayload,
  enrichMentionDraft,
  enrichMentionDraftDates,
  enrichMentionDraftNote,
  hasAmbiguousMentionDateExpressions,
  inferMentionDateRange,
  MENTION_NOTE_MAX_LEN,
  parseAbsenceMentionAiResponse,
  parseAbsenceMentionFromAiRun,
  parseMentionConfirmPayload,
  stripAppMentionText,
  stripDateExpressionsFromMentionText
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

  it("parseAbsenceMentionAiResponse recovers dates from malformed JSON", () => {
    expect(
      parseAbsenceMentionAiResponse(
        '{"endDate":"2026-07-03","note":"旅行","startDate":"2026-06-29"'
      )
    ).toEqual({
      startDate: "2026-06-29",
      endDate: "2026-07-03",
      note: "旅行"
    });
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

  it("stripDateExpressionsFromMentionText removes date phrases", () => {
    expect(stripDateExpressionsFromMentionText("明日 通院のため午後から")).toBe("通院のため午後から");
    expect(stripDateExpressionsFromMentionText("明後日から2日間休み")).toBe("休み");
    expect(stripDateExpressionsFromMentionText("来週月曜休み")).toBe("休み");
    expect(stripDateExpressionsFromMentionText("来週は旅行なので不在です")).toBe("旅行なので不在です");
    expect(stripDateExpressionsFromMentionText("6/25〜6/27 旅行")).toBe("旅行");
    expect(stripDateExpressionsFromMentionText("2026-06-25から2026-06-27まで出張")).toBe("出張");
  });

  it("inferMentionDateRange resolves relative and weekday expressions", () => {
    const today = "2026-06-24";
    expect(inferMentionDateRange("明日 通院", today)).toEqual({
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      confidence: "high",
      interpretationHint: "明日で解釈しました"
    });
    expect(inferMentionDateRange("明後日から2日間休み", today)).toEqual({
      startDate: "2026-06-26",
      endDate: "2026-06-27",
      confidence: "high",
      interpretationHint: "明後日から2日間で解釈しました"
    });
    expect(inferMentionDateRange("来週月曜休み", today)).toEqual({
      startDate: "2026-06-29",
      endDate: "2026-06-29",
      confidence: "high",
      interpretationHint: "来週の月曜日で解釈しました"
    });
    expect(inferMentionDateRange("今週金曜 午後から", today)).toEqual({
      startDate: "2026-06-26",
      endDate: "2026-06-26",
      confidence: "high",
      interpretationHint: "今週の金曜日で解釈しました"
    });
    expect(inferMentionDateRange("来週は旅行なので不在です", today)).toEqual({
      startDate: "2026-06-28",
      endDate: "2026-07-04",
      confidence: "high",
      interpretationHint: "来週（日曜〜土曜）で解釈しました"
    });
    expect(inferMentionDateRange("6/25〜6/27 旅行", today)).toEqual({
      startDate: "2026-06-25",
      endDate: "2026-06-27",
      confidence: "high"
    });
  });

  it("inferMentionDateRange uses Sunday-start week (Labor Standards Act)", () => {
    const sunday = "2026-06-21";
    expect(inferMentionDateRange("来週月曜休み", sunday)).toEqual({
      startDate: "2026-06-29",
      endDate: "2026-06-29",
      confidence: "high",
      interpretationHint: "来週の月曜日で解釈しました"
    });
    expect(inferMentionDateRange("今週日曜休み", sunday)).toEqual({
      startDate: "2026-06-21",
      endDate: "2026-06-21",
      confidence: "high",
      interpretationHint: "今週の日曜日で解釈しました"
    });
  });

  it("inferMentionDateRange rolls past month/day to next year", () => {
    expect(inferMentionDateRange("1/5 休み", "2026-12-25")).toEqual({
      startDate: "2027-01-05",
      endDate: "2027-01-05",
      confidence: "low",
      interpretationHint: "1/5 を翌年として解釈しました"
    });
    expect(inferMentionDateRange("12/28〜1/3 旅行", "2026-12-20")).toEqual({
      startDate: "2026-12-28",
      endDate: "2027-01-03",
      confidence: "high"
    });
  });

  it("inferMentionDateRange bumps passed 今週 weekday to next week", () => {
    expect(inferMentionDateRange("今週月曜休み", "2026-06-24")).toEqual({
      startDate: "2026-06-29",
      endDate: "2026-06-29",
      confidence: "high",
      interpretationHint: "今週の月曜日（過ぎていたため翌週）で解釈しました"
    });
  });

  it("hasAmbiguousMentionDateExpressions detects mixed relative and weekday phrases", () => {
    expect(hasAmbiguousMentionDateExpressions("来週の金曜は休むけど、登録は明日から")).toBe(true);
    expect(hasAmbiguousMentionDateExpressions("明日 通院")).toBe(false);
  });

  it.each(MENTION_AI_INFER_CASES)("infer integration cases $id", (testCase) => {
    const wrongDraft = {
      startDate: "2099-01-01",
      endDate: "2099-01-01",
      note: ""
    };
    const enriched = enrichMentionDraft(testCase.text, MENTION_AI_INTEGRATION_TODAY, wrongDraft);
    expect(enriched.startDate).toBe(testCase.expect.startDate);
    expect(enriched.endDate).toBe(testCase.expect.endDate);
    if (testCase.expect.noteExact) {
      expect(enriched.note).toBe(testCase.expect.noteExact);
    }
    if (testCase.expect.noteIncludes) {
      expect(enriched.note).toContain(testCase.expect.noteIncludes);
    }
  });

  it("enrichMentionDraftDates overrides low-confidence dates only on AI mismatch", () => {
    const today = "2026-06-24";
    const matchingAi = { startDate: "2026-06-25", endDate: "2026-06-25", note: "通院" };
    expect(enrichMentionDraftDates("明日 通院", today, matchingAi)).toEqual({
      ...matchingAi,
      dateInterpretationHint: "明日で解釈しました"
    });

    const wrongAi = { startDate: "2026-06-24", endDate: "2026-06-24" };
    expect(enrichMentionDraftDates("明日 通院", today, wrongAi)).toEqual({
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      dateInterpretationHint: "明日で解釈しました"
    });
  });

  it("enrichMentionDraftDates does not infer ambiguous multi-date text", () => {
    const today = "2026-06-24";
    const aiDraft = { startDate: "2026-06-29", endDate: "2026-06-29", note: "休み" };
    expect(
      enrichMentionDraftDates("来週の金曜は休むけど、登録は明日から", today, aiDraft)
    ).toEqual(aiDraft);
  });

  it("enrichMentionDraft corrects AI date drift and empty note", () => {
    const today = "2026-06-24";
    const wrongDraft = { startDate: "2026-06-25", endDate: "2026-06-27", note: "" };
    expect(enrichMentionDraft("明後日から2日間休み", today, wrongDraft)).toEqual({
      startDate: "2026-06-26",
      endDate: "2026-06-27",
      note: "休み",
      dateInterpretationHint: "明後日から2日間で解釈しました"
    });
    expect(
      enrichMentionDraft("今週金曜 午後から", today, {
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        note: "今週金曜 午後から"
      })
    ).toEqual({
      startDate: "2026-06-26",
      endDate: "2026-06-26",
      note: "午後から",
      dateInterpretationHint: "今週の金曜日で解釈しました"
    });
  });

  it("enrichMentionDraftNote infers note when AI leaves it empty", () => {
    const draft = { startDate: "2026-06-25", endDate: "2026-06-25" };
    expect(enrichMentionDraftNote("明日 通院のため午後から", draft)).toEqual({
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      note: "通院のため午後から"
    });
    expect(enrichMentionDraftNote("明日 午前中 子供の行事", draft)).toEqual({
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      note: "午前中 子供の行事"
    });
    expect(
      enrichMentionDraftNote("今日 午前通院", {
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        note: "午前通院"
      })
    ).toEqual({
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      note: "午前通院"
    });
    expect(
      enrichMentionDraftNote("今週金曜 午後から", {
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        note: "今週金曜 午後から"
      })
    ).toEqual({
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      note: "午後から"
    });
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
