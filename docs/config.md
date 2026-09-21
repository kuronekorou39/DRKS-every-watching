# 設定ファイル

どれも `main` に push すれば、次の取得（10分以内）から反映される。

## channels.json

記録するチャンネル。表示したい順に1人1件。配信しているものだけ書けばよい。

```json
[{ "name": "表示名（省略可）", "twitch": "ログイン名", "youtube": "@ハンドル か UC… の ID", "kick": "チャンネル名" }]
```

- `twitch` … twitch.tv/◯◯ の部分
- `youtube` … youtube.com/@◯◯ の `@◯◯`、または `UC` で始まるチャンネル ID
- `kick` … kick.com/◯◯ の部分
- `name` を省くと、最初の配信先の表示名を使う

## manual.json

API から取れない配信を手で足す。時刻は日本時間。`channel` は `channels.json` に書いた値と同じもの。

```json
[{ "platform": "kick", "channel": "mokoutoaruotoko", "start": "2026-09-19 15:49", "duration": "1h38m", "title": "省略可" }]
```

- 終わりは `end`（時刻）か `duration`（`"1h38m"` の形の長さ）のどちらかで書く
- `title` / `game` / `url`（アーカイブのページ）/ `thumb`（サムネイル画像）は省略できる
- このファイルが正。書き換えたり消したりすれば、記録のほうもそうなる（API から取った記録には影響しない）
- 同じ時間帯にポーリングで拾った記録があれば、こちらが優先される

### Kick の過去の配信を取り込む

Kick のアーカイブ一覧は Actions からは読めないが、ブラウザなら開ける。

1. ブラウザで `https://kick.com/api/v2/channels/<チャンネル名>/videos` を開き、表示された JSON をファイルに保存する
2. `npm run kick-import -- 保存したファイル [チャンネル名]`（チャンネル名を省くと、`channels.json` で最初に見つかった kick を使う）
3. `manual.json` の差分を確かめて commit / push する

同じ配信は入れ直すだけなので、何度やってもよい。配信中のものは取り込まない。

## settings.json

`recordFrom`（日本時間の日付）より前に始まった配信は記録しない。ボードでは、それより前は斜線の「記録なし」になる。

```json
{ "recordFrom": "2026-09-16" }
```

API はそれより前のアーカイブも返してくるので、取得のたびにこの日付で落としている。
日付を前に動かせば、アーカイブが残っている分は次の取得で戻る。
