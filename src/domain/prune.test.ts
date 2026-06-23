import { describe, expect, it, vi } from "vitest";
import { ABSENCE_LIST_NAME } from "./absence";
import { buildArchivedListName } from "./list-schema";
import {
  executePruneDeletes,
  isArchivedPruneCandidate,
  mergePruneTargets,
  PRUNE_MAX_DELETES_PER_RUN
} from "./prune";

describe("prune", () => {
  it("isArchivedPruneCandidate accepts archived flag and archived names", () => {
    expect(isArchivedPruneCandidate({ listId: "1", listName: ABSENCE_LIST_NAME, archived: true })).toBe(true);
    expect(
      isArchivedPruneCandidate({
        listId: "2",
        listName: buildArchivedListName(ABSENCE_LIST_NAME, "OLD")
      })
    ).toBe(true);
    expect(isArchivedPruneCandidate({ listId: "3", listName: ABSENCE_LIST_NAME })).toBe(false);
  });

  it("mergePruneTargets excludes active list ids", () => {
    const active = new Set(["active-1"]);
    const result = mergePruneTargets(
      [{ listId: "active-1", listName: buildArchivedListName(ABSENCE_LIST_NAME, "active-1"), archived: true }],
      [],
      active
    );
    expect(result.targets).toEqual([]);
  });

  it("mergePruneTargets merges pending and discovered targets", () => {
    const result = mergePruneTargets(
      [{ listId: "p1", listName: buildArchivedListName(ABSENCE_LIST_NAME, "p1"), archived: true }],
      [{ id: "d1", name: ABSENCE_LIST_NAME }],
      new Set(["active"])
    );
    expect(result.targets.map((t) => t.listId).sort()).toEqual(["d1", "p1"]);
  });

  it("mergePruneTargets ignores non-archived pending", () => {
    const result = mergePruneTargets(
      [{ listId: "live-1", listName: ABSENCE_LIST_NAME }],
      [],
      new Set(["active"])
    );
    expect(result.targets).toEqual([]);
  });

  it("mergePruneTargets caps deletes at max per run", () => {
    const pending = Array.from({ length: 41 }, (_, i) => ({
      listId: `id-${i}`,
      listName: buildArchivedListName(ABSENCE_LIST_NAME, `id-${i}`),
      archived: true
    }));
    const result = mergePruneTargets(pending, [], new Set(), PRUNE_MAX_DELETES_PER_RUN);
    expect(result.targets).toHaveLength(41);
    expect(result.toDelete).toHaveLength(40);
    expect(result.hasRemaining).toBe(true);
  });
});

describe("executePruneDeletes", () => {
  it("does not remove pending when deleteList fails", async () => {
    const target = {
      listId: "L_FAIL",
      listName: buildArchivedListName(ABSENCE_LIST_NAME, "L_FAIL"),
      archived: true
    };
    const deleteList = vi.fn().mockRejectedValue(new Error("files.delete failed"));
    const removePrunePending = vi.fn().mockResolvedValue(undefined);

    const result = await executePruneDeletes([target], { deleteList, removePrunePending });

    expect(deleteList).toHaveBeenCalledWith("L_FAIL");
    expect(removePrunePending).not.toHaveBeenCalled();
    expect(result.deletedIds).toEqual(new Set());
    expect(result.errorIds).toEqual(new Set(["L_FAIL"]));
  });
});
