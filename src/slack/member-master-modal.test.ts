import { describe, expect, it } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import {
  buildMemberMasterModalView,
  parseMemberMasterSubmission,
  STATUS_DEFAULT_TEXT_BLOCK_ID,
  STATUS_EMOJI_BLOCK_ID
} from "./member-master-modal";

describe("buildMemberMasterModalView", () => {
  const config = createTestConfig(createMockKv());

  it("omits status blocks when status prefs schema is not ready", () => {
    const view = buildMemberMasterModalView({
      userId: "U1",
      config,
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none",
      statusPrefsEnabled: false
    });
    const blocks = view.blocks as Array<{ block_id?: string }>;
    expect(blocks.some((block) => block.block_id === STATUS_DEFAULT_TEXT_BLOCK_ID)).toBe(false);
    expect(blocks.some((block) => block.block_id === STATUS_EMOJI_BLOCK_ID)).toBe(false);
  });

  it("includes status blocks when status prefs schema is ready", () => {
    const view = buildMemberMasterModalView({
      userId: "U1",
      config,
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none",
      statusPrefsEnabled: true,
      statusDefaultText: "リモート",
      statusEmoji: ":house:"
    });
    const blocks = view.blocks as Array<{ block_id?: string }>;
    expect(blocks.some((block) => block.block_id === STATUS_DEFAULT_TEXT_BLOCK_ID)).toBe(true);
    expect(blocks.some((block) => block.block_id === STATUS_EMOJI_BLOCK_ID)).toBe(true);
  });
});

describe("parseMemberMasterSubmission", () => {
  const baseValues = {
    active_block: {
      active_checkbox: {
        selected_options: [{ value: "active" }]
      }
    },
    channels_block: {
      default_channels_select: {
        selected_conversations: ["C1"]
      }
    },
    users_block: {
      default_users_select: {
        selected_users: ["U2"]
      }
    },
    registration_notify_block: {
      default_registration_notify_select: {
        selected_option: { value: "none" }
      }
    },
    [STATUS_DEFAULT_TEXT_BLOCK_ID]: {
      status_default_text_input: { value: "リモート" }
    },
    [STATUS_EMOJI_BLOCK_ID]: {
      status_emoji_input: { value: ":house:" }
    }
  };

  it("parses status prefs and clears blank values", () => {
    const parsed = parseMemberMasterSubmission(baseValues, { statusPrefsEnabled: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record.statusDefaultText).toBe("リモート");
    expect(parsed.record.statusEmoji).toBe(":house:");

    const cleared = parseMemberMasterSubmission(
      {
        ...baseValues,
        [STATUS_DEFAULT_TEXT_BLOCK_ID]: { status_default_text_input: { value: "   " } },
        [STATUS_EMOJI_BLOCK_ID]: { status_emoji_input: { value: "" } }
      },
      { statusPrefsEnabled: true }
    );
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.record.statusDefaultText).toBeNull();
    expect(cleared.record.statusEmoji).toBeNull();
  });

  it("skips status prefs when schema is not ready", () => {
    const parsed = parseMemberMasterSubmission(baseValues, { statusPrefsEnabled: false });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record.statusDefaultText).toBeUndefined();
    expect(parsed.record.statusEmoji).toBeUndefined();
  });

  it("preserves status prefs when status blocks are absent from stale modal", () => {
    const {
      [STATUS_DEFAULT_TEXT_BLOCK_ID]: _text,
      [STATUS_EMOJI_BLOCK_ID]: _emoji,
      ...withoutStatus
    } = baseValues;
    const parsed = parseMemberMasterSubmission(withoutStatus, { statusPrefsEnabled: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record.statusDefaultText).toBeUndefined();
    expect(parsed.record.statusEmoji).toBeUndefined();
  });

  it("rejects invalid status emoji", () => {
    const parsed = parseMemberMasterSubmission(
      {
        ...baseValues,
        [STATUS_EMOJI_BLOCK_ID]: { status_emoji_input: { value: "invalid" } }
      },
      { statusPrefsEnabled: true }
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errorBlockId).toBe(STATUS_EMOJI_BLOCK_ID);
  });

  it("rejects overly long status text", () => {
    const parsed = parseMemberMasterSubmission(
      {
        ...baseValues,
        [STATUS_DEFAULT_TEXT_BLOCK_ID]: { status_default_text_input: { value: "a".repeat(101) } }
      },
      { statusPrefsEnabled: true }
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errorBlockId).toBe(STATUS_DEFAULT_TEXT_BLOCK_ID);
  });
});
