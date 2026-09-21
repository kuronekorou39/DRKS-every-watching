import { fromTwitch } from '../../lib/core.mjs';
import { buildUrl, getJson, getAppToken } from './http.mjs';

export const requiredEnv = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'];

/**
 * keys: Twitch のログイン名の配列 → Map(key → { channel, finished, live })
 * 見つからないチャンネル（名前の変更・停止・書き間違い）は結果に入れず、report で知らせる。ほかのチャンネルは続ける。
 * knownIds（key → 前回までに分かっているユーザー ID）があれば、名前が変わっていても ID で探し直す
 */
export async function fetchAll(keys, env, { knownIds = new Map(), report = () => {} } = {}) {
  const token = await getAppToken('https://id.twitch.tv/oauth2/token', env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
  const headers = { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` };
  const helix = (path, params) => getJson(buildUrl(`https://api.twitch.tv/helix/${path}`, params), headers);

  const { data: byLogin } = await helix('users', { login: keys });
  const lostIds = keys.filter((key) => !byLogin.some((u) => u.login === key.toLowerCase())).map((key) => knownIds.get(key)).filter(Boolean);
  const { data: byId } = lostIds.length ? await helix('users', { id: lostIds }) : { data: [] };

  const found = new Map();
  for (const key of keys) {
    const user = byLogin.find((u) => u.login === key.toLowerCase()) ?? byId.find((u) => u.id === knownIds.get(key));
    if (!user) {
      report(`Twitch の ${key} が見つかりません（名前の変更・停止・書き間違いのどれか）。このチャンネルは飛ばして続けます`);
    } else {
      if (user.login !== key.toLowerCase()) report(`Twitch の ${key} は ${user.login} に名前が変わっています。channels.json を直してください（記録は続けています）`);
      found.set(key, user);
    }
  }
  if (!found.size) return new Map();

  const { data: lives } = await helix('streams', { user_id: [...found.values()].map((u) => u.id), type: 'live', first: 100 });

  const out = new Map();
  for (const [key, user] of found) {
    // アーカイブは多くても数十〜百件程度。念のため上限を置く
    const videos = [];
    let cursor;
    do {
      const r = await helix('videos', { user_id: user.id, type: 'archive', first: 100, after: cursor });
      videos.push(...r.data);
      cursor = r.data.length ? r.pagination?.cursor : undefined;
    } while (cursor && videos.length < 1000);

    out.set(key, {
      channel: {
        id: user.id,
        login: user.login,
        display_name: user.display_name,
        profile_image_url: user.profile_image_url,
        url: `https://www.twitch.tv/${user.login}`,
      },
      ...fromTwitch(videos, lives.find((l) => l.user_id === user.id) ?? null),
    });
  }
  return out;
}
