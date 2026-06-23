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
- 開発時のテスト手順は「開発・テスト」を参照

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
- `vars.SLACK_ADMIN_USER_IDS`（必須: カンマ区切り、Slash Command 実行許可ユーザー）
- `vars.SLACK_LIST_ACCESS_CHANNEL_IDS`（任意: カンマ区切り、List を共有するチャンネル ID。ワークスペース内共有に使う）

`absence_list` の List ID は KV（`PASR_STATE`）が正本。初回は `runSetup` が名前解決して KV へ書き込む。

## 開発・テスト

- 前提: Node.js 18+（`crypto.subtle` / Vitest 用）
- 型チェック: `npm run check`
- 単体テスト: `npm test`
- ウォッチ: `npm run test:watch`
- 変更後は deploy 前に `npm run check && npm test` をローカル実行する
- CI: GitHub Actions（`.github/workflows/ci.yml`）が push/PR で `check` + `test` を実行

### テストのカバー範囲（単体）

- domain パース、list-schema / list-migration / prune 判定、absence-registration（日付・登録通知）、署名検証、event dedupe、Queue ack/retry、list-discovery 打ち切り

### 非カバー（Phase 2.x）

- `runListMigration` / `runListPrune` 全体フロー、本番 Slack API、Workers ランタイム統合

テスト配置: `src/**/*.test.ts`、KV mock は `src/test/mock-kv.ts`

## デプロイ手順（deploy-first）

### dev
1. `npm run dev`
2. `curl http://localhost:8787/health`
3. `curl -X POST -H "Authorization: Bearer <RUN_ENDPOINT_TOKEN>" http://localhost:8787/run`
4. `curl http://localhost:8787/__scheduled`

### staging / prod
1. Secret が環境に投入済みであることを確認
2. `npm run check && npm test` が通ることを確認
3. 初回のみ Queue を作成: `npx wrangler queues create pasr-admin-tasks`
4. `npx wrangler deploy`
5. `/health` で readiness を確認
6. デプロイ出力に `env.ADMIN_TASK_QUEUE (pasr-admin-tasks)` と Consumer/Producer が表示されることを確認
7. `/run` を `POST` + トークン付きで 1 回実行し、ログに run summary が出ることを確認
8. **member_master schema v3 以降を初めてデプロイする場合**: 直後に `/pasr-admin migrate` を実行し、必要なら `prune` する（migrate 前は register/update が失敗する）

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
- `app_mention`（チャンネル直下のみ）:
  - `thread_ts` ありは `app_mention_thread_skipped` で no-op
  - ephemeral +「不在を登録」ボタンを表示（`block_actions` で Modal 起動）

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
  - allowlist 非該当時の即時ACK本文: `Received. Processing...`（実処理は行わない）
  - `/pasr-admin run` / `migrate` / `prune` の即時ACKは処理中である旨を返す（例: `migrate を実行中です。完了後に結果を表示します。`）
  - `trigger_id` をキーに TTL=300秒で重複抑止（enqueue 前。重複時は no-op）
  - `/pasr-admin run` / `migrate` / `prune` は Cloudflare Queue 経由で非同期実行（`waitUntil` 30秒制限を回避）
- 初期サブコマンド:
  - `/pasr help` -> ユーザ向けコマンドの使い方表示
  - `/pasr view` -> 自分の通知設定を表示
  - `/pasr update` -> 自分の通知設定を編集
  - `/pasr register` -> 自分の不在を Modal で登録
  - `/pasr-admin help` -> 管理者向けコマンドの使い方表示
  - `/pasr-admin run` -> daily notify 手動実行フローを非同期実行
  - `/pasr-admin status` -> 直近 run 要約を表示（履歴がない場合は `No run history yet.`）
  - `/pasr-admin migrate` -> `absence_list` / `member_master` を新スキーマの新規 List に移行し、旧 List は `slackLists.update` で `__archived__` 付き名称へ rename
  - migrate は旧スキーマ List からも行を読み取る（スキーマ検証に合格していない List でも KV / 名前解決でソースに含める）
  - 空の新 List だけが正本になっている場合は、同名の旧 List に行があれば data recovery として再移行する
  - `/pasr-admin prune` -> KV 正本以外の PASR 管理 List を削除（Bot 作成 List のみ探索、1回最大40件）

## Endpoint 仕様（Phase 2.3: Interactions / 不在登録）
- `POST /slack/interactions`
  - 署名検証必須（raw body）
  - `view_submission`（`pasr_absence_register` / `pasr_member_master_update`）と `block_actions`（`pasr_register_open`）を処理
  - List 書き込みまで同期 ACK。登録通知と成功 ephemeral は `waitUntil` で非同期
  - バリデーション失敗時は `response_action: errors` を返す

## 不在登録（`/pasr register` / Bot メンション）
- 入口:
  - `/pasr register`（Slash）
  - チャンネル直下の `@bot` メンション → ephemeral ボタン → Modal（スレッド内メンションは除外）
- `member_master` の既定通知先・既定登録通知を Modal 初期値として表示
- `absence_list` へ 1 件 insert（`createAbsenceItem`）
- 終了日を省略した場合は開始日と同日として登録する
- **登録通知** select: `none` / `ch` / `dm` / `both`（`member_master.default_registration_notify` が既定値）
- **当日不在**（`start ≤ today ≤ end`）:
  - JST 9:00 前: 選択した登録通知に従う（`none` なら即時通知なし、daily が担当）
  - JST 9:00 以降: `both` に昇格し、設定済みの CH/DM のみ送信（degrade）
- **未来予定**: 選択した登録通知に従う
- 登録成功後は ephemeral で完了メッセージを 1 通送る
- 当日・登録通知ありの場合、daily 通知と即時通知の両方が届くことがある（9:00 前 + `none` 以外）
- 構造化ログ: `absence_registered`, `registration_notify_done`, `absence_register_ack_ephemeral_sent` 等
- `type` 選択肢は `absence_list` の List schema から runtime 取得（KV 保存しない）

## User Master（Phase #4）
- list 名は `member_master` を使用
- スキーマはバージョン管理し、KV に適用済みバージョンを保持する
- 実行時はバージョンと実スキーマ型の両方を検証し、不一致時は `/pasr-admin migrate` を促す
- 主キー相当は `Target User`（Slack user entity）
- list 作成時は user 通知を無効（`notify_users=false`）
- `active` は checkbox フィールド（checked=true で通知対象、unchecked=false で通知停止）
- `default_registration_notify` は select（`none` / `ch` / `dm` / `both`）。登録 Modal の「登録通知」初期値
- 現在の schema version: **3**（v3 デプロイ後は `/pasr-admin migrate` 必須）
- daily 実行時:
  - master 未登録ユーザーは自動 insert（`Target User`, `active=true`, default 通知先は空）
  - `active` が unchecked（false）ユーザーは `inactive_user_master` として明示スキップ
  - `absence.notify_channels` / `absence.notify_users` は master の default で補完しない（空ならその通知は送信しない）
  - absence 登録 UI では、未指定時に master default を初期提案として表示してから保存する運用を推奨

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

### 必要 Scope（Slack API）

| Scope | 用途 |
|-------|------|
| `lists:read` | `slackLists.items.list` / `slackLists.items.info` |
| `lists:write` | `slackLists.create` / `slackLists.items.*` / `slackLists.update`（rename） / `slackLists.access.set` |
| `files:read` | `files.list`（List 探索） / `files.info`（schema 取得） |
| `files:write` | `files.delete`（prune） |
| `chat:write` | `chat.postMessage` / `chat.update` |
| `im:write` | `conversations.open`（DM） |
| `commands` | Slash Command 受信 |
| `users:read` | Modal の user selector |
| `channels:read` | Modal の channel selector |
| `app_mentions:read` | `app_mention` イベント受信 |

scope 追加後は App を再インストールする。

### Slack Web API 一覧（PASR が使用）

| メソッド | 用途 |
|---------|------|
| `slackLists.create` | List 新規作成（schema はここでのみ指定） |
| `slackLists.update` | List rename（`name` のみ） |
| `slackLists.items.list` | 行一覧 |
| `slackLists.items.info` | 行 + list metadata（schema 補助） |
| `slackLists.items.create` | 行追加（`initial_fields` + `column_id`） |
| `slackLists.items.update` | セル更新 |
| `slackLists.items.delete` | 行削除 |
| `slackLists.access.set` | admin への write 権限付与 / 任意チャンネルへの write 権限付与 |
| `files.list` | `filetype=list` の名前探索（失敗時は KV 正本） |
| `files.info` | 空 List 含む schema 取得 |
| `files.delete` | archived List 削除 |
| `chat.postMessage` / `chat.update` | チャネル・DM 通知 |
| `conversations.open` | DM チャネル解決 |
| `views.open` | `/pasr update` / `/pasr register` Modal |
| `chat.postEphemeral` | 登録完了通知・メンション案内 |

Slash Command の応答は `response_url` へ POST（Web API 外）。

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
  - `trigger_id` 短期TTL重複抑止（enqueue 前）
- Phase 2.3 で実施:
  - Interactions endpoint（`POST /slack/interactions`）
  - `/pasr register` と Bot メンションによる不在登録 Modal
  - 登録通知（即時 CH/DM）と `member_master` schema v3（`default_registration_notify`）
- Phase 2.x へ分離:
  - 高度な可観測性（ダッシュボード/集計ストア/時系列分析）
