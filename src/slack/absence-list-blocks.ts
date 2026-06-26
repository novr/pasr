import type { AbsenceRecord } from "../domain/absence";
import { formatAbsenceListLine } from "../domain/absence-registration";

export const ABSENCE_LIST_MAX_ROWS = 25;
export const ABSENCE_DELETE_ACTION_ID = "pasr_absence_delete";
export const ABSENCE_EDIT_OPEN_ACTION_ID = "pasr_absence_edit_open";

export const buildOwnAbsenceListBlocks = (
  records: AbsenceRecord[],
  options?: { includeEdit?: boolean }
): { blocks: Array<Record<string, unknown>>; omitted: number } => {
  const includeEdit = options?.includeEdit ?? true;
  const omitted = Math.max(0, records.length - ABSENCE_LIST_MAX_ROWS);
  const visible = records.slice(0, ABSENCE_LIST_MAX_ROWS);
  const blocks: Array<Record<string, unknown>> = [];
  for (const record of visible) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: formatAbsenceListLine(record) }
    });
    const elements: Array<Record<string, unknown>> = [];
    if (includeEdit) {
      elements.push({
        type: "button",
        action_id: ABSENCE_EDIT_OPEN_ACTION_ID,
        text: { type: "plain_text", text: "編集" },
        value: record.itemId
      });
    }
    elements.push({
      type: "button",
      action_id: ABSENCE_DELETE_ACTION_ID,
      text: { type: "plain_text", text: "削除" },
      style: "danger",
      value: record.itemId
    });
    blocks.push({ type: "actions", elements });
  }
  return { blocks, omitted };
};
