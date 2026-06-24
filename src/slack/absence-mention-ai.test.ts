import { describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { debugAbsenceMentionAi, runAbsenceMentionAi } from "./absence-mention-ai";

const baseConfig = createTestConfig(createMockKv(), { adminUserIds: [] });

describe("absence-mention-ai", () => {
  it("runAbsenceMentionAi returns error when AI binding is missing and infer cannot resolve", async () => {
    const result = await runAbsenceMentionAi(baseConfig, "2026-06-24", "午後から休みます 子供の行事");
    expect(result.error?.message).toBe("Workers AI binding is not configured");
  });

  it("runAbsenceMentionAi skips AI for high-confidence infer", async () => {
    const aiRun = vi.fn();
    const config = { ...baseConfig, ai: { run: aiRun } as unknown as Ai };

    const result = await runAbsenceMentionAi(config, "2026-06-24", "来週月曜休み");

    expect(result.skippedInfer).toBe(true);
    expect(result.draft).toEqual({
      startDate: "2026-06-29",
      endDate: "2026-06-29",
      note: "休み",
      dateInterpretationHint: "来週の月曜日で解釈しました"
    });
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("runAbsenceMentionAi skips AI for today and tomorrow", async () => {
    const aiRun = vi.fn();
    const config = { ...baseConfig, ai: { run: aiRun } as unknown as Ai };

    const result = await runAbsenceMentionAi(config, "2026-06-24", "明日 通院");

    expect(result.skippedInfer).toBe(true);
    expect(result.draft?.startDate).toBe("2026-06-25");
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("runAbsenceMentionAi calls AI for low-confidence text", async () => {
    const aiRun = vi.fn(async () => ({
      response: {
        startDate: "2026-06-25",
        endDate: "2026-06-25",
        note: "子供の行事"
      }
    }));
    const config = { ...baseConfig, ai: { run: aiRun } as unknown as Ai };

    const result = await runAbsenceMentionAi(config, "2026-06-24", "午後から休みます 子供の行事");

    expect(result.skippedInfer).toBeUndefined();
    expect(result.draft?.note).toBe("子供の行事");
    expect(aiRun).toHaveBeenCalled();
  });

  it("debugAbsenceMentionAi enriches note from user text via infer skip", async () => {
    const aiRun = vi.fn();
    const config = { ...baseConfig, ai: { run: aiRun } as unknown as Ai };

    const result = await debugAbsenceMentionAi(config, {
      text: "明日 通院のため午後から",
      todayJst: "2026-06-24"
    });

    expect(result.ok).toBe(true);
    expect(result.skippedInfer).toBe(true);
    expect(result.draft).toEqual({
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      note: "通院のため午後から",
      dateInterpretationHint: "明日で解釈しました"
    });
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("debugAbsenceMentionAi skips AI when infer resolves high-confidence text", async () => {
    const aiRun = vi.fn();
    const config = { ...baseConfig, ai: { run: aiRun } as unknown as Ai };

    const result = await debugAbsenceMentionAi(config, {
      text: "明後日から2日間休み",
      todayJst: "2026-06-24"
    });

    expect(result.ok).toBe(true);
    expect(result.skippedInfer).toBe(true);
    expect(result.draft).toEqual({
      startDate: "2026-06-26",
      endDate: "2026-06-27",
      note: "休み",
      dateInterpretationHint: "明後日から2日間で解釈しました"
    });
    expect(aiRun).not.toHaveBeenCalled();
  });
});
