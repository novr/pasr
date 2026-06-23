import { describe, expect, it } from "vitest";
import { ABSENCE_LIST_NAME, absenceSchema } from "./absence";
import {
  buildArchivedListName,
  evaluateSchemaStatus,
  hasExpectedAbsenceSchema,
  isArchivedListName,
  isPasrManagedListName,
  pasrManagedListBaseName
} from "./list-schema";
import { MEMBER_MASTER_LIST_NAME } from "./member-master";

describe("list-schema", () => {
  it("buildArchivedListName formats archived name", () => {
    expect(buildArchivedListName(ABSENCE_LIST_NAME, "F123")).toBe("absence_list__archived__F123");
  });

  it("isPasrManagedListName matches active and archived names", () => {
    expect(isPasrManagedListName(ABSENCE_LIST_NAME)).toBe(true);
    expect(isPasrManagedListName(buildArchivedListName(ABSENCE_LIST_NAME, "X"))).toBe(true);
    expect(isPasrManagedListName("other_list")).toBe(false);
  });

  it("isArchivedListName rejects partial archived prefix", () => {
    expect(isArchivedListName(ABSENCE_LIST_NAME, "absence_list__archived")).toBe(false);
  });

  it("pasrManagedListBaseName resolves base names", () => {
    expect(pasrManagedListBaseName(MEMBER_MASTER_LIST_NAME)).toBe(MEMBER_MASTER_LIST_NAME);
    expect(pasrManagedListBaseName(buildArchivedListName(MEMBER_MASTER_LIST_NAME, "Y"))).toBe(
      MEMBER_MASTER_LIST_NAME
    );
    expect(pasrManagedListBaseName("random")).toBeUndefined();
  });

  it("evaluateSchemaStatus combines version and shape", () => {
    expect(evaluateSchemaStatus(1, 1, true)).toEqual({
      versionUpToDate: true,
      shapeUpToDate: true,
      upToDate: true
    });
    expect(evaluateSchemaStatus(0, 1, true).upToDate).toBe(false);
    expect(evaluateSchemaStatus(1, 1, false).upToDate).toBe(false);
  });

  it("hasExpectedAbsenceSchema fails when required column is missing", () => {
    const partial = absenceSchema.slice(0, 2).map((spec) => ({
      key: spec.key,
      name: spec.name,
      type: spec.type,
      ...("is_primary_column" in spec ? { is_primary_column: spec.is_primary_column } : {})
    }));
    expect(hasExpectedAbsenceSchema(partial)).toBe(false);
  });

  it("hasExpectedAbsenceSchema passes for full schema shape", () => {
    const columns = absenceSchema.map((spec) => ({
      key: spec.key,
      name: spec.name,
      type: spec.type,
      ...("is_primary_column" in spec ? { is_primary_column: spec.is_primary_column } : {}),
      ...("options" in spec ? { options: spec.options } : {})
    }));
    expect(hasExpectedAbsenceSchema(columns)).toBe(true);
  });
});
