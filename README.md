# PASR

Slack から不在予定を登録し、平日 JST 9:00 に日次通知する（Cloudflare Workers + D1）。

挙動の境界 → [`AGENTS.md`](AGENTS.md)

## 初回セットアップ

1. `npm install`
2. 初回のみ: `npx wrangler d1 create pasr-db` / `npx wrangler kv namespace create PASR_STATE` → 返却 ID を [`wrangler.jsonc`](wrangler.jsonc) に反映
3. `npm run db:migrate:local`（本番: `npx wrangler d1 migrations apply pasr-db --remote`）
4. Secrets: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `RUN_ENDPOINT_TOKEN`
5. [`slack-app-manifest.json.template`](slack-app-manifest.json.template) を Slack に反映 → URL 置換 → **Reinstall**
6. Dashboard Variables: 最低 `SLACK_ADMIN_USER_IDS`。ローカルは [`cp .dev.vars.example .dev.vars`](.dev.vars.example)
7. 初回 deploy 前: `npx wrangler queues create pasr-admin-tasks`

`vars` は `TZ` のみ（他は Dashboard / `.dev.vars`）。`keep_vars: true` で Dashboard を deploy 時に保持。

## 開発

Node 24。`npm run check` / `npm test` / `npm run dev`（`--persist-to=./.wrangler/state`）。

実装完了・PR 前・deploy 前: `npm run check && npm test`

mention AI 結合（CI 外）: dev 起動 + `.dev.vars`（`DEBUG_ENDPOINTS_ENABLED=true` 等）→ `npm run test:integration`

## デプロイ

```bash
npm run check && npm test
npx wrangler d1 migrations apply pasr-db --remote   # 必要時
npm run deploy
curl https://<worker>/health
# Dashboard Bindings が wrangler.jsonc と一致することを確認
```

ローカル: `npm run dev` → `curl localhost:8787/health` / `POST /run`（Bearer）/ `GET /__scheduled`

## 運用

ログは JSON。障害時は修正後 `POST /run`（Bearer）で再実行。`event=daily_notify_done` の `errors` と Slack 重複（`chat.update`）を確認。
