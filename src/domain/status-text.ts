export const STATUS_TEXT_MAX_LEN = 100;

export const truncateStatusText = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length <= STATUS_TEXT_MAX_LEN) return trimmed;
  if (STATUS_TEXT_MAX_LEN <= 1) return trimmed.slice(0, STATUS_TEXT_MAX_LEN);
  return `${trimmed.slice(0, STATUS_TEXT_MAX_LEN - 1)}…`;
};
