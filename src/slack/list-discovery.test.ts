import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { createListDiscovery, LIST_DISCOVERY_MAX_PAGES } from "./list-discovery";

const config = createTestConfig(createMockKv());

const listFile = (id: string, name: string) => ({
  id,
  name,
  filetype: "list"
});

describe("createListDiscovery", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("collects list files from files.list", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          files: [listFile("L1", "absence_list")],
          paging: { page: 1, pages: 1 }
        }),
        { status: 200 }
      )
    );

    const discovery = await createListDiscovery(config);
    expect(discovery.findByExactName("absence_list")).toEqual(["L1"]);
  });

  it("passes user filter to files.list", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, files: [], paging: { page: 1, pages: 1 } }), { status: 200 })
    );

    await createListDiscovery(config, { userId: "U_BOT" });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("user=U_BOT");
  });

  it("truncates scan at maxPages", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, files: [listFile("L1", "absence_list")], paging: { page: 1, pages: 3 } }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, files: [], paging: { page: 2, pages: 3 } }), { status: 200 })
      );

    const discovery = await createListDiscovery(config, { maxPages: 1 });
    expect(discovery.listAll()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(LIST_DISCOVERY_MAX_PAGES).toBe(10);
  });

  it("returns empty discovery for skippable lookup errors", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "unknown_method" }), { status: 200 })
    );

    const discovery = await createListDiscovery(config);
    expect(discovery.listAll()).toEqual([]);
  });
});
