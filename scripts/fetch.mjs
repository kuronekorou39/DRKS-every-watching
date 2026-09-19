// Twitch Helix API から VOD とライブ状態を取得し、history.json にマージする。
// 必要な環境変数: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, TWITCH_LOGINS（カンマ区切り。任意: DATA_DIR）
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mergeHistory, normalizeHistory } from '../lib/core.mjs';

const {
  TWITCH_CLIENT_ID: clientId,
  TWITCH_CLIENT_SECRET: clientSecret,
  TWITCH_LOGINS: loginsRaw = '',
  DATA_DIR: dataDir = 'data',
} = process.env;

const logins = [...new Set(loginsRaw.toLowerCase().split(/[\s,]+/).filter(Boolean))];

if (!clientId || !clientSecret || !logins.length) {
  console.error('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET / TWITCH_LOGINS を設定してください');
  process.exit(1);
}

const file = join(dataDir, 'history.json');

async function getAppToken() {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

function helixClient(token) {
  return async function helix(path, params = {}) {
    const url = new URL(`https://api.twitch.tv/helix/${path}`);
    // 配列は同じキーの繰り返しで渡す（login=a&login=b）
    for (const [k, v] of Object.entries(params)) {
      for (const item of [v].flat()) if (item != null) url.searchParams.append(k, item);
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
      });
      if (res.status === 429 && attempt < 3) {
        const reset = Number(res.headers.get('ratelimit-reset')) * 1000;
        await sleep(Math.max(1000, reset - Date.now()));
        continue;
      }
      if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
      return res.json();
    }
  };
}

async function readHistory() {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

const helix = helixClient(await getAppToken());

const { data: found } = await helix('users', { login: logins });
const users = logins.map((login) => found.find((u) => u.login === login));
const missing = logins.filter((_, i) => !users[i]);
// 打ち間違いで記録が消えないよう、1人でも見つからなければ何も書かずに止める
if (missing.length) throw new Error(`ユーザーが見つかりません: ${missing.join(', ')}`);

const { data: lives } = await helix('streams', { user_id: users.map((u) => u.id), type: 'live', first: 100 });

const prev = normalizeHistory(await readHistory());
const channels = [];

for (const user of users) {
  // アーカイブは多くても数十〜百件程度。念のため上限を置く
  const videos = [];
  let cursor;
  do {
    const r = await helix('videos', { user_id: user.id, type: 'archive', first: 100, after: cursor });
    videos.push(...r.data);
    cursor = r.data.length ? r.pagination?.cursor : undefined;
  } while (cursor && videos.length < 1000);

  const live = lives.find((l) => l.user_id === user.id) ?? null;
  // ログイン名は変わりうるので、前回の記録とは id で突き合わせる
  const prevStreams = prev.channels.find((c) => c.channel.id === user.id)?.streams ?? [];
  const streams = mergeHistory(prevStreams, { videos, live });

  channels.push({
    channel: {
      id: user.id,
      login: user.login,
      display_name: user.display_name,
      profile_image_url: user.profile_image_url,
    },
    streams,
  });

  console.log(
    `${user.display_name}: 記録 ${streams.length} 件（VOD ${videos.length} 件 / ライブ中: ${live ? 'はい' : 'いいえ'}）`,
  );
}

await mkdir(dataDir, { recursive: true });
// 1 件 1 行寄りの整形にしておくと git の差分が読みやすい
await writeFile(file, JSON.stringify({ channels }, null, 1) + '\n');
