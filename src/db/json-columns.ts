export const serializeJsonArray = (values: string[]): string => JSON.stringify([...new Set(values)]);

export const deserializeJsonArray = (raw: string | null | undefined): string[] => {
  if (!raw || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  } catch {
    return [];
  }
};
