import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransientAdminTaskError } from "../errors/transient";
import { createMockKv, createTestConfig } from "../test/mock-kv";

const runSlackCommandAsync = vi.fn();
const notifySlashCommandEphemeral = vi.fn();

vi.mock("../slack/command", () => ({
  runSlackCommandAsync: (...args: unknown[]) => runSlackCommandAsync(...args),
  notifySlashCommandEphemeral: (...args: unknown[]) => notifySlashCommandEphemeral(...args),
  slashCommandLogFields: () => ({
    command: "/pasr-admin",
    action: "run",
    text: "run",
    user_id: "U1",
    team_id: "T1",
    trigger_id: "TR1",
    has_response_url: true
  })
}));

import { processAdminTaskBatch, type AdminTaskMessage } from "./admin-task";

const payload = {
  command: "/pasr-admin",
  text: "run",
  userId: "U1",
  teamId: "T1",
  channelId: "C1",
  triggerId: "TR1",
  responseUrl: "https://example.com"
};

const createBatch = () => {
  const ack = vi.fn();
  const retry = vi.fn();
  const message = {
    body: { payload } satisfies AdminTaskMessage,
    ack,
    retry
  };
  return {
    messages: [message],
    ack,
    retry
  };
};

describe("processAdminTaskBatch", () => {
  const config = createTestConfig(createMockKv());

  beforeEach(() => {
    runSlackCommandAsync.mockReset();
    notifySlashCommandEphemeral.mockReset();
  });

  it("acks on success", async () => {
    runSlackCommandAsync.mockResolvedValue(undefined);
    const batch = createBatch();
    await processAdminTaskBatch(config, batch as unknown as MessageBatch<AdminTaskMessage>);
    expect(batch.ack).toHaveBeenCalledTimes(1);
    expect(batch.retry).not.toHaveBeenCalled();
  });

  it("retries on transient errors", async () => {
    runSlackCommandAsync.mockRejectedValue(new TransientAdminTaskError("migration already in progress"));
    const batch = createBatch();
    await processAdminTaskBatch(config, batch as unknown as MessageBatch<AdminTaskMessage>);
    expect(batch.retry).toHaveBeenCalledTimes(1);
    expect(batch.ack).not.toHaveBeenCalled();
  });

  it("notifies and acks on permanent errors", async () => {
    runSlackCommandAsync.mockRejectedValue(new Error("permanent failure"));
    const batch = createBatch();
    await processAdminTaskBatch(config, batch as unknown as MessageBatch<AdminTaskMessage>);
    expect(notifySlashCommandEphemeral).toHaveBeenCalledTimes(1);
    expect(batch.ack).toHaveBeenCalledTimes(1);
    expect(batch.retry).not.toHaveBeenCalled();
  });
});
