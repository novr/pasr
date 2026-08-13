const truncateLine = (line: string, maxChars: number): string => {
  if (line.length <= maxChars) return line;
  if (maxChars <= 1) return "…";
  return `${line.slice(0, maxChars - 1)}…`;
};

const prependDayHeaderIfNeeded = (previousLines: string[], nextLines: string[]): string[] => {
  if (nextLines.length === 0 || nextLines[0]?.startsWith("*")) {
    return nextLines;
  }
  if (!nextLines[0]?.startsWith("•")) {
    return nextLines;
  }
  const lastHeader = [...previousLines].reverse().find((line) => line.startsWith("*"));
  if (!lastHeader) {
    return nextLines;
  }
  return [lastHeader, ...nextLines];
};

const fitLinesByMaxChars = (
  lines: string[],
  maxChars: number
): { visibleLines: string[]; omittedCount: number } => {
  let visibleLines: string[] = [];
  for (const line of lines) {
    const normalizedLine = truncateLine(line, maxChars);
    const trialLines = [...visibleLines, normalizedLine];
    const trial = trialLines.join("\n");
    if (trial.length > maxChars) {
      break;
    }
    visibleLines = trialLines;
  }

  if (visibleLines.length === 0 && lines.length > 0) {
    return { visibleLines: [truncateLine(lines[0]!, maxChars)], omittedCount: lines.length - 1 };
  }

  return { visibleLines, omittedCount: lines.length - visibleLines.length };
};

export const splitLinesByTextMax = (lines: string[], maxChars: number): string[] => {
  if (lines.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  let remaining = lines;
  while (remaining.length > 0) {
    const { visibleLines, omittedCount } = fitLinesByMaxChars(remaining, maxChars);
    if (visibleLines.length === 0) {
      chunks.push(truncateLine(remaining[0]!, maxChars));
      remaining = remaining.slice(1);
      continue;
    }
    chunks.push(visibleLines.join("\n"));
    if (omittedCount === 0) {
      break;
    }
    let nextRemaining = remaining.slice(visibleLines.length);
    const showedEntryOnChunk = visibleLines.some((line) => line.startsWith("•"));
    if (showedEntryOnChunk) {
      nextRemaining = prependDayHeaderIfNeeded(visibleLines, nextRemaining);
    }
    remaining = nextRemaining;
  }
  return chunks;
};

export const labelSplitTextParts = (parts: string[]): string[] => {
  if (parts.length <= 1) {
    return parts;
  }
  return parts.map((part, index) => `_${index + 1}/${parts.length}_\n${part}`);
};
