# PASR Slack不在通知 App

Slack List を入力台帳として、Cloudflare Workers で平日の日次通知を実行します。  
Phase 2 は deploy-first 運用を優先し、初回デプロイから障害時再実行までをこの Runbook で完結させます。

## 運用の前提
- 判定時刻は JST（`Asia/Tokyo`）固定。
- 失敗はレコード単位で隔離し、全体処理は継続。
- 手動実行 endpoint `/run` は Bearer 認証必須。
- `scheduled` 実行は内部トリガーのため HTTP 認証対象外。

## 必須設定（Secrets / Vars / Binding）

### 1) 依存関係
- `npm install`

### 2) KV Namespace
- `npx wrangler kv namespace create PASR_STATE`
- 返却された namespace ID を `wrangler.jsonc` の `kv_namespaces[0].id` に反映

### 3) Cloudflare Secrets
- `npx wrangler secret put SLACK_BOT_TOKEN`
- `npx wrangler secret put SLACK_SIGNING_SECRET`
- `npx wrangler secret put RUN_ENDPOINT_TOKEN`

### 4) Vars（`wrangler.jsonc`）
- `vars.TZ=Asia/Tokyo`
- `vars.SLACK_ABSENCE_LIST_ID`（任意: 空なら setup/lazy setup で作成）
- `vars.SLACK_LIST_ACCESS_USER_IDS`（任意: カンマ区切り）

## デプロイ手順（deploy-first）

### dev
1. `npm run dev`
2. `curl http://localhost:8787/health`
3. `curl -H "Authorization: Bearer <RUN_ENDPOINT_TOKEN>" http://localhost:8787/run`
4. `curl http://localhost:8787/__scheduled`

### staging / prod
1. Secret が環境に投入済みであることを確認
2. `npx wrangler deploy`
3. `/health` で readiness を確認
4. `/run` をトークン付きで 1 回実行し、ログに run summary が出ることを確認

## 運用時の確認ポイント
- 実行ログは JSON を前提に確認する。
- `event=daily_notify_done` を基点に、以下を最低限追跡する:
  - `run_id`
  - `listId`
  - `processed`
  - `sent`
  - `skipped`
  - `errors`
- skip は `event=skip_record` の `reason` で確認する（例: `missing_notify_channels`, `invalid_date_range`）。

## 再実行 Runbook（障害時）
1. 失敗 run の `run_id` とエラーイベントを確認
2. 原因（Slack 側データ不備、token 期限、チャネル権限など）を修正
3. 当日分を `/run` で再実行（Bearer 必須）
4. `daily_notify_done` の `errors=0` または許容範囲を確認
5. Slack 投稿が既存メッセージ更新（`chat.update`）で重複していないことを確認

## Endpoint 仕様（Phase 2）
- `GET /health`
  - 認証不要
  - `200 {"ok":true}`
- `GET /run`
  - `Authorization: Bearer <RUN_ENDPOINT_TOKEN>` 必須
  - 認証失敗時は `401 {"ok":false,"error":"Unauthorized"}`
- `scheduled`
  - 平日のみ実行
  - 週末は `skip_weekend_scheduled` を出力して終了

## スコープ境界
- Phase 2 で実施:
  - deploy-first Runbook 整備
  - `/run` 認証の導入
  - run summary ログキー統一
- Phase 2.x へ分離:
  - 高度な可観測性（ダッシュボード/集計ストア/時系列分析）
  - Slack 起点 endpoint の署名検証導線本実装
