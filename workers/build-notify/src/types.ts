export const PASR_WORKER_NAME = "pasr-absence-notifier";

export interface Env {
  SLACK_WEBHOOK_URL: string;
  CLOUDFLARE_API_TOKEN?: string;
}

export interface CloudflareEvent {
  type: string;
  source: {
    type: string;
    workerName?: string;
  };
  payload: {
    buildUuid: string;
    status: string;
    buildOutcome: "success" | "failure" | "canceled" | "cancelled" | null;
    createdAt: string;
    stoppedAt?: string;
    buildTriggerMetadata?: BuildTriggerMetadata;
  };
  metadata: {
    accountId: string;
    eventTimestamp: string;
  };
}

export interface BuildTriggerMetadata {
  branch: string;
  commitHash: string;
  commitMessage: string;
  author: string;
  repoName: string;
  providerAccountName: string;
  providerType: string;
}

export interface BuildStatus {
  isSucceeded: boolean;
  isFailed: boolean;
  isCancelled: boolean;
}

export interface BuildDetailsResponse {
  result?: {
    preview_url?: string;
  };
}

export interface SubdomainResponse {
  result?: {
    subdomain?: string;
  };
}

export interface LogsResponse {
  result?: {
    lines?: [number, string][];
    truncated?: boolean;
    cursor?: string;
  };
}
