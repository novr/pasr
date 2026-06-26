# PASR Slack不在通知 App

**PASR** — Planned absence, shared right.

Slack Bot UI から不在を登録し、Cloudflare Workers + D1 で平日の日次通知を実行します。

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

### 2b) Slack App Manifest
- [`slack-app-manifest.json.template`](slack-app-manifest.json.template) を api.slack.com → **App Manifest** に反映
- `REPLACE_WITH_WORKER_URL` をデプロイ先 Worker のベース URL に置換（`app_home_opened` event を含む。`views.open` / `views.publish` 用の追加 scope は不要）
- 反映後 **Reinstall to Workspace**

### 3) D1 Database
- `npx wrangler d1 create pasr-db`
- 返却された database ID を `wrangler.jsonc` の `d1_databases[0].database_id` に反映
- ローカル: `npm run db:migrate:local`
- 本番 deploy 前: `npx wrangler d1 migrations apply pasr-db --remote`

### 4) KV Namespace
- `npx wrangler kv namespace create PASR_STATE`
- 返却された namespace ID を `wrangler.jsonc` の `kv_namespaces[0].id` に反映

### 5) Cloudflare Secrets
- `npx wrangler secret put SLACK_BOT_TOKEN`
- `npx wrangler secret put SLACK_SIGNING_SECRET`
- `npx wrangler secret put RUN_ENDPOINT_TOKEN`

### 6) Vars（`wrangler.jsonc`）
- `vars.TZ=Asia/Tokyo`
- `vars.SLACK_ADMIN_USER_IDS`（必須: カンマ区切り、`/pasr-admin` 実行許可ユーザー）

正本は D1（`absences`, `member_master`）。

## 開発・テスト

- 前提: Node.js 18+（`crypto.subtle` / Vitest 用）。`npm run debug:mention-ai` は Node.js 22+（`--experimental-strip-types`）推奨
- 型チェック: `npm run check`（CI では `wrangler types --check` も実行）
- D1 マイグレーション（ローカル初回）: `npm run db:migrate:local`
- 単体テスト: `npm test`
- ウォッチ: `npm run test:watch`
- **結合テスト（Workers AI / `npm run dev` 必須）**: `npm run test:integration`
- 変更後は deploy 前に `npm run check && npm test` をローカル実行する
- CI: GitHub Actions（`.github/workflows/ci.yml`）が push/PR で `check` + `test` を実行（結合テストは含まない）

### テストのカバー範囲（単体）

- domain パース、D1 repository / schema-check、absence-registration、absence-mention-parse、署名検証、event dedupe、Queue ack/retry、daily-notify

### 非カバー（単体テスト）

- 本番 Slack API、Workers ランタイム統合

### 結合テスト（mention AI）

- 配置: `src/integration/**/*.integration.test.ts`
- 実行: `npm run test:integration`（`npm test` には含めない）
- 前提:
  1. `wrangler.jsonc` に `ai` binding
  2. ターミナル A: `npm run dev`（既定ポート **8787**。`wrangler.jsonc` の `ai.remote: true` で Workers AI を利用）
  3. `.dev.vars` に `RUN_ENDPOINT_TOKEN` と `DEBUG_ENDPOINTS_ENABLED=true`（**`npm run dev` も `.dev.vars` を読む**。編集後は dev を再起動。結合テスト実行時も vitest が自動読み込み）
  4. 8787 が使用中で dev が別ポート（例: 8788）になった場合は、古い wrangler を止めるか `PASR_DEV_URL=http://localhost:8788` を指定
- ケース定義: `src/domain/mention/mention-ai-cases.ts`（`src/integration/mention-ai-cases.ts` から re-export。基準日 `2026-06-24` 固定）
  - `MENTION_AI_INFER_CASES`: enrich/infer で日付が決まる → `npm test` で検証
  - `MENTION_AI_MODEL_CASES`: AI 推論品質 → `npm run test:integration` で検証
- 日付解釈: 年省略は未来日優先、週境界は日曜〜土曜（詳細は `AGENTS.md`「app_mention 日付解釈」）
- 単発デバッグ: `npm run debug:mention-ai -- "明日 通院"`（`@cli` 結合テスト経由）

テスト配置: `src/**/*.test.ts`、KV mock は `src/test/mock-kv.ts`

## デプロイ手順

### dev
1. `cp wrangler.jsonc.template wrangler.jsonc`（未作成の場合）
2. `npm run db:migrate:local`
3. `npm run dev`（`--persist-to=./.wrangler/state`。Slack / Queue / Workers AI）
2. `curl http://localhost:8787/health`
3. `curl -X POST -H "Authorization: Bearer <RUN_ENDPOINT_TOKEN>" http://localhost:8787/run`
4. `curl http://localhost:8787/__scheduled`

#### mention AI のローカルデバッグ（Slack なし）
1. ターミナル A: `npm run dev`（`wrangler.jsonc` と Secret / `.dev.vars` が必要）
2. ターミナル B（結合テスト一括）:
   ```bash
   npm run test:integration
   ```
3. ターミナル B（単発）:
   ```bash
   npm run debug:mention-ai -- "明日 通院のため午後から"
   ```
   - `PASR_TODAY_JST=2026-06-24` で「今日」基準日を固定できる
   - `PASR_DEV_URL` で dev サーバー URL を変更できる（既定 `http://localhost:8787`）

### staging / prod
1. Secret が環境に投入済みであることを確認
2. `npm run check && npm test` が通ることを確認
3. 初回のみ Queue を作成: `npx wrangler queues create pasr-admin-tasks`
4. `npx wrangler d1 migrations apply pasr-db --remote`
5. `npx wrangler deploy`
6. `/health` で readiness を確認
7. デプロイ出力に `env.ADMIN_TASK_QUEUE` と `PASR_DB` binding を確認

## 運用時の確認ポイント
- 実行ログは JSON を前提に確認する。
- `event=daily_notify_done` を基点に、以下を最低限追跡する:
  - `run_id`
  - `processed`
  - `sent`
  - `skipped`
  - `deleted`
  - `errors`
- skip は `event=skip_record` の `reason` で確認する（例: `missing_notify_channels`, `invalid_date_range`）。

## 再実行 Runbook（障害時）
1. 失敗 run の `run_id` とエラーイベントを確認
2. 原因（Slack 側データ不備、token 期限、チャネル権限など）を修正
3. 当日分を `/run` で再実行（Bearer 必須）
4. `daily_notify_done` の `errors=0` または許容範囲を確認
5. Slack 投稿が既存メッセージ更新（`chat.update`）で重複していないことを確認

## Endpoint 仕様

### HTTP / スケジュール
- `GET /health`
  - 認証不要
  - `200 {"ok":true}`
- `POST /run`
  - `Authorization: Bearer <RUN_ENDPOINT_TOKEN>` 必須
  - 成功時レスポンスは最小化し `200 {"ok":true,"runId":"..."}` を返す
  - 認証失敗時は `401 {"ok":false,"error":"Unauthorized"}`
  - メソッド不正時は `405 {"ok":false,"error":"Method Not Allowed"}`
- `scheduled`（cron `0 0 * * *` UTC = JST 9:00）
  - 平日のみ実行
  - 週末は `skip_weekend_scheduled` を出力して終了

### Slack Events（`POST /slack/events`）
- `X-Slack-Signature` / `X-Slack-Request-Timestamp` を `SLACK_SIGNING_SECRET` で検証
- 署名検証は `request.text()` の生ボディを使って実施
- 署名不正時は `401 {"ok":false,"error":"Unauthorized"}`
- `url_verification` は `200 {"challenge":"..."}` を返す
- `event_callback` は先に `200 {"ok":true}` を返し、後続処理は非同期で実行
- 同一 `event_id` は KV 短期 TTL で重複抑止し、再送は捨てる
- 重複抑止時は `duplicate_event_dropped` を構造化ログ出力
- `app_mention`（チャンネル直下のみ）:
  - `thread_ts` ありは `app_mention_thread_skipped` で案内 ephemeral
  - メンションのみ → ephemeral +「不在を登録」ボタン（`block_actions` で Modal 起動）
  - 本文付きメンション → infer / Workers AI で日付・note を解釈 → ephemeral 確認 UI（登録 / キャンセル / フォーム）→ 確認後 D1 書き込み
  - AI 解釈失敗時はフォームボタンへフォールバック
- Bot DM（`message.im`）:
  - App Home の Messages Tab からユーザーが Bot に DM を送る（例: `明日 通院`）
  - 処理フローは本文付き `app_mention` と同じ。応答は `chat.postMessage`（DM 内に残る。ephemeral 不可）
  - `subtype` / `bot_id` 付きメッセージは `dm_message_skipped` で無視
- App Home（`app_home_opened`, `tab=home`）:
  - 静的 Block Kit を `views.publish` で表示（登録・通知設定・不在一覧ボタン）
  - ボタン押下時のみ Modal / ephemeral 一覧を起動

#### Slack Events ローカル確認（署名あり）
1. 生ボディを準備  
   `BODY='{"type":"url_verification","challenge":"test-challenge"}'`
2. timestamp を作成  
   `TS=$(date +%s)`
3. 署名を作成  
   `SIG=$(printf "v0:%s:%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SLACK_SIGNING_SECRET" | sed 's/^.* //')`
4. 送信  
   `curl -X POST http://localhost:8787/slack/events -H "Content-Type: application/json" -H "X-Slack-Request-Timestamp: $TS" -H "X-Slack-Signature: v0=$SIG" --data "$BODY"`

### Slash Command（`POST /slack/command`）
- `X-Slack-Signature` / `X-Slack-Request-Timestamp` を `SLACK_SIGNING_SECRET` で検証
- 署名検証は `request.text()` の生ボディを使って実施
- 署名不正時は `401 {"ok":false,"error":"Unauthorized"}`
- body 不正（必須フィールド不足）は `400 {"ok":false,"error":"Bad Request"}`
- `trigger_id` をキーに TTL=300秒で重複抑止（enqueue 前。重複時は no-op）

#### `/pasr`（全ユーザー可）
- `/pasr help` -> ユーザ向けコマンドの使い方表示
- `/pasr settings` -> 自分の通知設定を編集（Modal）
- `/pasr list` -> 自分の不在一覧（編集・削除ボタン、Queue 非同期・最大25行）
- `/pasr update` -> `/pasr list` と同じ
- `/pasr update YYYY-MM-DD` -> 開始日指定で不在編集 Modal（同期・`trigger_id`）
- `/pasr register` -> 自分の不在を Modal で登録

#### `/pasr-admin`（`SLACK_ADMIN_USER_IDS` allowlist 必須）
- allowlist 非該当時の即時ACK本文: `Received. Processing...`（実処理は行わない）
- `/pasr-admin help` -> 管理者向けコマンドの使い方表示
- `/pasr-admin status` -> 直近 run 要約 + `db:` 状態
- `/pasr-admin run` -> daily notify 手動実行（即時 ACK 後 Queue 経由で非同期）

#### Slash Command ローカル確認（署名あり）
1. 生ボディを準備（URL-encoded）  
   `BODY='command=%2Fpasr&text=run&user_id=UADMIN&team_id=TTEST&trigger_id=TRIG001'`
2. timestamp を作成  
   `TS=$(date +%s)`
3. 署名を作成  
   `SIG=$(printf "v0:%s:%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SLACK_SIGNING_SECRET" | sed 's/^.* //')`
4. 送信  
   `curl -X POST http://localhost:8787/slack/command -H "Content-Type: application/x-www-form-urlencoded" -H "X-Slack-Request-Timestamp: $TS" -H "X-Slack-Signature: v0=$SIG" --data "$BODY"`

### Interactions（`POST /slack/interactions`）
- 署名検証必須（raw body）
- `view_submission`: `pasr_absence_register` / `pasr_absence_edit` / `pasr_member_master_update`
- `block_actions`: `pasr_register_open` / `pasr_home_settings_open` / `pasr_home_list_open` / `pasr_mention_confirm` / `pasr_mention_cancel` / `pasr_absence_edit_open` / `pasr_absence_delete`
- D1 書き込みまで同期 ACK。登録通知・一覧削除の再描画・mention confirm は `waitUntil` で非同期
- バリデーション失敗時は `response_action: errors` を返す

## 不在一覧・編集（`/pasr list` / `/pasr update`）
- 本人の `end_date >= today`（JST）の不在のみ表示（最大25行）
- 削除は1クリック（確認 Modal なし）。`pasr_absence_delete` は ACK 後 `waitUntil` で削除+一覧再描画
- 編集 Modal 保存時は登録通知を再送しない。保存時は active list 上の行を再照合してから更新
- `type` は常に `absence` 固定（Modal・一覧に非表示）

## 終了済み不在の物理削除（daily run）
- `end_date < today`（JST）の行を run 通知後に D1 から DELETE

## 不在登録（`/pasr register` / Bot メンション / Bot DM）
- 入口:
  - `/pasr register`（Slash）
  - チャンネル直下の `@bot` メンション（スレッド内メンションは除外）
    - メンションのみ → ephemeral ボタン → Modal
    - 本文付き（例: `@PASR 明日 通院`）→ infer / Workers AI 解釈 → 確認 UI → 登録（通知先は `member_master` 既定）
  - Bot への DM（`message.im`、例: `明日 通院`）→ 上記本文付きメンションと同フロー（応答は DM 内に表示）
- `member_master` の既定通知先・既定登録通知を Modal 初期値として表示
- D1 `absences` へ 1 件 insert
- 終了日を省略した場合は開始日と同日として登録する
- **登録通知** select: `none` / `ch` / `dm` / `both`（`member_master.default_registration_notify` が既定値）
- `none` でも daily 用に通知チャンネルまたは通知ユーザーを1件以上指定必須（即時通知は送らない）
- **当日不在**（`start ≤ today ≤ end`）:
  - JST 9:00 前: 選択した登録通知に従う（`none` なら即時通知なし、daily が担当）
  - JST 9:00 以降: `both` に昇格し、設定済みの CH/DM のみ送信（degrade）
- **未来予定**: 選択した登録通知に従う
- 登録成功後は ephemeral で完了メッセージを 1 通送る
- 当日・登録通知ありの場合、daily 通知と即時通知の両方が届くことがある（9:00 前 + `none` 以外）
- 構造化ログ: `absence_registered`, `registration_notify_done`, `absence_register_ack_ephemeral_sent` 等
- `type` は常に `absence`（不在）を自動セット。理由・時間帯などは Modal の「詳細（任意）」= `note` に記載
- 日次通知本文は `• <@user> {note}`（`type` は出さない）。登録通知は `• <@user> {期間} — {note}` 形式

## User Master（`member_master`）
- D1 テーブル `member_master` が正本
- 主キー相当は `target_user`（Slack user ID）
- `active`: true で通知対象、false は `inactive_user_master` スキップ
- `default_registration_notify`: `none` / `ch` / `dm` / `both`
- daily 実行時: master 未登録ユーザーは最小レコードで自動 insert
- `absence.notify_channels` / `absence.notify_users` は master default で補完しない

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

正本は [`slack-app-manifest.json.template`](slack-app-manifest.json.template)。api.slack.com → **App Manifest** に貼り付け、`REPLACE_WITH_WORKER_URL` を Worker のベース URL（例: `https://pasr-absence-notifier.example.workers.dev`）に置換する。

| Scope | 用途 |
|-------|------|
| `chat:write` | `chat.postMessage` / `chat.update` |
| `im:history` | Bot DM（`message.im`）受信 |
| `im:write` | `conversations.open`（DM） |
| `commands` | Slash Command 受信 |
| `users:read` | Modal の user selector |
| `channels:read` | Modal の channel selector |
| `app_mentions:read` | `app_mention` イベント受信 |

manifest には上記に加え `channels:join` / `chat:write.public` も含む（公開チャンネル投稿・参加用）。

**Subscribe to bot events:** `app_mention`, `message.im`, `app_home_opened`

**Modal / App Home（追加 scope 不要）:** `views.open` / `views.publish` は専用 OAuth scope を要しない。manifest の **Interactivity** を有効にし、Bot Token で呼び出す（[Slack 公式](https://docs.slack.dev/reference/methods/views.open)）。

scope / event 変更後は **Install App → Reinstall to Workspace** 必須。

**App Home（manifest 内 `features.app_home`）**

- `home_tab_enabled: true` — Home Tab（`views.publish`）
- `messages_tab_enabled: true` / `messages_tab_read_only_enabled: false` — Messages Tab からの DM 自然文登録

### Slack Web API 一覧（PASR が使用）

| メソッド | 用途 |
|---------|------|
| `chat.postMessage` / `chat.update` | チャネル・DM 通知 |
| `conversations.open` | DM チャネル解決 |
| `views.open` | Modal 起動 |
| `views.publish` | App Home Tab |
| `chat.postEphemeral` | 登録完了・メンション案内 |

Slash Command の応答は `response_url` へ POST（Web API 外）。
