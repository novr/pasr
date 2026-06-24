import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeInteractionMessage } from "./interaction-message";

describe("consumeInteractionMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts delete_original to response_url", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await consumeInteractionMessage("https://hooks.slack.com/actions/T1/2/3");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/actions/T1/2/3",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ delete_original: true })
      })
    );
  });

  it("skips when response_url is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await consumeInteractionMessage(undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
