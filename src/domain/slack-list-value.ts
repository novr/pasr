const DIRECT_STRING_KEYS = ["id", "user_id", "channel_id", "entity_id", "value", "name", "username", "email", "date"];

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const findByKeys = (obj: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === "string" && raw.length > 0) return raw;
  }
  return "";
};

export const toStringValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = toStringValue(entry);
      if (nested) return nested;
    }
    return "";
  }
  const obj = asRecord(value);
  if (!obj) return "";
  const direct = findByKeys(obj, DIRECT_STRING_KEYS);
  if (direct) return direct;
  for (const nestedKey of ["value", "user", "channel", "select"]) {
    if (obj[nestedKey] != null) {
      const nested = toStringValue(obj[nestedKey]);
      if (nested) return nested;
    }
  }
  return "";
};
