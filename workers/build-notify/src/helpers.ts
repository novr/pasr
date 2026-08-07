import { PASR_WORKER_NAME, type BuildStatus, type CloudflareEvent } from "./types";

export const isPasrBuildEvent = (event: CloudflareEvent): boolean =>
  event.source?.workerName === PASR_WORKER_NAME;

export const getBuildStatus = (event: CloudflareEvent): BuildStatus => {
  const buildOutcome = event.payload?.buildOutcome;
  const isCancelled =
    buildOutcome === "canceled" ||
    buildOutcome === "cancelled" ||
    event.type?.includes("canceled") ||
    event.type?.includes("cancelled");
  const isFailed = event.type?.includes("failed") && !isCancelled;
  const isSucceeded = event.type?.includes("succeeded");
  return { isSucceeded, isFailed, isCancelled };
};

export const isProductionBranch = (branch: string | undefined): boolean => {
  if (!branch) return true;
  return ["main", "master", "production", "prod"].includes(branch.toLowerCase());
};

export const extractAuthorName = (author: string | undefined): string | null => {
  if (!author) return null;
  if (author.includes("@")) {
    const name = author.split("@")[0];
    return name || author;
  }
  return author;
};

export const getCommitUrl = (event: CloudflareEvent): string | null => {
  const meta = event.payload?.buildTriggerMetadata;
  if (!meta?.repoName || !meta?.commitHash || !meta?.providerAccountName) {
    return null;
  }
  if (meta.providerType === "github") {
    return `https://github.com/${meta.providerAccountName}/${meta.repoName}/commit/${meta.commitHash}`;
  }
  if (meta.providerType === "gitlab") {
    return `https://gitlab.com/${meta.providerAccountName}/${meta.repoName}/-/commit/${meta.commitHash}`;
  }
  return null;
};

export const getDashboardUrl = (event: CloudflareEvent): string | null => {
  const accountId = event.metadata?.accountId;
  const buildUuid = event.payload?.buildUuid;
  const workerName = event.source?.workerName ?? PASR_WORKER_NAME;
  if (!accountId || !buildUuid) return null;
  return `https://dash.cloudflare.com/${accountId}/workers/services/view/${workerName}/production/builds/${buildUuid}`;
};

const IGNORE_PATTERNS = [
  /^Total Upload:/i,
  /^Total Size:/i,
  /\/\s*gzip:/i,
  /^\d+\.\d+\s*(KiB|MiB|B)/i,
  /^Uploaded/i,
  /^Published/i,
  /^Worker Startup Time:/i,
  /^🌀/
];

const ERROR_PATTERNS = [/^✘\s*\[ERROR\]/i, /^\[ERROR\]/i, /^ERROR:/i, /^Error:/, /^❌/];

const ERROR_KEYWORDS = [
  "Module not found",
  "Cannot find module",
  "Compilation failed",
  "Build failed",
  "SyntaxError:",
  "TypeError:",
  "ReferenceError:",
  "failed to",
  "Failed to"
];

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.substring(0, maxLength)}...` : value;

export const escapeSlackCodeBlock = (text: string): string => text.replace(/```/g, "'''");

export const extractBuildError = (logs: string[]): string => {
  if (logs.length === 0) return "No logs available";

  for (let index = 0; index < logs.length; index += 1) {
    const line = logs[index];
    if (!line?.trim() || line.trim().startsWith("at ")) continue;
    if (IGNORE_PATTERNS.some((pattern) => pattern.test(line))) continue;
    if (ERROR_PATTERNS.some((pattern) => pattern.test(line))) {
      let errorMsg = line.trim();
      const nextLine = logs[index + 1]?.trim();
      if (
        nextLine &&
        !nextLine.startsWith("at ") &&
        !IGNORE_PATTERNS.some((pattern) => pattern.test(nextLine))
      ) {
        errorMsg += `\n${nextLine}`;
      }
      return truncate(errorMsg, 500);
    }
  }

  for (const line of logs) {
    if (!line?.trim() || IGNORE_PATTERNS.some((pattern) => pattern.test(line))) continue;
    if (ERROR_KEYWORDS.some((keyword) => line.includes(keyword))) {
      return truncate(line.trim(), 500);
    }
  }

  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const line = logs[index]?.trim();
    if (line && !IGNORE_PATTERNS.some((pattern) => pattern.test(line))) {
      return truncate(line, 500);
    }
  }

  return "Build failed";
};
