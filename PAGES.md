# Cloudflare Pages に上げたら使えるか (2026-11-19 調査)

## 結論
- **V3 を丸ごと Pages に上げても使えない。** 画面は出ても中継が動かない
- **フロントだけ Pages + Wisp バックエンドは別ホスト**、なら使える (分割構成)

## なぜ丸ごとはダメか
- V3 の本体は常駐 Node サーバー (Fastify) で、Wisp は張りっぱなしの WebSocket を
  前提にする。Pages は静的配信 + Pages Functions (Workers ランタイム) で、
  常駐プロセスも Node の `net`/`ws` サーバーも持てない
- サーバーレスで無理にやる場合は転送を Bare に落とすしかなく、WebSocket を使う
  サイトが壊れる・宛先 TLS がサーバー側終端になる・出口トラフィック課金が
  かさむ、という代償がある (ProxDocs の serverless 解説)
- `/scram/`、`/libcurl/`、`/baremux/` の資産も node_modules から配信しているので、
  リポジトリをそのまま Pages の出力にしても揃わない

## 分割構成にする場合の手順 (フロント=Pages / 後ろ=Render や自宅サーバー)
1. バックエンドを Render か自宅サーバー (+HTTPS) で普通に起動しておく (V3 の通常手順)
2. フロント用に静的ファイルを一式集める: `public/` + node_modules の
   `@mercuryworkshop/scramjet` の dist を `/scram/`、`libcurl-transport` を `/libcurl/`、
   `bare-mux` を `/baremux/` に配置
3. `config.js` の `window.__WISP_URL__` にバックエンドの `wss://.../wisp/` を書く
   (この接続先切替は V3 に実装済み。通常は空 = 同一ホスト)
4. Pages 側に `_headers` を置いて COOP/COEP を付ける (サーバー版が付けているものと同等):
   ```
   /*
     Cross-Origin-Opener-Policy: same-origin
     Cross-Origin-Embedder-Policy: require-corp
     X-Content-Type-Options: nosniff
   ```
5. 注意: パスワードゲートはサーバー側の機能なので、フロントだけ Pages にすると
   ゲートが効かない。守るならバックエンド側の Wisp 接続にも認証を足すか、
   Cloudflare Access を Pages 側に被せること

## じゃあ Pages の旨みは？
- 入口の URL が `*.pages.dev` になり、フロント配信は無料・高速
- ただし中継の実働部隊 (Wisp) は結局どこかのサーバーに置くので、
  「サーバー不要で無料」にはならない。出口 IP もバックエンドのものになる
