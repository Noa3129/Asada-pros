# 東京プロキシ改善版 V3 (Scramjet ベース)

konomi-tokyo/tokyo-proxy-V2 の弱点を直した自家用版。
土台は MercuryWorkshop/scramjet-app (Scramjet 1.1.0, AGPL-3.0) で、ライセンスは同梱 LICENSE の通り AGPL。

## V2 からの改善点
| 項目 | V2 (東京プロキシ) | V3 (この改善版) |
|---|---|---|
| エンジン | Ultraviolet 1.0.10 (開発終了・後継へ移行済み) | Scramjet 1.1.0 (Rust/WASM リライタ、現行世代) |
| 転送 | Bare Server 1.2.5 (非推奨化) | Wisp (wisp-js) + libcurl transport (宛先TLSはブラウザ側で終端) |
| 認証 | なし (URLを知れば誰でも使える) | `ACCESS_PASSWORD` でパスワードゲート (任意、強く推奨) |
| LAN防御 | Bare が自宅LAN内部へ中継しうる | Wisp の private/loopback IP 拒否を明示 + 直接IP接続禁止 + 内部ホスト名ブラックリスト |
| 実行基盤 | Node 19 (EOL) + CPU数だけ全フォーク | Node 22-alpine + 単一プロセス (Fastify) |
| デプロイ | Render / CodeSandbox 手順のみ、compose なし | Dockerfile (healthcheck付き) / docker-compose / render.yaml を整備 |
| 見た目 | 「東京プロキシ」と分かるタイトル等 | タイトルは中立な "Home" に変更 |

## ブラウザ UI / PWA (v3.1)
- v3.1.3: AUDIT.md の上位項目（#1〜#7、#13）を一括修正。Scramjet 初期化の
  await 化とエラー表示の分離、SW fetch の例外フォールバック（config 読込の
  リトライ＋エラー応答）、ダウンロードイベントの購読（従来は無言でハング）、
  認証 Cookie を90日に延長、フレーム生成と transport 再構築のレース解消、
  Wisp ストリーム上限（total 256 / host 64）、example.com のブラックリスト解除
- v3.1.2: Wisp 接続の自己回復を追加。libcurl transport は Wisp の WebSocket を
  1本張りっぱなしで自動再接続がなく、Render 無料枠のスリープ等で切れると以降の
  遷移が全てプロキシエラー (Uh oh!) になりアプリ再起動まで直らなかった。
  transport が2分以上経過していたら遷移/リロード前に張り直し、アプリ復帰時
  (60秒以上バックグラウンド) とネットワーク復帰時にも張り直すようにした
- v3.1.1: リロード処理を堅牢化。ScramjetFrame.reload() はフレーム内ドキュメントの
  location.reload() で、エラーページや停止した読み込みをそのまま再取得してしまうため、
  現在の実URLへ encode し直して location.replace() で再遷移する方式に変更
  (履歴を増やさないので「戻る」の挙動は不変)。失敗時は go() → reload() の順にフォールバック
- Safari 風ブラウザ UI: 下部ツールバー (戻る / 進む / URL・検索バー / 再読み込み / ホーム)、
  上部プログレスバー、スタートページ (検索バー + ショートカット6件)
- 操作は ScramjetFrame の公式 API (go / back / forward / reload / urlchange イベント) を使用
- PWA 対応: manifest (standalone)、ホーム画面アイコンは `src/icons.js` が実行時に
  PNG 生成 (コンパス柄、リポジトリにバイナリを置かないため)。iPad は Safari の
  共有 →「ホーム画面に追加」でアプリ風に起動できる

## 起動
```bash
# Docker (推奨)
ACCESS_PASSWORD='長いランダムなパスワード' docker compose up -d --build
# -> http://localhost:8080/

# Docker なし
npm install --omit=dev
ACCESS_PASSWORD='...' PORT=8080 npm start
```

## Cloudflare Pages について
丸ごと Pages に上げても使えない (常駐サーバー + 張りっぱなし WebSocket が前提のため)。
フロントだけ Pages に置く分割構成は可能で、そのための接続先切替 (`config.js` の
`window.__WISP_URL__`) を実装済み。詳しくは `PAGES.md`。

## 注意
- iPad Safari では Service Worker の都合で **HTTPS が必須** (localhost 除外)。
  自宅サーバーなら Tailscale Serve/Funnel、公開なら Render 等の HTTPS 前提で使うこと
- パスワード未設定だと V2 と同じ「開かれた中継」になる。インターネットに出すなら必ず設定する
- データセンターIP (Render 等) では CAPTCHA や YouTube が弾かれやすいのは V2/V3 共通の宿命。
  自宅回線の出口 (自宅サーバー + Tailscale/Cloudflare Tunnel) の方がその点は有利
- Scramjet 自体が実験的プロジェクト。サイトによっては V2 (Ultraviolet) の方が表示できる場合もある

## 検証済み (2026-11-19, このVMで実測)
- パスワードなし: `/` 200、`/healthz` {"ok":true}、`/scram/scramjet.all.js` 200、Wisp ハンドシェイク 101
- パスワードあり: 未認証 `/` → 302 で /login、未認証の資産は 401、間違ったPWは 401、
  正しいPWで Cookie 発行後は `/`・資産とも 200
- 実際のサイト表示 (Service Worker 経由の描画) は iPad/ブラウザ実機での確認が別途必要
