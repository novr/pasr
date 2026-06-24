const MENTION_PATTERN = /<@[A-Z0-9]+>/g;

const MENTION_DATE_EXPRESSION_PATTERNS: RegExp[] = [
  /\d{4}-\d{2}-\d{2}\s*から\s*\d{4}-\d{2}-\d{2}\s*まで/g,
  /\d{4}-\d{2}-\d{2}/g,
  /\d{1,2}\/\d{1,2}\s*[〜～\-－]\s*\d{1,2}\/\d{1,2}/g,
  /\d{1,2}\/\d{1,2}/g,
  /(?:今日|明日|明後日|あさって)\s*から\s*\d+\s*日間/g,
  /来週は/g,
  /(?:今週|来週|翌週)(?:\s*|の)(?:月|火|水|木|金|土|日)曜?日?/g,
  /(?:今日|明日|明後日|あさって)/g
];

export const stripAppMentionText = (text: string): string =>
  text.replace(MENTION_PATTERN, "").replace(/\s+/g, " ").trim();

export const stripDateExpressionsFromMentionText = (text: string): string => {
  let remainder = stripAppMentionText(text);
  for (const pattern of MENTION_DATE_EXPRESSION_PATTERNS) {
    remainder = remainder.replace(pattern, " ");
  }
  return remainder.replace(/\s+/g, " ").trim();
};
