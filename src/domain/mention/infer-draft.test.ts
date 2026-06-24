import { describe, expect, it } from "vitest";
import { tryInferMentionDraftWithoutAi } from "./infer-draft";

describe("tryInferMentionDraftWithoutAi", () => {
  const today = "2026-06-24";

  it("returns draft for high-confidence patterns without AI", () => {
    expect(tryInferMentionDraftWithoutAi("来週月曜休み", today)).toEqual({
      startDate: "2026-06-29",
      endDate: "2026-06-29",
      note: "休み"
    });
    expect(tryInferMentionDraftWithoutAi("6/25〜6/27 旅行", today)).toEqual({
      startDate: "2026-06-25",
      endDate: "2026-06-27",
      note: "旅行"
    });
  });

  it("returns undefined for low-confidence or unparseable text", () => {
    expect(tryInferMentionDraftWithoutAi("明日 通院", today)).toBeUndefined();
    expect(tryInferMentionDraftWithoutAi("来週は旅行なので不在です", today)).toBeUndefined();
  });

  it("returns undefined for past ISO high-confidence ranges", () => {
    expect(tryInferMentionDraftWithoutAi("2026-01-01から2026-01-05まで 休み", "2026-06-24")).toBeUndefined();
  });
});
