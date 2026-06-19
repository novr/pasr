# AGENTS.md

## Purpose
- Slack List を入力台帳とし、Cloudflare Workers 上の Slack App で不在通知を実行する。

## Core Rules
- 判定基準時刻は常に JST（`Asia/Tokyo`）。
- 失敗はレコード単位で隔離し、全体処理は継続する。

## Configuration
- 組織ごとに Slack App / Cloudflare 環境を分離する。
- Secrets は Cloudflare 側で管理し、リポジトリへ保存しない。
  - 例: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
- vars:
  - `TZ=Asia/Tokyo`

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
