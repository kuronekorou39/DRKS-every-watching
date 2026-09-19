// API 登録前に見た目を確認するためのダミーデータを data/history.json に書き出す。
import { writeFile, mkdir } from 'node:fs/promises';
import { localDayStart } from '../lib/core.mjs';

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const HOUR = 3600_000;
const now = Date.now();
const streams = [];

for (let d = 70; d >= 0; d--) {
  const day = localDayStart(now - d * 24 * HOUR);
  const wd = (new Date(day + 9 * HOUR).getUTCDay() + 6) % 7;
  const weekend = wd >= 5;
  if (rand() < (weekend ? 0.25 : 0.35)) continue; // 休み
  const startH = weekend ? 13 + rand() * 3 : 20.5 + rand() * 1.5;
  const start = day + startH * HOUR;
  const end = start + (2 + rand() * (weekend ? 4 : 2.5)) * HOUR;
  if (start > now) continue;
  const live = end > now;
  streams.push({
    stream_id: String(40000000000 + streams.length),
    start: new Date(start).toISOString(),
    end: new Date(live ? now : end).toISOString(),
    end_source: live || rand() < 0.2 ? 'poll' : 'vod',
    live,
    title: weekend ? '【長時間】まったり作業配信' : '雑談しながらランクマ',
    game: weekend ? 'Just Chatting' : 'Apex Legends',
  });
}

await mkdir('data', { recursive: true });
await writeFile(
  'data/history.json',
  JSON.stringify({ channel: { id: '0', login: 'sample', display_name: 'サンプル配信者', profile_image_url: '' }, streams }, null, 1) + '\n',
);
console.log(`ダミーデータ ${streams.length} 件を data/history.json に書き出しました`);
