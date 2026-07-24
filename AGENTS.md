# AGENTS.md

コード変更時に壊してはいけない**境界と非自明な why**。手順は `README.md`、設定名の正本は `wrangler.jsonc` / `.dev.vars.example` / `slack-app-manifest.json.template`。

## 責務

- **AGENTS**: 意図と境界（コードだけでは誤実装しやすいもの）
- **README**: 初回セットアップと deploy の最短手順

## 時刻・失敗

- 判定は常に JST。失敗はレコード単位で隔離し全体は継続
- `scheduled` の CH/DM 通知・Status 同期・終了 absence 削除は JST 平日かつ非祝日のみ。`coverage.to` 超過（`data_stale`）も同様に skip。ops レポートは土日祝・data_stale でも投稿。週末・祝日の強制実行フラグは導入しない

## データ補完しない（why: レコードが届け先の意図の正本）

- daily の `notify_users` / `notify_channels` は absence の値のみ。`member_master` で補完しない
- `channel_notify_settings` は CH の 0件時通知上書きのみ。absence は触らない

## データ・migration

- D1 正本: `absences`, `member_master`, `channel_notify_settings`（`0002`）, `slack_user_oauth`（`0003`）
- `0002` 未適用: daily CH/DM は継続。`/pasr-admin channel-config` のみ失敗
- `0003` 未適用: OAuth UI・Status 同期をスキップ。CH/DM は継続
- `0004` 未適用: Status ユーザー設定の保存・参照をスキップ（org Variable のみ）。CH/DM は継続

## 登録通知（`src/domain/absence-registration.ts`）

- `none` でも daily 用に CH または Notify Users を 1 件以上必須
- **当日**かつ JST 9:00 以降の登録: `resolvedMode = both`（届け先のある側だけ送る）
- 当日 9:00 前 + `none` 以外: daily と即時の**両方**届きうる（意図的）
- 編集保存時は登録通知を再送しない

## 日次・ops・Status

- CH 0件時 off にしても過去の「予定なし」投稿は削除・更新しない（Phase 1）
- ops レポートは `trigger === "scheduled"` のみ（土日含む）。`sent` は CH+DM 合計。内訳は `sent_channels` / `sent_dms`
- Status 同期: scheduled daily の JST 平日。ユーザー操作（登録・編集・削除・`member_master` settings 保存）による当日 Status の即時 set / re-resolve / clear を許可（当日が absence 範囲内なら土日祝も可。settings 保存は当日 absence がある場合のみ re-resolve）。失敗はレコード単位で隔離し登録・保存成功は阻害しない
- Status 文言・絵文字の優先順位: absence `note` > `member_master.status_default_text` / `status_emoji` > org Variable（`PASR_STATUS_DEFAULT_TEXT` / `PASR_STATUS_EMOJI`）。ユーザー設定は Status 同期専用（daily 通知には使わない）
- `end_date < today` の absence は平日 scheduled daily 後に D1 DELETE（証票用途なし）

## Slack

- 署名は `request.text()` の生ボディ。`event_id` / `trigger_id` は KV 300 秒 dedupe
- `view_submission` は D1 書き込みまで同期 ACK。登録通知・一覧再描画・mention confirm は `waitUntil`
- `/pasr`: 一覧は Queue 非同期。Modal 起動（`settings` / `register` / `update`）は即時 ACK 後 `waitUntil`（`trigger_id` 期限）
- `/pasr-admin`: allowlist 外は ACK のみで実処理なし。`users` / `absences` / `channel-config` は queue 不可（`waitUntil` + ephemeral）
- `blocks` 付き ephemeral は **section（本文）+ actions**。actions のみは本文が空に見える
- `app_mention`: チャンネル直下のみ。AI は提案のみ、確定は確認 UI 必須。通知先は master 既定（AI 対象外）。confirm commit の `channelId` は interaction と payload の両方を照合し、commit には interaction 側を使用
- high 信頼度 infer で日付完結時は AI スキップ。ただし `startDate`/`endDate` が `todayJst` より前ならスキップしない
- Bot DM: 本文付きメンションと同フロー。応答は ephemeral 不可（会話に残る）
- App Home: 削除・編集・設定保存成功時に refresh。登録成功後は refresh しない
- Status OAuth: User Token は D1 暗号化。ログ・レスポンスに出さない。鍵変更後は全員再連携

## app_mention 日付（コードに散らばりやすい）

- 年省略 `M/D` は未来日優先（過去なら翌年）。`M/D〜M/D` の年跨ぎは終了側を翌年へ補完。ISO `YYYY-MM-DD` は繰り上げなし
- 週境界は日曜〜土曜。`今週`+曜日が過去なら翌週同日。`来週は`（曜日なし）は翌週日曜〜土曜
- ケース詳細: `src/domain/mention/mention-ai-cases.ts`

## User Group（任意）

- `resolveMasterContext` で**初回** master 作成時のみ追加。daily のみ作成・既存ユーザーのバックフィルなし

## セキュリティ・実装

- Secret は Cloudflare のみ。`/run` は Bearer（timing-safe）
- 実行ログに `run_id`, `processed`, `sent`, `sent_channels`, `sent_dms`, `skipped`, `deleted`, `errors` 必須
- request スコープのグローバル保持と未管理 Promise 禁止
- binding / `Env` 変更時は `npm run types`（`worker-configuration.d.ts` 手書き禁止）

## テスト

- 実装完了・PR 前・deploy 前: `npm run check && npm test`
- domain / queue / dedupe / db 変更時は `npm test`。npm scripts 変更時は README も更新
- mention AI 結合は `PASR_RUN_INTEGRATION=1` 時のみ `npm run test:integration`（CI 外）。Queue retry は一時障害のみ
