import {
  escapeSlackCodeBlock,
  extractAuthorName,
  extractBuildError,
  getBuildStatus,
  getCommitUrl,
  getDashboardUrl,
  isProductionBranch
} from "./helpers";
import { PASR_WORKER_NAME, type CloudflareEvent } from "./types";

type SlackBlock = Record<string, unknown>;

const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const sectionBlock = (
  text: string,
  buttonText?: string,
  buttonUrl?: string | null,
  buttonStyle?: "primary" | "danger"
): SlackBlock => {
  const block: SlackBlock = {
    type: "section",
    text: { type: "mrkdwn", text }
  };
  if (buttonText && buttonUrl) {
    block.accessory = {
      type: "button",
      text: { type: "plain_text", text: buttonText },
      url: buttonUrl,
      ...(buttonStyle ? { style: buttonStyle } : {})
    };
  }
  return block;
};

const contextElements = (event: CloudflareEvent): Array<{ type: "mrkdwn"; text: string }> => {
  const meta = event.payload.buildTriggerMetadata;
  const commitUrl = getCommitUrl(event);
  const elements: Array<{ type: "mrkdwn"; text: string }> = [];
  if (meta?.branch) {
    elements.push({ type: "mrkdwn", text: `*Branch:* \`${meta.branch}\`` });
  }
  if (meta?.commitHash) {
    const shortHash = meta.commitHash.substring(0, 7);
    elements.push({
      type: "mrkdwn",
      text: `*Commit:* ${commitUrl ? `<${commitUrl}|${shortHash}>` : `\`${shortHash}\``}`
    });
  }
  const authorName = extractAuthorName(meta?.author);
  if (authorName) {
    elements.push({ type: "mrkdwn", text: `*Author:* ${escapeSlackMrkdwn(authorName)}` });
  }
  return elements;
};

const buildSuccessMessage = (
  event: CloudflareEvent,
  previewUrl: string | null,
  liveUrl: string | null
): { blocks: SlackBlock[] } => {
  const isProduction = isProductionBranch(event.payload.buildTriggerMetadata?.branch);
  const dashUrl = getDashboardUrl(event);
  const title = isProduction ? "Production Deploy" : "Preview Deploy";
  const buttonText = isProduction
    ? liveUrl
      ? "View Worker"
      : "View Build"
    : previewUrl
      ? "View Preview"
      : "View Build";
  const buttonUrl = isProduction ? liveUrl || dashUrl : previewUrl || dashUrl;
  const blocks: SlackBlock[] = [
    sectionBlock(`✅ *${title}*\n*${PASR_WORKER_NAME}*`, buttonText, buttonUrl)
  ];
  const context = contextElements(event);
  if (context.length > 0) {
    blocks.push({ type: "context", elements: context });
  }
  return { blocks };
};

const buildFailureMessage = (
  event: CloudflareEvent,
  logs: string[]
): { blocks: SlackBlock[] } => {
  const dashUrl = getDashboardUrl(event);
  const blocks: SlackBlock[] = [
    sectionBlock(
      `❌ *Build Failed*\n*${PASR_WORKER_NAME}*`,
      dashUrl ? "View Logs" : undefined,
      dashUrl,
      "danger"
    )
  ];
  const context = contextElements(event);
  if (context.length > 0) {
    blocks.push({ type: "context", elements: context });
  }
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `\`\`\`${escapeSlackCodeBlock(extractBuildError(logs))}\`\`\`` }
  });
  return { blocks };
};

const buildCancelledMessage = (event: CloudflareEvent): { blocks: SlackBlock[] } => {
  const dashUrl = getDashboardUrl(event);
  const blocks: SlackBlock[] = [
    sectionBlock(
      `⚠️ *Build Cancelled*\n*${PASR_WORKER_NAME}*`,
      dashUrl ? "View Build" : undefined,
      dashUrl
    )
  ];
  const context = contextElements(event);
  if (context.length > 0) {
    blocks.push({ type: "context", elements: context });
  }
  return { blocks };
};

export const buildSlackPayload = (
  event: CloudflareEvent,
  previewUrl: string | null,
  liveUrl: string | null,
  logs: string[]
): { blocks: SlackBlock[] } => {
  const status = getBuildStatus(event);
  if (status.isSucceeded) return buildSuccessMessage(event, previewUrl, liveUrl);
  if (status.isFailed) return buildFailureMessage(event, logs);
  if (status.isCancelled) return buildCancelledMessage(event);
  return {
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `📢 ${event.type || "Unknown event"}` }
      }
    ]
  };
};

export const sendSlackNotification = async (
  webhookUrl: string,
  payload: { blocks: SlackBlock[] }
): Promise<boolean> => {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "build_notify_slack_failed",
        status: response.status,
        body: (await response.text()).slice(0, 500)
      })
    );
    return false;
  }
  return true;
};
