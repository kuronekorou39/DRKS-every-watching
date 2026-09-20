// channels.json に書いた各チャンネルの配信状況を取得し、history.json にマージする。
// 必要な環境変数はプラットフォームごと（各 platforms/*.mjs の requiredEnv）。任意: DATA_DIR
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeHistory, normalizeHistory, PLATFORMS } from '../lib/core.mjs';
import { ConfigError } from './platforms/http.mjs';
import * as twitch from './platforms/twitch.mjs';
import * as youtube from './platforms/youtube.mjs';
import * as kick from './platforms/kick.mjs';

const FETCHERS = { twitch, youtube, kick };
const dataDir = process.env.DATA_DIR ?? 'data';
const file = join(dataDir, 'history.json');

// GitHub Actions では実行結果の画面に警告として出る
const warn = (msg) => console.log(`::warning::${msg}`);

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

const config = await readJson('channels.json');
if (!config?.length) throw new Error('channels.json に記録するチャンネルを書いてください');

// プラットフォームごとにまとめて取得する。一時的な失敗（API の不調や上限超過）ではそのプラットフォームだけ飛ばし、
// 前回までの記録をそのまま残す。channels.json の誤りは放っておいても直らないので、全体を止める
const fetched = {};
for (const [platform, fetcher] of Object.entries(FETCHERS)) {
  const keys = config.map((c) => c[platform]).filter(Boolean);
  if (!keys.length) continue;
  const missingEnv = fetcher.requiredEnv.filter((name) => !process.env[name]);
  if (missingEnv.length) {
    warn(`${PLATFORMS[platform].label}: ${missingEnv.join(', ')} が未設定なので取得を飛ばします`);
    continue;
  }
  try {
    fetched[platform] = await fetcher.fetchAll(keys, process.env);
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    warn(`${PLATFORMS[platform].label}: 取得に失敗したので今回は飛ばします（${e.message}）`);
  }
}
if (!Object.keys(fetched).length) throw new Error('どのプラットフォームからも取得できませんでした');

const prevSources = normalizeHistory(await readJson(file)).channels.flatMap((c) => c.sources);

const channels = config.map((entry) => {
  const sources = [];
  for (const platform of Object.keys(FETCHERS)) {
    const key = entry[platform];
    if (!key) continue;
    const result = fetched[platform]?.get(key);
    // ログイン名は変わりうるので、前回の記録とはまず id で突き合わせる
    const prev =
      prevSources.find((s) => s.platform === platform && result && s.channel.id === result.channel.id) ??
      prevSources.find((s) => s.platform === platform && s.key === key);
    if (!result) {
      if (prev) sources.push(prev);
      continue;
    }
    const streams = mergeHistory(prev?.streams ?? [], result);
    sources.push({ platform, key, channel: result.channel, streams });
    console.log(
      `${PLATFORMS[platform].label} ${result.channel.display_name}: 記録 ${streams.length} 件` +
        `（今回確定 ${result.finished.length} 件 / ライブ中: ${result.live ? 'はい' : 'いいえ'}）`,
    );
  }
  return {
    name: entry.name ?? sources[0]?.channel.display_name ?? '',
    icon: sources.find((s) => s.channel.profile_image_url)?.channel.profile_image_url ?? '',
    sources,
  };
});

await mkdir(dataDir, { recursive: true });
// 1 件 1 行寄りの整形にしておくと git の差分が読みやすい
await writeFile(file, JSON.stringify({ channels }, null, 1) + '\n');
