export const consumeInteractionMessage = async (responseUrl: string | undefined): Promise<void> => {
  if (!responseUrl) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "interaction_consume_skipped",
        reason: "missing_response_url"
      })
    );
    return;
  }
  try {
    const response = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ delete_original: true })
    });
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "interaction_consume_failed",
          status: response.status
        })
      );
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "interaction_consume_failed",
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }
};
