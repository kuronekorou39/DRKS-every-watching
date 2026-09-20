# 泥臭ログ（drks-every-watching）

複数の配信者（現在は8人）の配信実績を記録し、1つのスケジュールボードに並べて表示する静的サイト。
Twitch に加えて YouTube と Kick にも対応し、1人につき配信先ごとに1行ずつ並ぶ。
表示範囲は 1日〜4週の切り替え、前後への移動、開始日・終了日の指定で変えられる（範囲は URL の `?from=&to=` に残るので共有できる）。
サーバーは使わず、GitHub Actions が10分おきに各 API から取得し、GitHub Pages で公開する。

## 記録するチャンネル

`channels.json` に、表示したい順に1人1件で書く。`twitch` / `youtube` / `kick` は配信しているものだけ書けばよい。

```json
[
  { "name": "表示名（省略可）", "twitch": "ログイン名", "youtube": "@ハンドル か UC… のチャンネルID", "kick": "チャンネル名" }
]
```

- `twitch` … twitch.tv/◯◯ の部分
- `youtube` … youtube.com/@◯◯ の `@◯◯`、または `UC` で始まるチャンネル ID
- `kick` … kick.com/◯◯ の部分
- `name` を省くと、最初の配信先の表示名を使う

## 手で足す配信

API から取れない過去の配信（Kick の過去分など）は `manual.json` に書くと、次の取得でボードに入る。時刻は日本時間。

```json
[
  { "platform": "kick", "channel": "mokoutoaruotoko", "start": "2026-09-01 21:00", "end": "2026-09-02 01:30", "title": "省略可", "game": "省略可" }
]
```

- `channel` は `channels.json` に書いた値と同じもの
- 手で足した分はこのファイルが正。書き換えたり消したりすれば、記録のほうもそうなる（API から取った記録には影響しない）

## しくみ

- `scripts/fetch.mjs` が `scripts/platforms/*.mjs` でプラットフォームごとに取得し、`history.json` にマージ
  - Twitch … アーカイブ（`/videos`）で正確な開始・終了を取り、ライブ状態（`/streams`）のポーリングで取りこぼしを補う
  - YouTube … アップロード一覧の新しい50本から、ライブだったものの実際の開始・終了時刻を取る（1チャンネル1回3ユニット。10分おき×8チャンネルで1日の上限1万ユニットの3分の1ほど）
  - Kick … 公開 API に過去の配信を返すものがないので、配信中かどうかのポーリングだけで記録する（設定する前の配信は埋まらない）
- `channels.json` のチャンネルが見つからないときは、記録を書き換えずにエラーで止まる（打ち間違いで記録を消さないため）
- API の不調や上限超過、Secrets の未設定では、そのプラットフォームだけ飛ばして前回までの記録を残す（Actions の実行結果に警告が出る）
- 記録は `data` ブランチに保存（変化があったときだけコミット）。一度記録した配信は、アーカイブが消えても残る
- 記録に変化があったときだけ Pages を再デプロイ
- `lib/core.mjs` は取得スクリプトとブラウザで共有

## セットアップ

1. API の認証情報を用意する（YouTube と Kick は `channels.json` に書いた場合だけ）
   - Twitch … https://dev.twitch.tv/console/apps でアプリを登録し、Client ID と Client Secret を取得
     （OAuth リダイレクト URL は `http://localhost` で可、クライアントの種類は「機密」）
   - YouTube … Google Cloud Console でプロジェクトを作り、「YouTube Data API v3」を有効にして API キーを作る
     （キーの制限で API を YouTube Data API v3 だけに絞っておく）
   - Kick … https://kick.com/settings/developer でアプリを作り、Client ID と Client Secret を取得
2. リポジトリを **public** で作る（private だと10分おきの cron で Actions の無料枠を超える）
3. Secrets を設定: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `YOUTUBE_API_KEY`, `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`
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
