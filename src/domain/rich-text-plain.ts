import { asRecord, toStringValue } from "./slack-list-value";

type RichNodeType =
  | "text"
  | "link"
  | "emoji"
  | "user"
  | "channel"
  | "broadcast"
  | "date"
  | "unknown";

type RichContainerType =
  | "rich_text"
  | "rich_text_section"
  | "rich_text_list"
  | "rich_text_preformatted"
  | "rich_text_quote"
  | "unknown";

const normalizeNodeType = (value: unknown): RichNodeType => {
  switch (value) {
    case "text":
      return "text";
    case "link":
      return "link";
    case "emoji":
      return "emoji";
    case "user":
      return "user";
    case "channel":
      return "channel";
    case "broadcast":
      return "broadcast";
    case "date":
      return "date";
    default:
      return "unknown";
  }
};

const normalizeContainerType = (value: unknown): RichContainerType => {
  switch (value) {
    case "rich_text":
      return "rich_text";
    case "rich_text_section":
      return "rich_text_section";
    case "rich_text_list":
      return "rich_text_list";
    case "rich_text_preformatted":
      return "rich_text_preformatted";
    case "rich_text_quote":
      return "rich_text_quote";
    default:
      return "unknown";
  }
};

const pushIfPresent = (bucket: string[], value: unknown): void => {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed.length > 0) bucket.push(trimmed);
};

const appendNodeText = (node: Record<string, unknown>, bucket: string[]): void => {
  const nodeType = normalizeNodeType(node.type);
  switch (nodeType) {
    case "text":
      pushIfPresent(bucket, node.text);
      return;
    case "link":
      pushIfPresent(bucket, node.text);
      pushIfPresent(bucket, node.url);
      return;
    case "emoji":
      pushIfPresent(bucket, node.name);
      return;
    case "user":
      if (typeof node.user_id === "string" && node.user_id.length > 0) {
        bucket.push(`<@${node.user_id}>`);
      }
      return;
    case "channel":
      if (typeof node.channel_id === "string" && node.channel_id.length > 0) {
        bucket.push(`<#${node.channel_id}>`);
      }
      return;
    case "broadcast":
      pushIfPresent(bucket, node.range);
      return;
    case "date":
      pushIfPresent(bucket, node.fallback);
      return;
    case "unknown":
      return;
  }
};

const collectTextNodes = (value: unknown, bucket: string[]): void => {
  if (Array.isArray(value)) {
    for (const entry of value) collectTextNodes(entry, bucket);
    return;
  }
  const obj = asRecord(value);
  if (!obj) return;

  const nodeType = normalizeNodeType(obj.type);
  if (nodeType !== "unknown") {
    appendNodeText(obj, bucket);
    return;
  }

  const containerType = normalizeContainerType(obj.type);
  switch (containerType) {
    case "rich_text":
    case "rich_text_section":
    case "rich_text_list":
    case "rich_text_preformatted":
    case "rich_text_quote":
      collectTextNodes(obj.elements, bucket);
      return;
    case "unknown":
      collectTextNodes(obj.elements, bucket);
      collectTextNodes(obj.blocks, bucket);
      collectTextNodes(obj.content, bucket);
      return;
  }
};

export const extractPlainText = (value: unknown): string => {
  const texts: string[] = [];
  collectTextNodes(value, texts);
  return texts.join(" ").trim();
};

const parsePossibleJsonPlainText = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed;
  try {
    const extracted = extractPlainText(JSON.parse(trimmed) as unknown);
    return extracted.length > 0 ? extracted : trimmed;
  } catch {
    return trimmed;
  }
};

export const toNoteText = (value: unknown): string => {
  if (value == null) return "";
  const wrapped = asRecord(value);
  if (wrapped?.rich_text != null) {
    const fromRichText = toNoteText(wrapped.rich_text);
    if (fromRichText.length > 0) return fromRichText;
  }
  if (wrapped && typeof wrapped.key === "string") {
    for (const nestedKey of ["rich_text", "text", "value", "string"]) {
      if (wrapped[nestedKey] != null) {
        const nested = toNoteText(wrapped[nestedKey]);
        if (nested.length > 0) return nested;
      }
    }
  }
  if (typeof value === "string") {
    return parsePossibleJsonPlainText(value);
  }
  const extracted = extractPlainText(value);
  if (extracted.length > 0) return extracted;
  const fallback = toStringValue(value).trim();
  return fallback.length > 0 ? parsePossibleJsonPlainText(fallback) : "";
};
