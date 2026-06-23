import { describe, expect, it } from "vitest";
import { extractPlainText, toNoteText } from "./rich-text-plain";

describe("rich-text-plain", () => {
  it("extractPlainText reads rich_text blocks", () => {
    expect(
      extractPlainText([
        {
          type: "rich_text",
          elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "test" }] }]
        }
      ])
    ).toBe("test");
  });

  it("toNoteText handles rich_text field wrapper and JSON string", () => {
    const richText = [
      {
        type: "rich_text",
        block_id: "gB9fq",
        elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "test" }] }]
      }
    ];
    expect(toNoteText({ rich_text: richText })).toBe("test");
    expect(toNoteText(JSON.stringify(richText))).toBe("test");
    expect(toNoteText("plain note")).toBe("plain note");
  });

  it("toNoteText unwraps list field entry value containing JSON", () => {
    const richText = [
      {
        type: "rich_text",
        block_id: "gB9fq",
        elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "test" }] }]
      }
    ];
    expect(toNoteText({ key: "note", value: JSON.stringify(richText) })).toBe("test");
  });
});
