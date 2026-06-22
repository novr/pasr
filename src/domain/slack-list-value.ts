type ListItemLike = {
  fields?: Record<string, unknown> | unknown[];
  values?: Record<string, unknown>;
};

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

export const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => toStringValue(entry)).filter((entry) => entry.length > 0);
  }
  const obj = asRecord(value);
  if (!obj) return [];
  for (const key of ["channel", "user", "select", "date"]) {
    if (Array.isArray(obj[key])) {
      return obj[key].map((entry) => toStringValue(entry)).filter((entry) => entry.length > 0);
    }
  }
  const single = toStringValue(value);
  return single ? [single] : [];
};

export const toBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
    return undefined;
  }
  const obj = asRecord(value);
  if (!obj) return undefined;
  for (const key of ["value", "checked", "is_checked", "selected"]) {
    if (obj[key] !== undefined) {
      const nested = toBooleanValue(obj[key]);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
};

export const pickListField = (item: ListItemLike, key: string): unknown => {
  if (Array.isArray(item.fields)) {
    const fromFields = item.fields.find((entry) => {
      const record = asRecord(entry);
      return record?.key === key;
    });
    if (fromFields) return fromFields;
  }
  const fieldsRecord = asRecord(item.fields);
  return fieldsRecord?.[key] ?? item.values?.[key];
};
