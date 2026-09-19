# drks-every-watching

Twitch の複数チャンネル（現在は8人）の配信実績を記録し、1人1行のスケジュールボードに並べて表示する静的サイト。
表示範囲は 1日〜4週の切り替え、前後への移動、開始日・終了日の指定で変えられる（範囲は URL の `?from=&to=` に残るので共有できる）。
サーバーは使わず、GitHub Actions が10分おきに Twitch API から取得し、GitHub Pages で公開する。

## しくみ

- `scripts/fetch.mjs` … アーカイブ（`/videos`）で正確な開始・終了を取り、ライブ状態（`/streams`）のポーリングで取りこぼしを補って `history.json` にマージ
- ログイン名が1つでも見つからないときは、記録を書き換えずにエラーで止まる（打ち間違いで記録を消さないため）
- 記録は `data` ブランチに保存（変化があったときだけコミット）。一度記録した配信は、VOD が消えても残る
- 記録に変化があったときだけ Pages を再デプロイ
- `lib/core.mjs` は取得スクリプトとブラウザで共有

## セットアップ

1. https://dev.twitch.tv/console/apps でアプリを登録し、Client ID と Client Secret を取得
   （OAuth リダイレクト URL は `http://localhost` で可、クライアントの種類は「機密」）
2. リポジトリを **public** で作る（private だと10分おきの cron で Actions の無料枠を超える）
3. Secrets と Variables を設定
   - Secrets: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
   - Variables: `TWITCH_LOGINS`（チャンネルのログイン名をカンマ区切りで。URL の twitch.tv/◯◯ の部分。並べた順に表示される）
4. Settings → Pages → Source を「GitHub Actions」に
5. Actions タブから `collect` を手動実行（初回で直近のアーカイブ分が埋まる）

## ローカルで確認

```powershell
npm run sample   # ダミーデータで見た目だけ確認
npm run serve    # http://localhost:8080

# 実データを取る場合は .env.example を .env にコピーして値を入れてから
npm run fetch
```

`npm test` で共通ロジックのテストが走る（Node 20.6 以上）。

## 注意

- 開始時刻は API の値なので正確。アーカイブが残らない配信は、終了時刻が最大でポーリング間隔ぶんずれる
- Actions の cron は混雑時に遅れたりスキップされたりする
- リポジトリに60日間動きがないと scheduled workflow は自動停止する。止まっていたら Actions タブから再有効化する
