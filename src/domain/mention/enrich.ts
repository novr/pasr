import { inferMentionDateRange } from "./date-infer";
import { stripDateExpressionsFromMentionText } from "./text";
import { truncateNote } from "./note";
import type { AbsenceMentionDraft, InferredMentionDateRange } from "./types";

const shouldOverrideMentionDraftDates = (
  draft: AbsenceMentionDraft,
  inferred: InferredMentionDateRange
): boolean => {
  if (inferred.confidence === "high") {
    return true;
  }
  return draft.startDate !== inferred.startDate || draft.endDate !== inferred.endDate;
};

export const enrichMentionDraftDates = (
  userText: string,
  todayJst: string,
  draft: AbsenceMentionDraft
): AbsenceMentionDraft => {
  const inferred = inferMentionDateRange(userText, todayJst);
  if (!inferred) {
    return draft;
  }
  const hint = inferred.interpretationHint
    ? { dateInterpretationHint: inferred.interpretationHint }
    : {};
  if (!shouldOverrideMentionDraftDates(draft, inferred)) {
    const datesMatch =
      draft.startDate === inferred.startDate && draft.endDate === inferred.endDate;
    return datesMatch ? { ...draft, ...hint } : draft;
  }
  return {
    ...draft,
    startDate: inferred.startDate,
    endDate: inferred.endDate,
    ...hint
  };
};

export const enrichMentionDraftNote = (
  userText: string,
  draft: AbsenceMentionDraft
): AbsenceMentionDraft => {
  const inferred = stripDateExpressionsFromMentionText(userText);
  const aiNote = draft.note?.trim() ?? "";
  const shouldInfer =
    inferred.length > 0 &&
    (aiNote.length === 0 || stripDateExpressionsFromMentionText(aiNote) !== aiNote);
  if (!shouldInfer) {
    return draft;
  }
  const { note, truncated } = truncateNote(inferred);
  return {
    ...draft,
    note,
    noteTruncated: truncated || draft.noteTruncated || undefined
  };
};

export const enrichMentionDraft = (
  userText: string,
  todayJst: string,
  draft: AbsenceMentionDraft
): AbsenceMentionDraft => enrichMentionDraftNote(userText, enrichMentionDraftDates(userText, todayJst, draft));
