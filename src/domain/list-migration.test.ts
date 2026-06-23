import { describe, expect, it } from "vitest";
import {
  mergeListIds,
  needsMigrationDataRecoveryFromCounts,
  pickMigrationSourceListId,
  shouldSkipListKindMigration
} from "./list-migration";

describe("list-migration", () => {
  it("mergeListIds dedupes and drops empty", () => {
    expect(mergeListIds("F1", undefined, "F2", "F1")).toEqual(["F1", "F2"]);
  });

  it("pickMigrationSourceListId prefers persisted id", () => {
    expect(pickMigrationSourceListId(["F_OLD", "F_NEW"], "F_OLD")).toBe("F_OLD");
    expect(pickMigrationSourceListId(["F_OLD", "F_NEW"], "F_KV")).toBe("F_OLD");
  });

  it("pickMigrationSourceListId returns first when persisted is absent", () => {
    expect(pickMigrationSourceListId(["F_A", "F_B"], undefined)).toBe("F_A");
    expect(pickMigrationSourceListId([], "F_KV")).toBeUndefined();
  });

  it("needsMigrationDataRecoveryFromCounts detects empty active with sibling rows", () => {
    expect(
      needsMigrationDataRecoveryFromCounts("F_ACTIVE", {
        F_ACTIVE: 0,
        F_OLD: 3
      })
    ).toBe(true);
    expect(
      needsMigrationDataRecoveryFromCounts("F_ACTIVE", {
        F_ACTIVE: 2,
        F_OLD: 3
      })
    ).toBe(false);
    expect(
      needsMigrationDataRecoveryFromCounts("F_ACTIVE", {
        F_ACTIVE: 0,
        F_OLD: 0
      })
    ).toBe(false);
  });

  it("shouldSkipListKindMigration skips up-to-date lists without recovery", () => {
    expect(
      shouldSkipListKindMigration(
        { upToDate: true, shapeUpToDate: true, versionUpToDate: true },
        false
      )
    ).toBe(true);
    expect(
      shouldSkipListKindMigration(
        { upToDate: false, shapeUpToDate: true, versionUpToDate: false },
        false
      )
    ).toBe(true);
  });

  it("shouldSkipListKindMigration runs migration when shape is outdated", () => {
    expect(
      shouldSkipListKindMigration(
        { upToDate: false, shapeUpToDate: false, versionUpToDate: false },
        false
      )
    ).toBe(false);
  });

  it("shouldSkipListKindMigration forces migration on data recovery", () => {
    expect(
      shouldSkipListKindMigration(
        { upToDate: true, shapeUpToDate: true, versionUpToDate: true },
        true
      )
    ).toBe(false);
  });
});
