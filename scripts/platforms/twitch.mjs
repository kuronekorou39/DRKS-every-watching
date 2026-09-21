import { fromTwitch } from '../../lib/core.mjs';
import { buildUrl, getJson, getAppToken } from './http.mjs';

export const requiredEnv = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'];

/**
 * keys: Twitch のログイン名の配列 → Map(key → { channel, finished, live })
 * 見つからないチャンネル（名前の変更・停止・書き間違い）は結果に入れず、report で知らせる。ほかのチャンネルは続ける。
 * 停止が解ければ、次の取得からまた見つかって記録が再開する
 */
export async function fetchAll(keys, env, { report = () => {} } = {}) {
  const token = await getAppToken('https://id.twitch.tv/oauth2/token', env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
  const headers = { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` };
  const helix = (path, params) => getJson(buildUrl(`https://api.twitch.tv/helix/${path}`, params), headers);

  const { data: users } = await helix('users', { login: keys });
  const found = new Map();
  for (const key of keys) {
    const user = users.find((u) => u.login === key.toLowerCase());
    if (user) found.set(key, user);
    else report(`Twitch の ${key} が見つかりません（名前の変更・停止・書き間違いのどれか）。このチャンネルは飛ばして続けます`);
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
