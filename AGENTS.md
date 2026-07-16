# AGENTS.md

コード変更時に壊してはいけない**境界と非自明な why**。手順は `README.md`、設定名の正本は `wrangler.jsonc` / `.dev.vars.example` / `slack-app-manifest.json.template`。

## 責務

- **AGENTS**: 意図と境界（コードだけでは誤実装しやすいもの）
- **README**: 初回セットアップと deploy の最短手順

## 時刻・失敗

- 判定は常に JST。失敗はレコード単位で隔離し全体は継続
- `scheduled` は JST 平日のみ。週末スキップの強制実行フラグは導入しない

## データ補完しない（why: レコードが届け先の意図の正本）

- daily の `notify_users` / `notify_channels` は absence の値のみ。`member_master` で補完しない
- `channel_notify_settings` は CH の 0件時通知上書きのみ。absence は触らない

## 登録通知（`src/domain/absence-registration.ts`）

- `none` でも daily 用に CH または Notify Users を 1 件以上必須
- **当日**かつ JST 9:00 以降の登録: `resolvedMode = both`（届け先のある側だけ送る）
- 当日 9:00 前 + `none` 以外: daily と即時の**両方**届きうる（意図的）
- 編集保存時は登録通知を再送しない

## 日次・ops・Status

- CH 0件時 off にしても過去の「予定なし」投稿は削除・更新しない（Phase 1）
- ops レポートは `trigger === "scheduled"` のみ。`sent` は CH+DM 合計
- Status 同期: scheduled daily のみ。登録直後同期・当日キャンセル時クリアはスコープ外
- `end_date < today` の absence は daily 後に D1 DELETE（証票用途なし）

## Slack

- 署名は `request.text()` の生ボディ。`event_id` / `trigger_id` は KV 300 秒 dedupe
- `/pasr-admin`: allowlist 外は ACK のみで実処理なし。`users` / `absences` / `channel-config` は queue 不可（`waitUntil` + ephemeral）
- `blocks` 付き ephemeral は **section（本文）+ actions**。actions のみは本文が空に見える
- `app_mention`: チャンネル直下のみ。AI は提案のみ、確定は確認 UI 必須。通知先は master 既定（AI 対象外）
- high 信頼度 infer で日付完結時は AI スキップ。ただし `startDate`/`endDate` が `todayJst` より前ならスキップしない
- Bot DM: 本文付きメンションと同フロー。応答は ephemeral 不可（会話に残る）
- Status OAuth: User Token は D1 暗号化。ログ・レスポンスに出さない。鍵変更後は全員再連携

## app_mention 日付（コードに散らばりやすい）

- 年省略 `M/D` は未来日優先（過去なら翌年）。ISO `YYYY-MM-DD` は繰り上げなし
- 週境界は日曜〜土曜。`今週`+曜日が過去なら翌週同日

## User Group（任意）

- `resolveMasterContext` で**初回** master 作成時のみ追加。daily のみ作成・既存ユーザーのバックフィルなし

## セキュリティ・実装

- Secret は Cloudflare のみ。`/run` は Bearer（timing-safe）
- 実行ログに `run_id`, `processed`, `sent`, `skipped`, `errors` 必須
- request スコープのグローバル保持と未管理 Promise 禁止
- binding / `Env` 変更時は `npm run types`（`worker-configuration.d.ts` 手書き禁止）

## テスト

- 実装完了・PR 前・deploy 前: `npm run check && npm test`
- domain / queue / dedupe / db 変更時は `npm test`。npm scripts 変更時は README も更新
- mention AI 結合は `npm run test:integration`（CI 外）。Queue retry は一時障害のみ
