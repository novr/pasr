import { MENTION_NOTE_MAX_LEN } from "./types";

export const truncateNote = (note: string): { note: string; truncated: boolean } => {
  if (note.length <= MENTION_NOTE_MAX_LEN) {
    return { note, truncated: false };
  }
  return { note: note.slice(0, MENTION_NOTE_MAX_LEN), truncated: true };
};

export const parseNoteField = (value: unknown): { note?: string; truncated: boolean } => {
  if (typeof value !== "string") return { note: undefined, truncated: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { note: undefined, truncated: false };
  const { note, truncated } = truncateNote(trimmed);
  return { note, truncated };
};
