export type ChannelConfigEmptyValue = "on" | "off" | "default";

export type ParsedChannelConfigCommand =
  | { kind: "empty"; value: ChannelConfigEmptyValue }
  | { kind: "list" }
  | { kind: "invalid"; message: string };

export type ParsedUsersCommand =
  | { kind: "list"; page: number }
  | { kind: "invalid"; message: string };

const parseUsersPageToken = (token: string): number | undefined => {
  const page = Number.parseInt(token, 10);
  if (!Number.isFinite(page) || page < 1) return undefined;
  return page;
};

export type ParsedAbsencesCommand =
  | { kind: "today"; page: number }
  | { kind: "invalid"; message: string };

const parseAbsencesPageToken = (token: string): number | undefined => {
  const page = Number.parseInt(token, 10);
  if (!Number.isFinite(page) || page < 1) return undefined;
  return page;
};

export const parseChannelConfigCommand = (text: string): ParsedChannelConfigCommand | undefined => {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  if (parts[0] !== "channel-config") return undefined;
  if (parts.length === 2 && parts[1] === "list") {
    return { kind: "list" };
  }
  if (parts.length < 3 || parts[1] !== "empty") {
    return {
      kind: "invalid",
      message: "使い方: /pasr-admin channel-config empty on|off|default"
    };
  }
  const value = parts[2];
  if (value === "on" || value === "off" || value === "default") {
    return { kind: "empty", value };
  }
  return {
    kind: "invalid",
    message: "empty の値は on / off / default のいずれかを指定してください。"
  };
};

export const parseUsersCommand = (text: string): ParsedUsersCommand | undefined => {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  if (parts[0] !== "users") return undefined;
  if (parts.length === 1) return { kind: "list", page: 1 };
  if (parts.length === 2) {
    const page = parseUsersPageToken(parts[1]);
    if (page !== undefined) return { kind: "list", page };
    return { kind: "invalid", message: "使い方: /pasr-admin users [ページ番号]" };
  }
  if (parts.length === 3 && parts[1] === "page") {
    const page = parseUsersPageToken(parts[2]);
    if (page !== undefined) return { kind: "list", page };
  }
  return { kind: "invalid", message: "使い方: /pasr-admin users [ページ番号]" };
};

export const parseAbsencesCommand = (text: string): ParsedAbsencesCommand | undefined => {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  if (parts[0] !== "absences") return undefined;
  if (parts.length === 1) return { kind: "today", page: 1 };
  if (parts.length === 2) {
    if (parts[1] === "today") return { kind: "today", page: 1 };
    if (parts[1] === "range") {
      return {
        kind: "invalid",
        message: "absences range は未対応です。使い方: /pasr-admin absences（本日）[ページ番号]"
      };
    }
    const page = parseAbsencesPageToken(parts[1]);
    if (page !== undefined) return { kind: "today", page };
    return { kind: "invalid", message: "使い方: /pasr-admin absences（本日）[ページ番号]" };
  }
  if (parts.length === 3 && parts[1] === "today") {
    const page = parseAbsencesPageToken(parts[2]);
    if (page !== undefined) return { kind: "today", page };
  }
  if (parts.length === 3 && parts[1] === "page") {
    const page = parseAbsencesPageToken(parts[2]);
    if (page !== undefined) return { kind: "today", page };
  }
  if (parts.length >= 2 && parts[1] === "range") {
    return {
      kind: "invalid",
      message: "absences range は未対応です。使い方: /pasr-admin absences（本日）[ページ番号]"
    };
  }
  return { kind: "invalid", message: "使い方: /pasr-admin absences（本日）[ページ番号]" };
};
