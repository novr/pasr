# AGENTS.md

## Purpose
- Slack List を入力台帳とし、Cloudflare Workers 上の Slack App で不在通知を実行する。

## Core Rules
- 判定基準時刻は常に JST（`Asia/Tokyo`）。
- 失敗はレコード単位で隔離し、全体処理は継続する。

## Phase 2 Deploy-First Rules
- 優先事項は deploy-first（先に安全なデプロイ運用を固定する）。
- `README.md` を運用Runbookの正本として扱い、手順変更時は実装と同時更新する。
- `/run` は手動再実行専用入口とし、Bearer token 認証なしの実行を許可しない。
- 実行ログは `run_id`, `listId`, `processed`, `sent`, `skipped`, `errors` を必須キーとして扱う。
- 可観測性の高度化（ダッシュボード/集計ストア）は Phase 2.x へ分離し、Phase 2 では実施しない。

## Production Operation Guardrails
- Secret 値やトークンをレスポンス本文やログへ出力しない。
- 認証失敗時は `401` と最小エラーボディで返す。
- `scheduled` の週末スキップを回避するための強制フラグを導入しない。
- 本番障害時は「原因修正 -> `/run` 再実行 -> run summary確認」の順序を維持する。

## Phase 2.1 Slack Events Rules
- Slack 起点 endpoint は `POST /slack/events` を入口とし、署名検証必須で受け付ける。
- 署名検証は `request.text()` の生ボディを使用し、JSON 再構成文字列で検証しない。
- `event_callback` は 200 ACK を先に返し、重い処理は必ず非同期へ委譲する。
- `event_id` の短期 TTL 重複抑止を必須とし、重複イベントは捨てる。
- 重複抑止時は `duplicate_event_dropped` を構造化ログで記録する。

## Phase 2.2 Slash Command Rules
- Slash Command 入口は `POST /slack/command` とし、署名検証必須で受け付ける。
- 実行権限は `SLACK_ADMIN_USER_IDS` で判定し、allowlist 非該当は no-op とする。
- Slash Command ACK 本文は固定する（許可: `Accepted` / 非許可: `Received. Processing...`）。
- コマンド処理は ACK 後に非同期実行し、同期処理で重い処理を行わない。
- `trigger_id` の TTL=300秒重複抑止を必須とし、重複コマンドは捨てる。

## Configuration
- 組織ごとに Slack App / Cloudflare 環境を分離する。
- Secrets は Cloudflare 側で管理し、リポジトリへ保存しない。
  - 例: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
- vars:
  - `TZ=Asia/Tokyo`
  - `SLACK_ADMIN_USER_IDS`

## Architecture Boundary
- Slack は入力/UI境界、Cloudflare Workers は実行/通知境界として扱う。
- Cloudflare 実装は Agents SDK（`agents`）前提で設計する。
- Workers ルーティングは `routeAgentRequest` を優先し、通常 HTTP と境界分離する。
- Durable Object binding と migration の追加運用を守り、既存 migration は変更しない。
- TypeScript は `experimentalDecorators` を有効化しない。

## Cloudflare / Workers Policy
- Cloudflare 仕様は事前知識で断定せず、公式ドキュメントを都度確認する。
- Worker 設定は `wrangler.jsonc` を正本として扱う。
- binding 変更時は `wrangler types` で型同期し、`Env` を手書きしない。
- `compatibility_date` は定期更新し、`nodejs_compat` を基本方針とする。
- Secret は Cloudflare 側でのみ管理し、コードや設定に埋め込まない。
- request スコープのグローバル保持と未管理 Promise を禁止する。
