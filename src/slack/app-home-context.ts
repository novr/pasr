type AppHomeContextPayload = {
  type: string;
  container?: { type?: string };
  view?: { type?: string };
};

export const isAppHomeBlockActions = (payload: AppHomeContextPayload): boolean => {
  if (payload.type !== "block_actions") return false;
  return payload.container?.type === "view" && payload.view?.type === "home";
};
