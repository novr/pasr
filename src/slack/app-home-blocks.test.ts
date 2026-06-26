import { describe, expect, it } from "vitest";
import type { AbsenceRecord } from "../domain/absence";
import {
  ABSENCE_REGISTER_OPEN_ACTION_ID,
  APP_HOME_LIST_OPEN_ACTION_ID,
  APP_HOME_SETTINGS_OPEN_ACTION_ID
} from "./action-ids";
import {
  buildAppHomeBlocks,
  buildAppHomeStaticFallbackBlocks,
  formatAppHomeSettingsSummary
} from "./app-home-blocks";
import type { AppHomeData } from "./app-home-data";

const collectActionIds = (blocks: Array<Record<string, unknown>>): string[] => {
  const ids: string[] = [];
  for (const block of blocks) {
    const elements = block.elements;
    if (!Array.isArray(elements)) continue;
    for (const element of elements) {
      const actionId = (element as { action_id?: string }).action_id;
      if (actionId) ids.push(actionId);
    }
  }
  return ids;
};

const absence = (id: string, day: string): AbsenceRecord => ({
  itemId: id,
  targetUser: "U1",
  startDate: day,
  endDate: day,
  notifyChannels: ["C1"],
  notifyUsers: []
});

describe("formatAppHomeSettingsSummary", () => {
  it("shows unregistered message when master missing", () => {
    expect(formatAppHomeSettingsSummary(undefined)).toContain("未登録");
  });

  it("includes channel and user mrkdwn entities", () => {
    const summary = formatAppHomeSettingsSummary({
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: ["C_NOTIFY"],
      defaultNotifyUsers: ["U_DM"],
      defaultRegistrationNotify: "both"
    });
    expect(summary).toContain("<#C_NOTIFY>");
    expect(summary).toContain("<@U_DM>");
  });
});

describe("buildAppHomeStaticFallbackBlocks", () => {
  it("includes register, settings, and list action ids", () => {
    const actionIds = collectActionIds(buildAppHomeStaticFallbackBlocks());
    expect(actionIds).toEqual([
      ABSENCE_REGISTER_OPEN_ACTION_ID,
      APP_HOME_SETTINGS_OPEN_ACTION_ID,
      APP_HOME_LIST_OPEN_ACTION_ID
    ]);
  });
});

describe("buildAppHomeBlocks", () => {
  const baseData: AppHomeData = {
    todayJst: "2026-06-24",
    absences: [],
    hasMoreAbsences: false
  };

  it("places actions before settings and preview sections", () => {
    const blocks = buildAppHomeBlocks(baseData);
    const types = blocks.map((block) => block.type);
    const actionsIndex = types.indexOf("actions");
    const firstDivider = types.indexOf("divider");
    expect(actionsIndex).toBeGreaterThan(-1);
    expect(firstDivider).toBeGreaterThan(actionsIndex);
  });

  it("renders preview blocks for absences", () => {
    const data: AppHomeData = {
      ...baseData,
      absences: [absence("a1", "2026-06-25"), absence("a2", "2026-06-26")]
    };
    const blocks = buildAppHomeBlocks(data);
    const texts = blocks
      .filter((block) => block.type === "section")
      .map((block) => (block.text as { text?: string } | undefined)?.text ?? "");
    expect(texts.some((text) => text.includes("2026-06-25"))).toBe(true);
    expect(collectActionIds(blocks).length).toBeGreaterThan(3);
  });

  it("adds overflow hint when hasMoreAbsences", () => {
    const data: AppHomeData = {
      ...baseData,
      absences: Array.from({ length: 6 }, (_, index) => absence(`a${index}`, `2026-07-0${index + 1}`)),
      hasMoreAbsences: true
    };
    const blocks = buildAppHomeBlocks(data);
    const overflow = blocks.find(
      (block) =>
        block.type === "section" &&
        (block.text as { text?: string } | undefined)?.text?.includes("不在一覧")
    );
    expect(overflow).toBeDefined();
    expect((overflow?.text as { text?: string }).text).toContain("…");
  });
});
