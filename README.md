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

### 2) Wrangler 設定ファイル作成
- `cp wrangler.jsonc.template wrangler.jsonc`
- `wrangler.jsonc` は環境ごとの管理値を含むため git 管理しない

### 3) KV Namespace
- `npx wrangler kv namespace create PASR_STATE`
- 返却された namespace ID を `wrangler.jsonc` の `kv_namespaces[0].id` に反映

### 4) Cloudflare Secrets
- `npx wrangler secret put SLACK_BOT_TOKEN`
- `npx wrangler secret put SLACK_SIGNING_SECRET`
- `npx wrangler secret put RUN_ENDPOINT_TOKEN`

### 5) Vars（`wrangler.jsonc`）
- `vars.TZ=Asia/Tokyo`
- `vars.SLACK_ABSENCE_LIST_ID`（任意: 空なら setup/lazy setup で作成）
- `vars.SLACK_ADMIN_USER_IDS`（必須: カンマ区切り、Slash Command 実行許可ユーザー）

## デプロイ手順（deploy-first）

### dev
1. `npm run dev`
2. `curl http://localhost:8787/health`
3. `curl -X POST -H "Authorization: Bearer <RUN_ENDPOINT_TOKEN>" http://localhost:8787/run`
4. `curl http://localhost:8787/__scheduled`

### staging / prod
1. Secret が環境に投入済みであることを確認
2. `npx wrangler deploy`
3. `/health` で readiness を確認
4. `/run` を `POST` + トークン付きで 1 回実行し、ログに run summary が出ることを確認

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
- `POST /run`
  - `Authorization: Bearer <RUN_ENDPOINT_TOKEN>` 必須
  - 成功時レスポンスは最小化し `200 {"ok":true,"runId":"..."}` を返す
  - 認証失敗時は `401 {"ok":false,"error":"Unauthorized"}`
  - メソッド不正時は `405 {"ok":false,"error":"Method Not Allowed"}`
- `scheduled`
  - 平日のみ実行
  - 週末は `skip_weekend_scheduled` を出力して終了

## Endpoint 仕様（Phase 2.1: Slack Events）
- `POST /slack/events`
  - `X-Slack-Signature` / `X-Slack-Request-Timestamp` を `SLACK_SIGNING_SECRET` で検証
  - 署名検証は `request.text()` の生ボディを使って実施
  - 署名不正時は `401 {"ok":false,"error":"Unauthorized"}`
  - `url_verification` は `200 {"challenge":"..."}` を返す
  - `event_callback` は先に `200 {"ok":true}` を返し、後続処理は非同期で実行
  - 同一 `event_id` は KV 短期 TTL で重複抑止し、再送は捨てる
  - 重複抑止時は `duplicate_event_dropped` を構造化ログ出力

### Slack Events ローカル確認（署名あり）
1. 生ボディを準備  
   `BODY='{"type":"url_verification","challenge":"test-challenge"}'`
2. timestamp を作成  
   `TS=$(date +%s)`
3. 署名を作成  
   `SIG=$(printf "v0:%s:%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SLACK_SIGNING_SECRET" | sed 's/^.* //')`
4. 送信  
   `curl -X POST http://localhost:8787/slack/events -H "Content-Type: application/json" -H "X-Slack-Request-Timestamp: $TS" -H "X-Slack-Signature: v0=$SIG" --data "$BODY"`

## Endpoint 仕様（Phase 2.2: Slash Command）
- `POST /slack/command`
  - `X-Slack-Signature` / `X-Slack-Request-Timestamp` を `SLACK_SIGNING_SECRET` で検証
  - 署名検証は `request.text()` の生ボディを使って実施
  - 署名不正時は `401 {"ok":false,"error":"Unauthorized"}`
  - body 不正（必須フィールド不足）は `400 {"ok":false,"error":"Bad Request"}`
  - allowlist 判定は `SLACK_ADMIN_USER_IDS` で実施
  - allowlist 該当時の即時ACK本文: `Accepted`
  - allowlist 非該当時の即時ACK本文: `Received. Processing...`（実処理は行わない）
  - `trigger_id` をキーに TTL=300秒で重複抑止（重複時は no-op）
- 初期サブコマンド:
  - `/pasr run` -> daily notify 手動実行フローを非同期実行
  - `/pasr status` -> 直近 run 要約を表示（履歴がない場合は `No run history yet.`）
  - `/pasr help` -> 使い方を表示

## User Master（Phase #4）
- list 名は `member_master` を使用
- 主キー相当は `Target User`（Slack user entity）
- list 作成時は user 通知を無効（`notify_users=false`）
- `active` は checkbox フィールド（checked=true で通知対象、unchecked=false で通知停止）
- daily 実行時:
  - master 未登録ユーザーは自動 insert（`Target User`, `active=true`, `default_notify_channels` は absence の `notify_channels` をコピー）
  - `active` が unchecked（false）ユーザーは `inactive_user_master` として明示スキップ
  - absence の `notify_channels` が空でも master の default で補完

## Notify Users（DM別送）
- `Notify Users` は absence レコードの値のみを使う（`member_master` で補完しない）。
- `Notify Users` が未入力の場合、DM は送らない。
- 日次対象レコード（`todays`）から `Notify Users` をユーザー単位で集約し、1ユーザーにつき1通の DM を送る。
- DM本文は以下形式:
  - `本日の不在予定です（YYYY-MM-DD JST）`
  - `• <@U12345> 午前休`
  - `• <@U67890> 外出 15:00〜`
  - `• <@U22222> 終日休（私用）`
- DM本文の行順は `startDate` 昇順 → `targetUser` 昇順。
- DM送信失敗時の `errors` は失敗ユーザー単位で `+1`。他レコード/他通知は継続する。

### 必要 Scope（DM送信）
- `chat:write`（chat.postMessage）
- `im:write`（conversations.open）
- scope 追加後は App を再インストールする。

### Slash Command ローカル確認（署名あり）
1. 生ボディを準備（URL-encoded）  
   `BODY='command=%2Fpasr&text=run&user_id=UADMIN&team_id=TTEST&trigger_id=TRIG001'`
2. timestamp を作成  
   `TS=$(date +%s)`
3. 署名を作成  
   `SIG=$(printf "v0:%s:%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SLACK_SIGNING_SECRET" | sed 's/^.* //')`
4. 送信  
   `curl -X POST http://localhost:8787/slack/command -H "Content-Type: application/x-www-form-urlencoded" -H "X-Slack-Request-Timestamp: $TS" -H "X-Slack-Signature: v0=$SIG" --data "$BODY"`

## スコープ境界
- Phase 2 で実施:
  - deploy-first Runbook 整備
  - `/run` 認証の導入
  - run summary ログキー統一
- Phase 2.1 で実施:
  - Slack Events endpoint（`POST /slack/events`）
  - 署名検証ユーティリティ（raw body 検証）
  - ACK 後の非同期処理委譲と `event_id` 重複抑止
- Phase 2.2 で実施:
  - Slash Command endpoint（`POST /slack/command`）
  - `SLACK_ADMIN_USER_IDS` による実行権限制御
  - ACK 本文固定（`Accepted` / `Received. Processing...`）
  - `trigger_id` 短期TTL重複抑止
- Phase 2.x へ分離:
  - 高度な可観測性（ダッシュボード/集計ストア/時系列分析）
  - Slash Command の高度UI連携（modal など）
