# PASR

Slack 上の不在予定を登録し、平日 JST 9:00 に日次通知する Cloudflare Workers + D1 アプリケーション。

挙動の不変条件は [`AGENTS.md`](AGENTS.md) を参照。本文はセットアップ・開発・デプロイ・運用の手順のみを記載する。

## 初回セットアップ

D1 / KV の ID は環境ごとに異なる。Slack App は manifest 反映後に **Reinstall to Workspace** が必要。

1. `npm install`
2. 初回のみ `npx wrangler d1 create pasr-db` および `npx wrangler kv namespace create PASR_STATE` — 返却 ID を [`wrangler.jsonc`](wrangler.jsonc) に設定
3. `npm run db:migrate:local`（本番: `npx wrangler d1 migrations apply pasr-db --remote`）
4. Secrets: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `RUN_ENDPOINT_TOKEN`（`npx wrangler secret put`）
5. [`slack-app-manifest.json.template`](slack-app-manifest.json.template) を Slack App Manifest に反映。`REPLACE_WITH_WORKER_URL` を Worker URL に置換し **Reinstall**
6. Dashboard Variables に `SLACK_ADMIN_USER_IDS`（必須）を設定。ローカルは [`cp .dev.vars.example .dev.vars`](.dev.vars.example)
7. 初回 deploy 前: `npx wrangler queues create pasr-admin-tasks`

`wrangler.jsonc` の `vars` は `TZ` のみ。その他の平文設定は Dashboard または `.dev.vars`。`keep_vars: true` により deploy 時も Dashboard Variables を保持する。

## 開発

Node.js 24（`mise.toml` / CI と同一）。

| コマンド | 用途 |
|----------|------|
| `npm run check` | 型チェック |
| `npm test` | 単体テスト |
| `npm run dev` | ローカル Worker（`--persist-to=./.wrangler/state`） |

実装完了・PR 前・deploy 前に `npm run check && npm test` を実行する。

mention AI 結合テストは CI 対象外。`npm run dev` 起動中に `.dev.vars`（`DEBUG_ENDPOINTS_ENABLED=true` 等）を設定し、`npm run test:integration` を実行する。

## デプロイ

```bash
npm run check && npm test
npx wrangler d1 migrations apply pasr-db --remote   # schema 変更時
npm run deploy
curl https://<worker>/health
```

deploy 後、Cloudflare Dashboard の **Bindings** が `wrangler.jsonc` と一致することを確認する。

ローカル確認: `npm run dev` 起動後、`GET /health`、Bearer 付き `POST /run`、`GET /__scheduled`。

## 運用

ログは JSON 形式。`event=daily_notify_done` の `run_id` / `errors` を確認する。`sent` は CH+DM 合計、内訳は `sent_channels` / `sent_dms`。土日の scheduled は通知せず ops レポートのみ（`skip_weekend_scheduled_notify`）。

障害時は原因を修正のうえ Bearer 付き `POST /run` で当日分を再実行する。再実行後、Slack 上の CH 通知が `chat.update` により重複していないことを確認する（KV の ts 不整合時は旧メッセージが残る）。
