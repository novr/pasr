import { describe, expect, it, beforeAll } from "vitest";
import {
  MENTION_AI_INTEGRATION_TODAY,
  MENTION_AI_MODEL_CASES
} from "./mention-ai-cases";
import {
  callDebugMentionAi,
  isMentionAiIntegrationEnabled,
  isMentionAiIntegrationReady
} from "./mention-ai-client";

const assertDraftNote = (
  draft: { note?: string },
  expectNote: { noteExact?: string; noteIncludes?: string }
): void => {
  const note = draft.note?.trim() ?? "";
  expect(note.length, "note should not be empty").toBeGreaterThan(0);
  if (expectNote.noteExact) {
    expect(note).toBe(expectNote.noteExact);
  }
  if (expectNote.noteIncludes) {
    expect(note).toContain(expectNote.noteIncludes);
  }
};

describe.runIf(isMentionAiIntegrationEnabled())("mention-ai integration", () => {
  beforeAll(async () => {
    const check = await isMentionAiIntegrationReady();
    if (!check.ready) {
      throw new Error(`mention-ai integration prerequisites not met: ${check.reason}`);
    }
  });

  it.each(MENTION_AI_MODEL_CASES)("$id", async (testCase) => {
    const { status, body } = await callDebugMentionAi({
      text: testCase.text,
      todayJst: MENTION_AI_INTEGRATION_TODAY
    });

    expect(status, body.error ?? "unexpected status").toBe(200);
    expect(body.ok, body.error ?? "integration call failed").toBe(true);
    expect(body.todayJst).toBe(MENTION_AI_INTEGRATION_TODAY);
    expect(body.userText).toBe(testCase.text);
    expect(body.draft).toBeDefined();

    const draft = body.draft!;
    const dateStrict = testCase.expect.dateStrict !== false;
    if (dateStrict) {
      expect(draft.startDate).toBe(testCase.expect.startDate);
      expect(draft.endDate).toBe(testCase.expect.endDate);
    } else {
      expect(draft.startDate.length).toBeGreaterThan(0);
      expect(draft.endDate.length).toBeGreaterThan(0);
      expect(draft.endDate >= draft.startDate).toBe(true);
    }
    assertDraftNote(draft, testCase.expect);
  });

  it.skipIf(!process.env.PASR_MENTION_AI_TEXT?.trim())("@cli ad-hoc input", async () => {
    const text = process.env.PASR_MENTION_AI_TEXT?.trim() ?? "";
    if (!text) {
      throw new Error('Set PASR_MENTION_AI_TEXT or run: npm run debug:mention-ai -- "明日 通院"');
    }

    const todayJst = process.env.PASR_TODAY_JST ?? MENTION_AI_INTEGRATION_TODAY;
    const { status, body } = await callDebugMentionAi({ text, todayJst });

    console.log(JSON.stringify(body, null, 2));
    expect(status).toBe(body.ok ? 200 : 422);
    expect(body.userText.length).toBeGreaterThan(0);
  });
});
