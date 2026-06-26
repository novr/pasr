import type { AppConfig } from "../config";
import { slackApi } from "./api";
import { buildAppHomeBlocks, buildAppHomeStaticFallbackBlocks } from "./app-home-blocks";
import { loadAppHomeData } from "./app-home-data";

export const publishAppHome = async (config: AppConfig, userId: string): Promise<void> => {
  let blocks: Array<Record<string, unknown>>;
  try {
    const data = await loadAppHomeData(config, userId);
    blocks = buildAppHomeBlocks(data);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "app_home_data_load_failed",
        user_id: userId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    blocks = buildAppHomeStaticFallbackBlocks();
  }

  await slackApi.publishHomeView(config, userId, blocks);
  console.log(
    JSON.stringify({
      level: "info",
      event: "app_home_published",
      user_id: userId
    })
  );
};

export const refreshAppHomeAfterMutation = async (
  config: AppConfig,
  userId: string
): Promise<void> => {
  try {
    await publishAppHome(config, userId);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "app_home_refresh_failed",
        user_id: userId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }
};
