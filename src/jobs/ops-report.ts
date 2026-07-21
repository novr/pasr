import type { AppConfig } from "../config";
import { countMemberMasterActive, countMemberMasterTotal } from "../db/stats-repository";
import type { SkipReason } from "../domain/absence";
import { formatRunSentForOps, type RunSentCounts } from "../domain/run-sent-metrics";
import { slackApi } from "../slack/api";

export type OpsReportInput = {
  runId: string;
  trigger: "manual" | "scheduled";
  day: string;
  todayAbsenceCount: number;
  processed: number;
  sent: number;
  sentChannels?: number;
  sentDms?: number;
  skipped: number;
  errors: number;
  deleted: number;
  skipReasons: Record<SkipReason, number>;
  statusSet?: number;
  statusSkipped?: number;
  statusErrors?: number;
};

const formatSkipReasons = (skipReasons: Record<SkipReason, number>): string => {
  const parts = Object.entries(skipReasons)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason}=${count}`);
  return parts.length > 0 ? parts.join(", ") : "none";
};

export const buildOpsReportText = (
  input: OpsReportInput,
  memberTotal: number,
  memberActive: number
): string => {
  const sentLine = formatRunSentForOps({
    sent: input.sent,
    sentChannels: input.sentChannels,
    sentDms: input.sentDms
  } satisfies RunSentCounts);
  const lines = [
    `PASR 日次レポート（${input.day} JST）`,
    `• 本日の不在: ${input.todayAbsenceCount}件`,
    `• 利用者: active ${memberActive} / 全 ${memberTotal}`,
    `• run: ${sentLine} skipped=${input.skipped} errors=${input.errors} deleted=${input.deleted}`,
    `• skip: ${formatSkipReasons(input.skipReasons)}`
  ];
  if (
    input.statusSet !== undefined ||
    input.statusSkipped !== undefined ||
    input.statusErrors !== undefined
  ) {
    lines.push(
      `• status: set=${input.statusSet ?? 0} skipped=${input.statusSkipped ?? 0} errors=${input.statusErrors ?? 0}`
    );
  }
  lines.push(`run_id: ${input.runId}`);
  return lines.join("\n");
};

export const postOpsReport = async (
  config: AppConfig,
  input: OpsReportInput
): Promise<{ posted: boolean; errors: number }> => {
  if (input.trigger !== "scheduled") {
    return { posted: false, errors: 0 };
  }
  if (!config.opsChannelId) {
    console.log(JSON.stringify({ level: "info", event: "ops_report_skipped_no_channel", run_id: input.runId }));
    return { posted: false, errors: 0 };
  }

  try {
    const [memberTotal, memberActive] = await Promise.all([
      countMemberMasterTotal(config),
      countMemberMasterActive(config)
    ]);
    const text = buildOpsReportText(input, memberTotal, memberActive);
    await slackApi.postChannelMessage(config, config.opsChannelId, text);
    console.log(
      JSON.stringify({
        level: "info",
        event: "ops_report_posted",
        run_id: input.runId,
        channel: config.opsChannelId
      })
    );
    return { posted: true, errors: 0 };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "ops_report_failed",
        run_id: input.runId,
        channel: config.opsChannelId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return { posted: false, errors: 1 };
  }
};
