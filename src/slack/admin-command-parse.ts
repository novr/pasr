export type ChannelConfigEmptyValue = "on" | "off" | "default";

export type ParsedChannelConfigCommand =
  | { kind: "empty"; value: ChannelConfigEmptyValue }
  | { kind: "list" }
  | { kind: "invalid"; message: string };

export type ValidChannelConfigCommand = Extract<
  ParsedChannelConfigCommand,
  { kind: "list" } | { kind: "empty" }
>;

export type ParsedUsersCommand =
  | { kind: "list"; page: number }
  | { kind: "invalid"; message: string };

export type ParsedAbsencesCommand =
  | { kind: "today"; page: number }
  | { kind: "invalid"; message: string };

export type AdminCommandParse =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "run" }
  | { kind: "users"; page: number }
  | { kind: "absences"; scope: "today"; page: number }
  | { kind: "channel-config"; sub: ValidChannelConfigCommand }
  | { kind: "invalid"; message: string }
  | { kind: "unknown"; action: string };

export const DEFERRED_ADMIN_COMMAND_KINDS = ["users", "absences", "channel-config"] as const;

export type DeferredAdminCommandKind = (typeof DEFERRED_ADMIN_COMMAND_KINDS)[number];

export type DeferredAdminCommandParse = Extract<
  AdminCommandParse,
  { kind: DeferredAdminCommandKind }
>;

export const isDeferredAdminCommandParse = (
  parse: AdminCommandParse
): parse is DeferredAdminCommandParse =>
  DEFERRED_ADMIN_COMMAND_KINDS.includes(parse.kind as DeferredAdminCommandKind);

export const splitCommandTokens = (text: string): string[] =>
  text.split(/\s+/).filter((part) => part.length > 0);

const parseUsersPageToken = (token: string): number | undefined => {
  const page = Number.parseInt(token, 10);
  if (!Number.isFinite(page) || page < 1) return undefined;
  return page;
};

const parseAbsencesPageToken = (token: string): number | undefined => {
  const page = Number.parseInt(token, 10);
  if (!Number.isFinite(page) || page < 1) return undefined;
  return page;
};

export const parseChannelConfigCommandParts = (
  parts: string[]
): ParsedChannelConfigCommand | undefined => {
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

export const parseChannelConfigCommand = (text: string): ParsedChannelConfigCommand | undefined =>
  parseChannelConfigCommandParts(splitCommandTokens(text));

export const parseUsersCommandParts = (parts: string[]): ParsedUsersCommand | undefined => {
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

export const parseUsersCommand = (text: string): ParsedUsersCommand | undefined =>
  parseUsersCommandParts(splitCommandTokens(text));

export const parseAbsencesCommandParts = (parts: string[]): ParsedAbsencesCommand | undefined => {
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

export const parseAbsencesCommand = (text: string): ParsedAbsencesCommand | undefined =>
  parseAbsencesCommandParts(splitCommandTokens(text));

export const parseAdminCommandText = (text: string): AdminCommandParse => {
  const parts = splitCommandTokens(text);
  const action = parts[0] ?? "help";
  switch (action) {
    case "help":
      return { kind: "help" };
    case "status":
      return { kind: "status" };
    case "run":
      return { kind: "run" };
    case "users": {
      const parsed = parseUsersCommandParts(parts)!;
      if (parsed.kind === "invalid") {
        return { kind: "invalid", message: parsed.message };
      }
      return { kind: "users", page: parsed.page };
    }
    case "absences": {
      const parsed = parseAbsencesCommandParts(parts)!;
      if (parsed.kind === "invalid") {
        return { kind: "invalid", message: parsed.message };
      }
      return { kind: "absences", scope: "today", page: parsed.page };
    }
    case "channel-config": {
      const sub = parseChannelConfigCommandParts(parts)!;
      if (sub.kind === "invalid") {
        return { kind: "invalid", message: sub.message };
      }
      return { kind: "channel-config", sub };
    }
    default:
      return { kind: "unknown", action };
  }
};

export const adminCommandParseAction = (parse: AdminCommandParse): string => {
  switch (parse.kind) {
    case "help":
    case "status":
    case "run":
    case "users":
    case "absences":
    case "channel-config":
      return parse.kind;
    case "invalid":
      return "invalid";
    case "unknown":
      return parse.action;
    default: {
      const _never: never = parse;
      return _never;
    }
  }
};
