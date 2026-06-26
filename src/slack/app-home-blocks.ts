import { formatRegistrationNotifyModeLabel } from "../domain/absence-registration";
import type { MemberMasterRecord } from "../db/member-master-repository";
import {
  APP_HOME_LIST_OPEN_ACTION_ID,
  APP_HOME_SETTINGS_OPEN_ACTION_ID,
  ABSENCE_REGISTER_OPEN_ACTION_ID
} from "./action-ids";
import { buildOwnAbsenceListBlocks } from "./absence-list-blocks";
import {
  APP_HOME_ABSENCE_PREVIEW_MAX,
  type AppHomeData
} from "./app-home-data";

const APP_HOME_INTRO_TEXT =
  "チームの不在予定を登録し、平日 JST 9:00 に自動で共有するアプリです。";

const APP_HOME_USAGE_LINES = [
  "*使い方*",
  "• `/pasr register` — 不在を登録",
  "• `/pasr list` — 一覧・編集・削除",
  "• `/pasr settings` — 通知設定",
  "• Messages タブから自然文（例: `明日 通院`）でも登録できます"
];

const formatEntityList = (entities: string[], emptyLabel: string): string =>
  entities.length > 0 ? entities.join(" ") : emptyLabel;

export const formatAppHomeSettingsSummary = (master?: MemberMasterRecord): string => {
  if (!master) {
    return "*通知設定*\n通知設定: 未登録（初回操作時に自動作成）";
  }
  const lines = ["*通知設定*"];
  if (!master.active) {
    lines.push("通知対象: 無効");
  }
  lines.push(`登録通知: ${formatRegistrationNotifyModeLabel(master.defaultRegistrationNotify)}`);
  lines.push(
    `既定チャンネル: ${formatEntityList(
      master.defaultNotifyChannels.map((id) => `<#${id}>`),
      "なし"
    )}`
  );
  lines.push(
    `既定 DM: ${formatEntityList(
      master.defaultNotifyUsers.map((id) => `<@${id}>`),
      "なし"
    )}`
  );
  return lines.join("\n");
};

const buildAppHomeActionBlock = (): Record<string, unknown> => ({
  type: "actions",
  block_id: "pasr_home_actions",
  elements: [
    {
      type: "button",
      action_id: ABSENCE_REGISTER_OPEN_ACTION_ID,
      text: { type: "plain_text", text: "不在を登録" },
      style: "primary"
    },
    {
      type: "button",
      action_id: APP_HOME_SETTINGS_OPEN_ACTION_ID,
      text: { type: "plain_text", text: "通知設定" }
    },
    {
      type: "button",
      action_id: APP_HOME_LIST_OPEN_ACTION_ID,
      text: { type: "plain_text", text: "不在一覧" }
    }
  ]
});

export const buildAppHomeStaticFallbackBlocks = (): Array<Record<string, unknown>> => [
  {
    type: "header",
    text: { type: "plain_text", text: "PASR" }
  },
  {
    type: "section",
    text: { type: "mrkdwn", text: APP_HOME_INTRO_TEXT }
  },
  buildAppHomeActionBlock(),
  {
    type: "section",
    text: { type: "mrkdwn", text: APP_HOME_USAGE_LINES.join("\n") }
  }
];

export const buildAppHomeBlocks = (data: AppHomeData): Array<Record<string, unknown>> => {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "PASR" }
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `今日: ${data.todayJst} (JST)` }]
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: APP_HOME_INTRO_TEXT }
    },
    buildAppHomeActionBlock(),
    {
      type: "section",
      text: { type: "mrkdwn", text: APP_HOME_USAGE_LINES.join("\n") }
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: formatAppHomeSettingsSummary(data.master) }
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          data.absences.length === 0
            ? "*今後の不在*\n登録済みの今後の不在はありません。"
            : "*今後の不在*"
      }
    }
  ];

  if (data.absences.length > 0) {
    const preview = data.absences.slice(0, APP_HOME_ABSENCE_PREVIEW_MAX);
    const { blocks: listBlocks } = buildOwnAbsenceListBlocks(preview, { includeEdit: true });
    blocks.push(...listBlocks);
    if (data.hasMoreAbsences) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "… 「不在一覧」で確認" }
      });
    }
  }

  return blocks;
};
