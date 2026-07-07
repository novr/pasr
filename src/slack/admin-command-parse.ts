export type ChannelConfigEmptyValue = "on" | "off" | "default";

export type ParsedChannelConfigCommand =
  | { kind: "empty"; value: ChannelConfigEmptyValue }
  | { kind: "list" }
  | { kind: "invalid"; message: string };

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
