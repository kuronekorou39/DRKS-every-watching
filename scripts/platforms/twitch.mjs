import { fromTwitch } from '../../lib/core.mjs';
import { ConfigError, buildUrl, getJson, getAppToken } from './http.mjs';

export const requiredEnv = ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'];

/** keys: Twitch のログイン名の配列 → Map(key → { channel, finished, live }) */
export async function fetchAll(keys, env) {
  const token = await getAppToken('https://id.twitch.tv/oauth2/token', env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
  const headers = { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` };
  const helix = (path, params) => getJson(buildUrl(`https://api.twitch.tv/helix/${path}`, params), headers);

  const { data: users } = await helix('users', { login: keys });
  const missing = keys.filter((key) => !users.some((u) => u.login === key.toLowerCase()));
  if (missing.length) throw new ConfigError(`Twitch のユーザーが見つかりません: ${missing.join(', ')}`);

  const { data: lives } = await helix('streams', { user_id: users.map((u) => u.id), type: 'live', first: 100 });

  const out = new Map();
  for (const key of keys) {
    const user = users.find((u) => u.login === key.toLowerCase());
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
