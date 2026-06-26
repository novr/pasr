import { addJstDays } from "../jst-date";
import { resolveJpWeekday } from "./date-infer";
import type { AbsenceMentionAiMessage } from "./types";

export const buildAbsenceMentionPrompt = (
  todayJst: string,
  userText: string
): AbsenceMentionAiMessage[] => {
  const tomorrow = addJstDays(todayJst, 1);
  const dayAfterTomorrow = addJstDays(todayJst, 2);
  const twoDaySpanEnd = addJstDays(dayAfterTomorrow, 1);
  const tripStart = addJstDays(todayJst, 2);
  const tripEnd = addJstDays(tripStart, 2);
  return [
    {
      role: "system",
      content: [
        "日本語メッセージから不在予定登録用フィールドを抽出する。",
        `今日は ${todayJst}（JST, YYYY-MM-DD）。`,
        'JSON のみ返す: {"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","note":"..."}。',
        "1日のみなら endDate は startDate と同じ。時刻・理由は note に入れる（日付語は note に入れない）。",
        "終了日が不明なら endDate に startDate を入れる。",
        "M/D など年省略は未来日を優先（過去になる場合は翌年）。今週・来週の週境界は日曜〜土曜。",
        "note は簡潔に1文（繰り返し禁止）。日付・期間表現を除いた残りを入れる（例: 休み、通院、午後から、旅行）。"
      ].join(" ")
    },
    {
      role: "user",
      content: "今日 午前通院"
    },
    {
      role: "assistant",
      content: JSON.stringify({
        startDate: todayJst,
        endDate: todayJst,
        note: "午前通院"
      })
    },
    {
      role: "user",
      content: "明日 通院のため午後から"
    },
    {
      role: "assistant",
      content: JSON.stringify({
        startDate: tomorrow,
        endDate: tomorrow,
        note: "通院のため午後から"
      })
    },
    {
      role: "user",
      content: "明後日から2日間 休み"
    },
    {
      role: "assistant",
      content: JSON.stringify({
        startDate: dayAfterTomorrow,
        endDate: twoDaySpanEnd,
        note: "休み"
      })
    },
    {
      role: "user",
      content: "来週月曜休み"
    },
    {
      role: "assistant",
      content: JSON.stringify({
        startDate: resolveJpWeekday(todayJst, "来週", "月") ?? tomorrow,
        endDate: resolveJpWeekday(todayJst, "来週", "月") ?? tomorrow,
        note: "休み"
      })
    },
    {
      role: "user",
      content: "今週金曜 午後から"
    },
    {
      role: "assistant",
      content: JSON.stringify({
        startDate: resolveJpWeekday(todayJst, "今週", "金") ?? todayJst,
        endDate: resolveJpWeekday(todayJst, "今週", "金") ?? todayJst,
        note: "午後から"
      })
    },
    {
      role: "user",
      content: `${Number(tripStart.slice(5, 7))}/${Number(tripStart.slice(8, 10))}〜${Number(tripEnd.slice(5, 7))}/${Number(tripEnd.slice(8, 10))} 旅行`
    },
    {
      role: "assistant",
      content: JSON.stringify({
        startDate: tripStart,
        endDate: tripEnd,
        note: "旅行"
      })
    },
    {
      role: "user",
      content: "明日 午前中 子供の行事"
    },
    {
      role: "assistant",
      content: JSON.stringify({
        startDate: tomorrow,
        endDate: tomorrow,
        note: "午前中 子供の行事"
      })
    },
    {
      role: "user",
      content: userText
    }
  ];
};
