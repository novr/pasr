export type RunSentCounts = {
  sent: number;
  sentChannels?: number;
  sentDms?: number;
};

export const formatRunSentForAdmin = (counts: RunSentCounts): string => {
  if (counts.sentChannels !== undefined && counts.sentDms !== undefined) {
    return `sent=${counts.sent} (ch=${counts.sentChannels}, dm=${counts.sentDms})`;
  }
  return `sent=${counts.sent} (CH+DM)`;
};

export const formatRunSentForOps = (counts: RunSentCounts): string => {
  if (counts.sentChannels !== undefined && counts.sentDms !== undefined) {
    return `sent_channels=${counts.sentChannels} sent_dms=${counts.sentDms} sent=${counts.sent}`;
  }
  return `sent=${counts.sent}`;
};
