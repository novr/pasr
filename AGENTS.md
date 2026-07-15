# AGENTS.md

エージェント向け不変条件。手順・エンドポイント詳細・ローカル確認は `README.md` を参照する。

## 責務分離

- **AGENTS.md**: コード変更時に壊してはいけない制約・不変条件
- **README.md**: 設定・デプロイ手順、エンドポイント仕様、ローカル確認コマンド

## 実行境界

Worker は3ハンドラで構成する。

| ハンドラ | 入口 | 制約 |
|----------|------|------|
| `fetch` | HTTP（`/health`, `/run`, `/slack/*`） | Slack 起点は署名検証必須。`event_callback` と重処理は ACK 後に `waitUntil` |
| `scheduled` | cron `0 0 * * *` UTC（JST 9:00） | JST 平日のみ `runDailyNotify`。週末は `skip_weekend_scheduled` で終了 |
| `queue` | `ADMIN_TASK_QUEUE` consumer | `/pasr-admin run` と `/pasr list` / `update` 一覧の実処理。一時障害のみ retry |

## ドメイン不変条件

- 判定基準時刻は常に JST（`Asia/Tokyo`）
- 失敗はレコード単位で隔離し、全体処理は継続する
- `Notify Users` は absence レコードの値のみ使用（`member_master` で補完しない）
- `absence.notify_channels` / `absence.notify_users` は daily 実行時に master default で補完しない
- `channel_notify_settings` は CH 別 0件時通知の上書きのみ（absence データは不変）。未 migrate 時 daily は org デフォルト（empty=on）で継続
- `SLACK_PASR_OPS_CHANNEL` への ops レポートは `trigger === "scheduled"` のときのみ。失敗は隔離
- **Status 同期**（OAuth 有効時）: `scheduled` daily のみ `users.profile.set`。`status_expiration` は当日 JST 23:59:59 固定。対象は `filterToday(dmCandidateRecords)` ベース（CH 未設定不在者を含む）。`note` は `itemId` 昇順先頭 + `truncateStatusText`（100字）。登録直後同期・当日キャンセル時クリアはスコープ外
- `scheduled` の週末スキップを回避する強制フラグは導入しない

## app_mention 日付解釈

- 判定基準は JST の `todayJst`
- `M/D` など年省略表現は `todayJst` の年を起点とし、解釈結果が過去日になる場合は翌年へ繰り上げ（未来日規定）
- `M/D〜M/D` で年跨ぎ（例: `12/28〜1/3`）は終了側を適切な翌年へ補完
- 「今週」「来週」「翌週」+ 曜日の週境界は労働基準法の「1週間」（日曜〜土曜）に従う
- `今週`+曜日が過去日になる場合は翌週の同一曜日へ繰り上げ（未来日規定）
- `来週は`（曜日なし）は翌週の日曜〜土曜
- ISO 完全日付（`YYYY-MM-DD`）はユーザー指定どおり解釈（繰り上げなし）。過去日の ISO は AI スキップ対象外

## Slack 署名・重複抑止

- 署名検証は `request.text()` の生ボディを使用（JSON 再構成文字列は使わない）
- `event_id` は KV 短期 TTL（300秒）で重複抑止。重複は破棄し `duplicate_event_dropped` をログ
- `trigger_id` は KV 短期 TTL（300秒）で重複抑止（enqueue 前）。重複は破棄し `duplicate_command_dropped` をログ

## Slash Command 権限

**`/pasr`** — 全ユーザー可。`list` / `update`（一覧）は Queue 非同期。`settings` / `register` / `update`（Modal 起動）は HTTP で即時 ACK し、実処理は `waitUntil`（`trigger_id` 期限内に Modal 起動）。Queue 系も dedupe / enqueue は `waitUntil`。重複時は `response_url` で通知。

**`/pasr-admin`** — `SLACK_ADMIN_USER_IDS` allowlist 必須。非該当は即時 ACK のみ（`Received. Processing...`）、実処理なし。
- `help` / `status`: 即時応答（HTTP レスポンス本文）。`status` は `channel_notify_settings` の migrate 状態も表示
- `channel-config`: 即時 ACK（`処理しています…`）後 `waitUntil` で D1 処理し ephemeral で結果通知（queue 不可。Slack 3 秒制限回避）
- `run`: 即時 ACK 後 Queue 経由で非同期実行（ops レポートは投稿しない）

## Interactions 不変条件

- `view_submission` は D1 書き込みまで同期 ACK。登録通知・一覧削除再描画は `waitUntil`
- register / list-edit は `action_id`・`callback_id` で分岐
- 不在の編集・削除は本人レコードのみ。編集時の登録通知再送なし
- 終了済み（`end_date < today` JST）は daily run 後 D1 から DELETE（証票用途なし）
- `app_mention` はチャンネル直下のみ（`thread_ts` ありは除外）
  - AI 抽出は提案のみ。確定は ephemeral 確認 UI（`pasr_mention_confirm`）必須
  - 通知先は `member_master` 既定（AI 抽出対象外）
  - AI 失敗時は Modal ボタンへフォールバック。解釈開始時に ephemeral で進行を通知
  - high 信頼度の日付 infer で完結する場合は Workers AI を呼ばない（`absence_mention_infer_skipped`）。ただし `startDate` / `endDate` が `todayJst` より前の場合はスキップしない
  - mention confirm の D1 書き込み・登録通知は `block_actions` 即時 ACK 後 `waitUntil`（`followUp`）。`channelId` は interaction の channel と confirm payload の両方を照合し、commit には interaction 側を使用。確認 UI の削除（consume）は検証通過後のみ（キャンセルは即時）
- Bot DM（`message.im`）は自然文登録の入口。`subtype` / `bot_id` 付きは処理しない
  - フローは `app_mention` 本文付きと同じ（infer / AI → 確認 UI → 登録）
  - DM 応答は `chat.postMessage`（ephemeral 不可）。チャンネルは引き続き ephemeral
  - 確認 UI・エラー・キャンセル ACK も DM では会話に残る
- **Status OAuth**: `/pasr settings` deferred と App Home から連携案内。`GET /slack/oauth/start` → callback で本人照合（state KV）。User Token は D1 暗号化保存。ログ・レスポンスへ出力しない。disconnect は本人のみ（`pasr_status_oauth_disconnect`）
- App Home（`app_home_opened`, `tab=home`）: 本人 `member_master` + 今後の `absences` を D1 読取し `views.publish`（最大5件プレビュー）。D1 失敗時は静的フォールバック（ユーザー向け詳細エラーなし）。Home 起点の削除・編集成功時のみ `views.publish` で refresh（`waitUntil`）。登録・設定保存後は refresh しない。`resolveMasterContext` は Home 表示時には呼ばない。登録・設定 Modal と一覧 ephemeral は `block_actions` 即時 ACK 後 `waitUntil`（list のみ followUp）

## データ境界

**正本**: D1（`PASR_DB`）— `absences`, `member_master`, `channel_notify_settings`（migration `0002`）, `slack_user_oauth`（migration `0003`）

Store: `PASR_STATE` KV

**KV キー（実行時状態）**
- `absence:run:last_summary`
- `absence:post:{jstDate}:{channelId}` — 日次 CH 通知の `chat.update` 用 ts
- `absence:dm:{jstDate}:{userId}` — 日次 DM の ts
- `slack:event:dedupe:{eventId}` / `slack:command:dedupe:{triggerId}`
- `slack:oauth:state:{nonce}` — OAuth CSRF（短期 TTL）
- `pasr:worker_origin:{userId}` — App Home OAuth 用 Worker origin キャッシュ（7日 TTL、`PASR_PUBLIC_BASE_URL` 未設定時）

**D1 / domain**
- DB `id` ↔ `AbsenceRecord.itemId`（rename しない）
- `member_master` 主キー相当は `target_user`
- `active`: true が通知対象。false は `inactive_user_master` でスキップ集計
- master 未登録ユーザーは daily 実行時に最小レコードで自動 insert
- 起動時 `schema-check`: テーブル欠落時は register/update/daily が fail（`db_schema_mismatch`）

## 設定・セキュリティ

- 組織ごとに Slack App / Cloudflare 環境を分離
- **`wrangler.jsonc` は git 管理**（bindings / `TZ` / cron）。組織固有 ID の差し替えは clone 後に実施
- Dashboard Variables: `SLACK_ADMIN_USER_IDS`（必須）、`SLACK_PASR_USERS_USERGROUP_ID` / `PASR_NOTIFY_EMPTY_DEFAULT` / `SLACK_PASR_OPS_CHANNEL` / `SLACK_PASR_NOTICE_CH` / `PASR_STATUS_DEFAULT_TEXT` / `PASR_STATUS_EMOJI` / `PASR_PUBLIC_BASE_URL`（任意）。jsonc `vars` に載せない
- Secret（`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `RUN_ENDPOINT_TOKEN`, および任意の `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_OAUTH_ENCRYPTION_KEY`）は Cloudflare のみ。レスポンス・ログへ出力しない
- `/run` は Bearer token 必須（`crypto.subtle.timingSafeEqual`）。認証失敗は `401` と最小エラーボディ
- `wrangler.jsonc` vars: `TZ=Asia/Tokyo` のみ
- 実行ログ必須キー: `run_id`, `processed`, `sent`, `skipped`, `errors`
- request スコープのグローバル保持と未管理 Promise を禁止

## 技術スタック

- Cloudflare Workers（`nodejs_compat`）、D1、KV、Queues
- TypeScript（`experimentalDecorators` 無効）
- 設定正本は **`wrangler.jsonc`**（bindings 含む）。binding / vars 変更時は `npm run types` で `Env` 同期（`worker-configuration.d.ts` は手書きしない）

## テスト不変条件

- deploy 前: `npm run check && npm test`
- domain / queue / dedupe / transient / db 変更時は `npm test`
- テスト・npm scripts 変更時は README「開発・テスト」を同時更新
- 単体テストは I/O モック前提。`@cloudflare/vitest-pool-workers` 統合テストは導入しない
- mention AI 結合テストは `src/integration/*.integration.test.ts` に分離し、`PASR_RUN_INTEGRATION=1` 時のみ `npm run test:integration` で実行（CI 対象外）
- infer で日付が決まるケースは `MENTION_AI_INFER_CASES`（単体テスト）。結合は `MENTION_AI_MODEL_CASES`（AI 推論品質）のみ
- `/debug/mention-ai` は `DEBUG_ENDPOINTS_ENABLED=true` 時のみ有効（本番では無効）。`RUN_ENDPOINT_TOKEN` 必須
- Queue: 一時障害のみ retry。subrequest 上限は retry しない（`src/errors/transient.test.ts`）
- dedupe / 署名検証仕様変更時は対応 `*.test.ts` を更新
- 自明コメントと dead code を残さない

## Cloudflare

- 仕様は公式ドキュメントを都度確認
- `compatibility_date` は定期更新、`nodejs_compat` を基本方針
