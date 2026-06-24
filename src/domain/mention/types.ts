export const MENTION_NOTE_MAX_LEN = 500;

export const ABSENCE_MENTION_AI_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    type: "object",
    properties: {
      startDate: { type: "string" },
      endDate: { type: "string" },
      note: { type: "string" }
    },
    required: ["startDate", "endDate", "note"]
  }
} as const;

export type AbsenceMentionDraft = {
  startDate: string;
  endDate: string;
  note?: string;
  noteTruncated?: boolean;
};

export type MentionConfirmPayload = {
  v: 1;
  userId: string;
  channelId: string;
  startDate: string;
  endDate: string;
  note?: string;
};

export type AbsenceMentionAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type InferredMentionDateRange = {
  startDate: string;
  endDate: string;
  confidence: "high" | "low";
};
