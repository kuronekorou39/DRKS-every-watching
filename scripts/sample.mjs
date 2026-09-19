// API 登録前に見た目を確認するためのダミーデータを data/history.json に書き出す。
import { writeFile, mkdir } from 'node:fs/promises';
import { localDayStart } from '../lib/core.mjs';

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const HOUR = 3600_000;
const now = Date.now();

// 平日の開始時刻・休む確率・長さをずらして、8人それぞれ違う傾向にする
const PROFILES = [
  { name: 'サンプルA', weekdayStart: 20.5, rest: 0.35, hours: 2 },
  { name: 'サンプルB', weekdayStart: 22, rest: 0.5, hours: 3 },
  { name: 'サンプルC', weekdayStart: 9, rest: 0.2, hours: 1.5 },
  { name: 'サンプルD', weekdayStart: 19, rest: 0.7, hours: 4 },
  { name: 'サンプルE', weekdayStart: 23.5, rest: 0.4, hours: 3 },
  { name: 'サンプルF', weekdayStart: 14, rest: 0.6, hours: 2 },
  { name: 'サンプルG', weekdayStart: 21, rest: 0.15, hours: 1 },
  { name: 'サンプルH', weekdayStart: 18, rest: 0.85, hours: 5 },
];

function sampleStreams(profile, idBase) {
  const streams = [];
  for (let d = 70; d >= 0; d--) {
    const day = localDayStart(now - d * 24 * HOUR);
    const wd = (new Date(day + 9 * HOUR).getUTCDay() + 6) % 7;
    const weekend = wd >= 5;
    if (rand() < (weekend ? profile.rest - 0.1 : profile.rest)) continue; // 休み
    const startH = weekend ? 13 + rand() * 3 : profile.weekdayStart + rand() * 1.5;
    const start = day + startH * HOUR;
    const end = start + (profile.hours + rand() * (weekend ? 4 : 2.5)) * HOUR;
    if (start > now) continue;
    const live = end > now;
    streams.push({
      stream_id: String(idBase + streams.length),
      start: new Date(start).toISOString(),
      end: new Date(live ? now : end).toISOString(),
      end_source: live || rand() < 0.2 ? 'poll' : 'vod',
      live,
      title: weekend ? '【長時間】まったり作業配信' : '雑談しながらランクマ',
      game: weekend ? 'Just Chatting' : 'Apex Legends',
    });
  }
  return streams;
}

const channels = PROFILES.map((profile, i) => ({
  channel: { id: String(i), login: `sample${i + 1}`, display_name: profile.name, profile_image_url: '' },
  streams: sampleStreams(profile, 40000000000 + i * 1000),
}));

await mkdir('data', { recursive: true });
await writeFile('data/history.json', JSON.stringify({ channels }, null, 1) + '\n');
console.log(`ダミーデータ ${channels.length} 人分を data/history.json に書き出しました`);
