import type { AppConfig } from "../config";
import { isSkippableSlackLookupError, slackApiGet } from "../slack/client";

export const LIST_DISCOVERY_MAX_PAGES = 10;

export type SlackListFile = {
  id: string;
  name: string;
};

type FilesListResponse = {
  files?: Array<{ id?: string; name?: string; filetype?: string }>;
  paging?: {
    page?: number;
    pages?: number;
  };
};

const SLACK_LIST_FILETYPE = "list";

const isSlackListFile = (file: {
  id?: string;
  name?: string;
  filetype?: string;
}): file is SlackListFile =>
  !!file.id && file.filetype === SLACK_LIST_FILETYPE && typeof file.name === "string";

type ScanListFilesResult = {
  lists: SlackListFile[];
  truncated: boolean;
  scannedPages: number;
  reportedPages: number;
};

const scanListFiles = async (
  config: AppConfig,
  options?: Pick<ListDiscoveryOptions, "userId" | "maxPages">
): Promise<ScanListFilesResult> => {
  const lists: SlackListFile[] = [];
  let page = 1;
  let pages = 1;
  const maxPages = options?.maxPages ?? LIST_DISCOVERY_MAX_PAGES;
  let scannedPages = 0;
  do {
    const params: Record<string, string | number> = {
      count: 200,
      page
    };
    if (options?.userId) {
      params.user = options.userId;
    }
    const response = await slackApiGet<FilesListResponse>(config, "files.list", params);
    for (const file of response.files ?? []) {
      if (isSlackListFile(file)) lists.push(file);
    }
    pages = response.paging?.pages ?? page;
    scannedPages = page;
    page += 1;
    if (page > maxPages) break;
  } while (page <= pages);
  return {
    lists,
    truncated: pages > scannedPages,
    scannedPages,
    reportedPages: pages
  };
};

const logFilesListTruncated = (scan: ScanListFilesResult, maxPages: number): void => {
  if (!scan.truncated) return;
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "files_list_truncated",
      max_pages: maxPages,
      scanned_pages: scan.scannedPages,
      reported_pages: scan.reportedPages
    })
  );
};

export type ListDiscovery = {
  findByExactName: (listName: string) => string[];
  findByNamePrefix: (namePrefix: string) => SlackListFile[];
  listAll: () => SlackListFile[];
};

export type ListDiscoveryOptions = {
  userId?: string;
  maxPages?: number;
};

export const createListDiscovery = async (
  config: AppConfig,
  options?: ListDiscoveryOptions
): Promise<ListDiscovery> => {
  const maxPages = options?.maxPages ?? LIST_DISCOVERY_MAX_PAGES;
  try {
    const scan = await scanListFiles(config, { userId: options?.userId, maxPages });
    logFilesListTruncated(scan, maxPages);
    const lists = scan.lists;
    return {
      findByExactName: (listName) => lists.filter((file) => file.name === listName).map((file) => file.id),
      findByNamePrefix: (namePrefix) => lists.filter((file) => file.name.startsWith(namePrefix)),
      listAll: () => lists
    };
  } catch (error) {
    if (!isSkippableSlackLookupError(error)) throw error;
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "files_list_lookup_skipped",
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return {
      findByExactName: () => [],
      findByNamePrefix: () => [],
      listAll: () => []
    };
  }
};
