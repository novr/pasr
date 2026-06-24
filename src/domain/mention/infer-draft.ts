import { inferMentionDateRange } from "./date-infer";
import { enrichMentionDraftNote } from "./enrich";
import type { AbsenceMentionDraft } from "./types";

/** high 信頼度の日付 infer で完結し、かつ登録可能な未来日の場合は Workers AI を呼ばない */
export const tryInferMentionDraftWithoutAi = (
  userText: string,
  todayJst: string
): AbsenceMentionDraft | undefined => {
  const inferred = inferMentionDateRange(userText, todayJst);
  if (!inferred || inferred.confidence !== "high") {
    return undefined;
  }
  if (inferred.startDate < todayJst || inferred.endDate < todayJst) {
    return undefined;
  }
  return enrichMentionDraftNote(userText, {
    startDate: inferred.startDate,
    endDate: inferred.endDate,
    dateInterpretationHint: inferred.interpretationHint
  });
};
