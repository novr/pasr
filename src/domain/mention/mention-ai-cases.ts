import { addJstDays } from "../jst-date";

export const MENTION_AI_INTEGRATION_TODAY = "2026-06-24";

export type MentionAiIntegrationExpect = {
  startDate?: string;
  endDate?: string;
  noteIncludes?: string;
  noteExact?: string;
  /** false のとき日付は AI 任せで note のみ検証 */
  dateStrict?: boolean;
};

export type MentionAiIntegrationCase = {
  id: string;
  text: string;
  expect: MentionAiIntegrationExpect;
  /** true: enrich/infer で決まる。単体テストで検証し結合ではスキップ */
  inferOnly?: boolean;
};

const today = MENTION_AI_INTEGRATION_TODAY;
const tomorrow = addJstDays(today, 1);
const dayAfterTomorrow = addJstDays(today, 2);

/** infer/enrich で日付が決まるケース（結合テスト対象外） */
export const MENTION_AI_INFER_CASES: MentionAiIntegrationCase[] = [
  {
    id: "today-morning-clinic",
    text: "今日 午前通院",
    inferOnly: true,
    expect: {
      startDate: today,
      endDate: today,
      noteExact: "午前通院"
    }
  },
  {
    id: "tomorrow-afternoon-clinic",
    text: "明日 通院のため午後から",
    inferOnly: true,
    expect: {
      startDate: tomorrow,
      endDate: tomorrow,
      noteIncludes: "通院"
    }
  },
  {
    id: "day-after-tomorrow-two-days-off",
    text: "明後日から2日間休み",
    inferOnly: true,
    expect: {
      startDate: dayAfterTomorrow,
      endDate: addJstDays(dayAfterTomorrow, 1),
      noteIncludes: "休み"
    }
  },
  {
    id: "next-monday-off",
    text: "来週月曜休み",
    inferOnly: true,
    expect: {
      startDate: "2026-06-29",
      endDate: "2026-06-29",
      noteIncludes: "休み"
    }
  },
  {
    id: "slash-date-range-trip",
    text: "6/25〜6/27 旅行",
    inferOnly: true,
    expect: {
      startDate: "2026-06-25",
      endDate: "2026-06-27",
      noteIncludes: "旅行"
    }
  },
  {
    id: "iso-date-range-trip",
    text: "2026-06-25から2026-06-27まで出張",
    inferOnly: true,
    expect: {
      startDate: "2026-06-25",
      endDate: "2026-06-27",
      noteIncludes: "出張"
    }
  },
  {
    id: "tomorrow-morning-event",
    text: "明日 午前中 子供の行事",
    inferOnly: true,
    expect: {
      startDate: tomorrow,
      endDate: tomorrow,
      noteIncludes: "子供"
    }
  },
  {
    id: "this-friday-afternoon",
    text: "今週金曜 午後から",
    inferOnly: true,
    expect: {
      startDate: "2026-06-26",
      endDate: "2026-06-26",
      noteIncludes: "午後"
    }
  }
];

/** AI 推論品質を検証するケース（結合テスト対象） */
export const MENTION_AI_MODEL_CASES: MentionAiIntegrationCase[] = [
  {
    id: "next-week-trip-vague",
    text: "来週は旅行なので不在です",
    expect: {
      dateStrict: false,
      noteIncludes: "旅行"
    }
  },
  {
    id: "afternoon-only-no-date-keyword",
    text: "午後から休みます 子供の行事",
    expect: {
      dateStrict: false,
      noteIncludes: "行事"
    }
  }
];

export const MENTION_AI_INTEGRATION_CASES: MentionAiIntegrationCase[] = [
  ...MENTION_AI_INFER_CASES,
  ...MENTION_AI_MODEL_CASES
];
