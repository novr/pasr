import type { AppConfig } from "../config";
import {
  ABSENCE_MENTION_AI_RESPONSE_FORMAT,
  buildAbsenceMentionPrompt,
  describeAiRunForLog,
  enrichMentionDraft,
  parseAbsenceMentionFromAiRun,
  stripAppMentionText,
  tryInferMentionDraftWithoutAi,
  type AbsenceMentionDraft
} from "../domain/absence-mention-parse";
import { getJstDateParts } from "../domain/jst-date";

export const ABSENCE_MENTION_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

export type AbsenceMentionAiRunResult = {
  draft?: AbsenceMentionDraft;
  lastResponse?: unknown;
  error?: Error;
  skippedInfer?: boolean;
};

export type RunAbsenceMentionAiOptions = {
  inferredDraft?: AbsenceMentionDraft;
};

export const runAbsenceMentionAi = async (
  config: AppConfig,
  todayJst: string,
  userText: string,
  options?: RunAbsenceMentionAiOptions
): Promise<AbsenceMentionAiRunResult> => {
  const skipped = options?.inferredDraft ?? tryInferMentionDraftWithoutAi(userText, todayJst);
  if (skipped) {
    return { draft: skipped, skippedInfer: true };
  }

  if (!config.ai) {
    return { error: new Error("Workers AI binding is not configured") };
  }
  const messages = buildAbsenceMentionPrompt(todayJst, userText);
  let lastError: unknown;
  let lastResponse: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lastResponse = await config.ai.run(ABSENCE_MENTION_AI_MODEL, {
        messages,
        temperature: 0,
        max_tokens: 256,
        response_format: ABSENCE_MENTION_AI_RESPONSE_FORMAT
      });
      const draft = parseAbsenceMentionFromAiRun(lastResponse);
      if (draft) return { draft: enrichMentionDraft(userText, todayJst, draft), lastResponse };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    return {
      error: lastError instanceof Error ? lastError : new Error(String(lastError)),
      lastResponse
    };
  }
  return { lastResponse };
};

export type DebugMentionAiResult = {
  ok: boolean;
  todayJst: string;
  userText: string;
  model: string;
  draft?: AbsenceMentionDraft;
  aiResponse?: unknown;
  aiLog?: { response_kind: string; response_length: number };
  skippedInfer?: boolean;
  error?: string;
};

export const debugAbsenceMentionAi = async (
  config: AppConfig,
  params: { text: string; todayJst?: string }
): Promise<DebugMentionAiResult> => {
  const userText = stripAppMentionText(params.text);
  const todayJst = params.todayJst?.trim() || getJstDateParts().day;
  const base = { todayJst, userText, model: ABSENCE_MENTION_AI_MODEL };

  if (userText.length === 0) {
    return { ...base, ok: false, error: "text is empty after stripping mention" };
  }

  const skipped = tryInferMentionDraftWithoutAi(userText, todayJst);
  if (skipped) {
    return { ...base, ok: true, draft: skipped, skippedInfer: true };
  }

  if (!config.ai) {
    return { ...base, ok: false, error: "Workers AI binding is not configured" };
  }

  const result = await runAbsenceMentionAi(config, todayJst, userText);
  if (result.error) {
    return {
      ...base,
      ok: false,
      aiResponse: result.lastResponse,
      aiLog: result.lastResponse ? describeAiRunForLog(result.lastResponse) : undefined,
      error: result.error.message
    };
  }
  if (!result.draft) {
    return {
      ...base,
      ok: false,
      aiResponse: result.lastResponse,
      aiLog: result.lastResponse ? describeAiRunForLog(result.lastResponse) : undefined,
      error: "invalid_ai_output"
    };
  }

  return {
    ...base,
    ok: true,
    draft: result.draft,
    aiResponse: result.lastResponse,
    aiLog: result.lastResponse ? describeAiRunForLog(result.lastResponse) : undefined
  };
};
