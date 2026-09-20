// Kick の過去の配信（アーカイブ一覧）を manual.json に取り込む。
//
// Kick の公開 API には過去の配信を返すものがなく、アーカイブ一覧の URL は Actions からは読めない（ブラウザなら開ける）。
// そこで、一覧をブラウザで開いて保存した JSON を、このスクリプトで manual.json の形に直す。
//   1. ブラウザで https://kick.com/api/v2/channels/<チャンネル名>/videos を開き、表示された JSON を kick.json などに保存
//   2. npm run kick-import -- kick.json [チャンネル名]
//   3. manual.json の差分を確かめて commit / push
// チャンネル名を省くと、channels.json で最初に見つかった kick の値を使う。
import { readFile, writeFile } from 'node:fs/promises';
import { localDateTimeString } from '../lib/core.mjs';

const [file, channelArg] = process.argv.slice(2);
if (!file) {
  console.error('使い方: npm run kick-import -- <保存した JSON> [チャンネル名]');
  process.exit(1);
}

const channels = JSON.parse(await readFile('channels.json', 'utf8'));
const channel = channelArg ?? channels.find((c) => c.kick)?.kick;
if (!channel) throw new Error('channels.json に kick のチャンネルがありません。チャンネル名を引数で渡してください');

const saved = JSON.parse(await readFile(file, 'utf8'));
const videos = Array.isArray(saved) ? saved : saved.data ?? [];

const imported = videos
  // 配信中のものは長さが決まっていないので、終わってから取り込む
  .filter((v) => !v.is_live && Number(v.duration) > 0)
  .map((v) => {
    // start_time は "YYYY-MM-DD HH:MM:SS" の UTC
    const start = Date.parse(`${v.start_time.replace(' ', 'T')}Z`);
    return {
      platform: 'kick',
      channel,
      start: localDateTimeString(start),
      end: localDateTimeString(start + Number(v.duration)),
      title: v.session_title ?? '',
      game: v.categories?.[0]?.name ?? null,
      url: v.video?.uuid ? `https://kick.com/${channel}/videos/${v.video.uuid}` : null,
      thumb: v.thumbnail?.src ?? null,
    };
  });

// 同じ配信（同じチャンネルの同じ開始時刻）は入れ直し、手で書いたほかの行はそのまま残す
const manual = JSON.parse(await readFile('manual.json', 'utf8'));
const key = (m) => `${m.platform} ${m.channel} ${m.start}`;
const importedKeys = new Set(imported.map(key));
const merged = [...manual.filter((m) => !importedKeys.has(key(m))), ...imported]
  .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

// 1件1行にしておくと、git の差分が読みやすい
await writeFile('manual.json', `[\n${merged.map((m) => `  ${JSON.stringify(m)}`).join(',\n')}\n]\n`);
console.log(`${channel}: ${imported.length} 件を取り込みました（manual.json は全 ${merged.length} 件）`);
