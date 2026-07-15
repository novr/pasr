import type { AppConfig } from "../config";
import { isStatusOAuthEnabled, resolvePublicBaseUrl } from "../config";
import { checkSlackUserOAuthSchema } from "../db/schema-check";
import { upsertSlackUserOAuth } from "../db/slack-user-oauth-repository";
import { buildOAuthStartUrl, consumeOAuthState, issueOAuthState, readOAuthState } from "./oauth-state";

const OAUTH_USER_SCOPE = "users.profile:write";
const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

const htmlResponse = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });

const isOAuthRouteEnabled = async (config: AppConfig): Promise<boolean> => {
  if (!isStatusOAuthEnabled(config)) return false;
  const schema = await checkSlackUserOAuthSchema(config);
  return schema === "ok";
};

const buildRedirectUri = (request: Request, config: AppConfig): string => {
  const base = resolvePublicBaseUrl(request, config);
  return `${base.replace(/\/$/, "")}/slack/oauth/callback`;
};

const buildAuthorizeUrl = (params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string => {
  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("user_scope", OAUTH_USER_SCOPE);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
};

const hasRequiredScope = (scope: string | undefined): boolean => {
  if (!scope) return false;
  return scope.split(",").map((entry) => entry.trim()).includes(OAUTH_USER_SCOPE);
};

type OAuthAccessResponse = {
  authed_user?: {
    id?: string;
    access_token?: string;
    scope?: string;
  };
};

export const handleOAuthStart = async (request: Request, config: AppConfig): Promise<Response> => {
  if (!(await isOAuthRouteEnabled(config))) {
    return new Response("Not Found", { status: 404 });
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const payload = await readOAuthState(config.stateKv, state);
  if (!payload) {
    console.warn(JSON.stringify({ level: "warn", event: "oauth_state_invalid" }));
    return new Response("Bad Request", { status: 400 });
  }
  const redirectUri = buildRedirectUri(request, config);
  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.slackClientId,
    redirectUri,
    state
  });
  return Response.redirect(authorizeUrl, 302);
};

export const handleOAuthCallback = async (request: Request, config: AppConfig): Promise<Response> => {
  if (!(await isOAuthRouteEnabled(config))) {
    return new Response("Not Found", { status: 404 });
  }
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error === "access_denied") {
    return htmlResponse("<p>連携がキャンセルされました。Slack に戻ってください。</p>");
  }
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code) {
    console.warn(JSON.stringify({ level: "warn", event: "oauth_callback_invalid" }));
    return htmlResponse("<p>連携に失敗しました。もう一度お試しください。</p>", 400);
  }
  const statePayload = await consumeOAuthState(config.stateKv, state);
  if (!statePayload) {
    console.warn(JSON.stringify({ level: "warn", event: "oauth_state_invalid" }));
    return htmlResponse("<p>連携の有効期限が切れました。/pasr settings から再度お試しください。</p>", 400);
  }
  const redirectUri = buildRedirectUri(request, config);
  const body = new URLSearchParams({
    client_id: config.slackClientId,
    client_secret: config.slackClientSecret,
    code,
    redirect_uri: redirectUri
  });
  let accessResponse: OAuthAccessResponse;
  try {
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const json = (await res.json()) as OAuthAccessResponse & { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "oauth_token_exchange_failed",
          slack_error: json.error ?? "unknown"
        })
      );
      return htmlResponse("<p>連携に失敗しました。もう一度お試しください。</p>", 400);
    }
    accessResponse = json;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "oauth_token_exchange_failed",
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return htmlResponse("<p>連携に失敗しました。もう一度お試しください。</p>", 500);
  }
  const authedUser = accessResponse.authed_user;
  const authedUserId = authedUser?.id ?? "";
  const accessToken = authedUser?.access_token ?? "";
  const scope = authedUser?.scope ?? "";
  if (authedUserId !== statePayload.userId) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "oauth_user_mismatch",
        expected_user_id: statePayload.userId,
        authed_user_id: authedUserId
      })
    );
    return htmlResponse("<p>連携に失敗しました。もう一度お試しください。</p>", 400);
  }
  if (!accessToken || !hasRequiredScope(scope)) {
    console.warn(JSON.stringify({ level: "warn", event: "oauth_scope_missing", user_id: authedUserId }));
    return htmlResponse("<p>必要な権限が付与されませんでした。もう一度お試しください。</p>", 400);
  }
  try {
    await upsertSlackUserOAuth(config, {
      userId: authedUserId,
      accessToken,
      scope
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "oauth_token_save_failed",
        user_id: authedUserId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return htmlResponse("<p>連携の保存に失敗しました。もう一度お試しください。</p>", 500);
  }
  console.log(JSON.stringify({ level: "info", event: "oauth_linked", user_id: authedUserId }));
  return htmlResponse("<p>連携完了。Slack に戻ってください。</p>");
};

export const issueOAuthStartUrlForUser = async (
  config: AppConfig,
  userId: string,
  publicBaseUrl: string
): Promise<string | null> => {
  if (!isStatusOAuthEnabled(config)) return null;
  const schema = await checkSlackUserOAuthSchema(config);
  if (schema !== "ok") return null;
  const nonce = await issueOAuthState(config.stateKv, userId);
  return buildOAuthStartUrl(publicBaseUrl, nonce);
};
