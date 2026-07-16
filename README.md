# PASR

Slack に不在予定を書き、平日 JST 9:00 にまとめて知らせる。Cloudflare Workers と D1 が本体だ。

挙動の境界（何を補完しないか、いつ queue に載せないか）は [`AGENTS.md`](AGENTS.md) を見る。ここは初回セットアップから deploy、障害時の手戻りまでの順序だけを書く。

## 初回セットアップ

clone しただけでは動かない。`pasr-db` と `PASR_STATE` の ID は環境ごとに違う。Slack は manifest を貼っても **Reinstall** するまでイベントが届かないことがある。

1. `npm install`
2. 初回のみ `npx wrangler d1 create pasr-db` と `npx wrangler kv namespace create PASR_STATE` — 返ってきた ID を [`wrangler.jsonc`](wrangler.jsonc) に書く
3. `npm run db:migrate:local`（本番は `npx wrangler d1 migrations apply pasr-db --remote`）
4. Secrets を入れる: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `RUN_ENDPOINT_TOKEN`（`npx wrangler secret put`）
5. [`slack-app-manifest.json.template`](slack-app-manifest.json.template) を Slack App Manifest に貼る。`REPLACE_WITH_WORKER_URL` を Worker の URL に直し、**Reinstall**
6. Dashboard Variables に最低 `SLACK_ADMIN_USER_IDS`。ローカルは [`cp .dev.vars.example .dev.vars`](.dev.vars.example)
7. 初回 deploy の前に Queue: `npx wrangler queues create pasr-admin-tasks`

`wrangler.jsonc` の `vars` は `TZ` だけ。それ以外の平文設定は Dashboard か `.dev.vars`。`keep_vars: true` なので deploy しても Dashboard の値は残る。

## 開発

Node 24（`mise.toml` と CI が同じ）。

| コマンド | 用途 |
|----------|------|
| `npm run check` | 型チェック |
| `npm test` | 単体テスト |
| `npm run dev` | ローカル Worker（`--persist-to=./.wrangler/state`） |

実装が一段落したら `npm run check && npm test` を通す。PR の前でも、deploy の前でも。

mention AI の結合テストは CI に入っていない。別ターミナルで `npm run dev` を立て、`.dev.vars` に `DEBUG_ENDPOINTS_ENABLED=true` などを入れたうえで `npm run test:integration` を実行する。

## デプロイ

本番へ上げる流れは次のとおり。

```bash
npm run check && npm test
npx wrangler d1 migrations apply pasr-db --remote   # schema を変えたとき
npm run deploy
curl https://<worker>/health
```

deploy のあと、Cloudflare Dashboard の **Bindings** が `wrangler.jsonc` と食い違っていないか確認する。ここがずれると本番だけ D1 が別物を指す。

ローカルで叩くなら `npm run dev` のあと、`/health`、Bearer 付き `POST /run`、`GET /__scheduled` で足りる。

## 運用

ログは JSON。`event=daily_notify_done` で `run_id` と `errors` を追う。

障害で当日分をやり直すときは、原因を直してから Bearer 付き `POST /run` を叩く。終わったら Slack で同じ CH に投稿が二重になっていないか見る。日次通知は `chat.update` で上書きする設計なので、ts がずれると古い本文が残る。
