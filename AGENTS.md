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
| `queue` | `ADMIN_TASK_QUEUE` consumer | `/pasr-admin run` / `migrate` / `prune` の実処理。一時障害のみ retry |

## ドメイン不変条件

- 判定基準時刻は常に JST（`Asia/Tokyo`）
- 失敗はレコード単位で隔離し、全体処理は継続する
- `Notify Users` は absence レコードの値のみ使用（`member_master` で補完しない）
- `absence.notify_channels` / `absence.notify_users` は daily 実行時に master default で補完しない
- `scheduled` の週末スキップを回避する強制フラグは導入しない

## Slack 署名・重複抑止

- 署名検証は `request.text()` の生ボディを使用（JSON 再構成文字列は使わない）
- `event_id` は KV 短期 TTL（300秒）で重複抑止。重複は破棄し `duplicate_event_dropped` をログ
- `trigger_id` は KV 短期 TTL（300秒）で重複抑止（enqueue 前）。重複は破棄し `duplicate_command_dropped` をログ

## Slash Command 権限

**`/pasr`** — 全ユーザー可。即時応答（help/view）または Modal 起動（register/update）。

**`/pasr-admin`** — `SLACK_ADMIN_USER_IDS` allowlist 必須。非該当は即時 ACK のみ（`Received. Processing...`）、実処理なし。
- `help` / `status`: 即時応答
- `run` / `migrate` / `prune`: 即時 ACK 後 Queue 経由で非同期実行

## Interactions 不変条件

- `view_submission` は List 書き込みまで同期 ACK。登録通知・成功 ephemeral は `waitUntil`
- `app_mention` はチャンネル直下のみ（`thread_ts` ありは除外）

## データ境界（KV 正本）

Store: `PASR_STATE` KV

**List 名と schema version**
- `absence_list` — version **1**（`ABSENCE_SCHEMA_VERSION`）
- `member_master` — version **3**（`MEMBER_MASTER_SCHEMA_VERSION`）

**正本キー**
- `absence:config:list_id` — active `absence_list` の List ID
- `absence:config:schema_version`
- `member_master:config:list_id`
- `member_master:config:schema_version`
- `absence:run:last_summary`
- `absence:post:{jstDate}:{channelId}` — 日次 CH 通知の `chat.update` 用 ts
- `absence:dm:{jstDate}:{userId}` — 日次 DM の ts
- `slack:event:dedupe:{eventId}` / `slack:command:dedupe:{triggerId}`
- `prune:pending` / `migration:in_progress`（TTL 600秒）

**migrate 前提**
- KV の schema version と実 List スキーマの両方を検証。不一致時は register/update が失敗し migrate を促す
- schema v3 初デプロイ後は `/pasr-admin migrate` 必須
- list 作成時は `notify_users=false`
- `member_master` 主キー相当は `Target User`（Slack user entity）
- `active` checkbox: checked=true が通知対象。false は `inactive_user_master` でスキップ集計
- master 未登録ユーザーは daily 実行時に最小レコードで自動 insert

## 設定・セキュリティ

- 組織ごとに Slack App / Cloudflare 環境を分離
- Secret（`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `RUN_ENDPOINT_TOKEN`）は Cloudflare のみ。レスポンス・ログへ出力しない
- `/run` は Bearer token 必須。認証失敗は `401` と最小エラーボディ
- vars: `TZ=Asia/Tokyo`, `SLACK_ADMIN_USER_IDS`, `SLACK_LIST_ACCESS_CHANNEL_IDS`（任意）
- 実行ログ必須キー: `run_id`, `listId`, `processed`, `sent`, `skipped`, `errors`
- request スコープのグローバル保持と未管理 Promise を禁止

## 技術スタック

- Cloudflare Workers（`nodejs_compat`）、KV、Queues
- TypeScript（`experimentalDecorators` 無効）
- `wrangler.jsonc` が設定正本。binding 変更時は `wrangler types` で `Env` 同期（手書きしない）

## テスト不変条件

- deploy 前: `npm run check && npm test`
- domain / queue / dedupe / transient / list-discovery 変更時は `npm test`
- テスト・npm scripts 変更時は README「開発・テスト」を同時更新
- 単体テストは I/O モック前提。`@cloudflare/vitest-pool-workers` 統合テストは導入しない
- Queue: 一時障害のみ retry。subrequest 上限は retry しない（`src/errors/transient.test.ts`）
- dedupe / 署名検証仕様変更時は対応 `*.test.ts` を更新
- 自明コメントと dead code を残さない

## Cloudflare

- 仕様は公式ドキュメントを都度確認
- `compatibility_date` は定期更新、`nodejs_compat` を基本方針
