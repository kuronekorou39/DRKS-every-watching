# セットアップ

## 自分のリポジトリで動かす

1. リポジトリを **public** で作る（取得がほぼ常時走るので、private だと Actions の無料枠を超える）
2. API の認証情報を用意して、リポジトリの Secrets に入れる（YouTube と Kick は使う場合だけ）

   | Secrets | 取得先 |
   |---|---|
   | `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | https://dev.twitch.tv/console/apps でアプリ登録（リダイレクト URL は `http://localhost`、種類は「機密」） |
   | `YOUTUBE_API_KEY` | Google Cloud Console で「YouTube Data API v3」を有効にして API キーを作る（キーの制限で、この API だけに絞る） |
   | `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | https://kick.com/settings/developer でアプリを作る |

3. Settings → Pages → Source を「GitHub Actions」にする
4. [`channels.json`](config.md#channelsjson) を書き換えて push する（`deploy` が走り、`collect` も起動する）

動いているかは Actions タブで分かる。`collect` がいつも1本「実行中」になっていれば正常。

## ローカルで動かす

```powershell
npm run sample   # ダミーデータを data/history.json に作る
npm run serve    # http://localhost:8080
npm test         # 共通ロジックのテスト（Node 20.6 以上）

# 画面のテスト（Playwright）。初回だけ npm install と npx playwright install chromium が要る
npm run test:e2e

# 実データを取る場合は .env.example を .env にコピーして値を入れてから
npm run fetch
```

## テスト

- `test/` … 共通ロジック（`lib/core.mjs`）の単体テスト。`deploy` でも走り、失敗すると公開されない
- `e2e/` … 画面のテスト。決まった時刻とデータを差し込んで、幅 20 通り × 日数 5 通りでレイアウトの約束
  （ヘッダーは1行、横軸の見出しは2段まで、スクロールなし、バーは行の縦中央 など）と、操作したときの動きを確かめる。
  push のたびに `test` ワークフローで走る
