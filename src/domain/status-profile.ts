import { STATUS_TEXT_MAX_LEN, truncateStatusText } from "./status-text";

const SLACK_EMOJI_ALIAS_PATTERN = /^:[a-z0-9_+-]+:$/i;

const isUnicodeEmoji = (value: string): boolean => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = [...segmenter.segment(value)];
  if (segments.length !== 1) return false;
  return /\p{Extended_Pictographic}/u.test(segments[0].segment);
};

export const normalizeStatusDefaultTextInput = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return truncateStatusText(trimmed);
};

export const normalizeStatusEmojiInput = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
};

export const validateStatusDefaultText = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > STATUS_TEXT_MAX_LEN) {
    return `Status 文言は ${STATUS_TEXT_MAX_LEN} 文字以内にしてください。`;
  }
  return undefined;
};

export const validateStatusEmoji = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (SLACK_EMOJI_ALIAS_PATTERN.test(trimmed) || isUnicodeEmoji(trimmed)) {
    return undefined;
  }
  return "Status 絵文字は :emoji: 形式または単一の絵文字で入力してください。";
};

export const resolveStatusText = (params: {
  note?: string;
  userDefaultText?: string;
  orgDefaultText: string;
}): string => {
  const note = params.note?.trim();
  if (note) return truncateStatusText(note);
  const userDefault = params.userDefaultText?.trim();
  if (userDefault) return truncateStatusText(userDefault);
  return truncateStatusText(params.orgDefaultText);
};

export const resolveStatusEmoji = (params: {
  userEmoji?: string;
  orgEmoji: string;
}): string => {
  const userEmoji = params.userEmoji?.trim();
  if (userEmoji) return userEmoji;
  return params.orgEmoji.trim() || ":date:";
};
