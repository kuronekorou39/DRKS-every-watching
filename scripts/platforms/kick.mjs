import { fromKick } from '../../lib/core.mjs';
import { buildUrl, getJson, getAppToken } from './http.mjs';

export const requiredEnv = ['KICK_CLIENT_ID', 'KICK_CLIENT_SECRET'];

/**
 * keys: Kick のチャンネル名（kick.com/◯◯ の部分）の配列 → Map(key → { channel, finished, live })
 * 公開 API には過去の配信を返すものがないので、配信中かどうかのポーリングだけで記録する。
 * 見つからないチャンネル（名前の変更・停止・書き間違い）は結果に入れず、report で知らせる。ほかのチャンネルは続ける
 */
export async function fetchAll(keys, env, { report = () => {} } = {}) {
  const token = await getAppToken('https://id.kick.com/oauth/token', env.KICK_CLIENT_ID, env.KICK_CLIENT_SECRET);
  const { data: channels = [] } = await getJson(
    buildUrl('https://api.kick.com/public/v1/channels', { slug: keys.map((k) => k.toLowerCase()) }),
    { Authorization: `Bearer ${token}` },
  );

  const out = new Map();
  for (const key of keys) {
    const ch = channels.find((c) => c.slug === key.toLowerCase());
    if (!ch) {
      report(`Kick の ${key} が見つかりません（名前の変更・停止・書き間違いのどれか）。このチャンネルは飛ばして続けます`);
      continue;
    }
    out.set(key, {
      channel: {
        id: String(ch.broadcaster_user_id),
        login: ch.slug,
        display_name: ch.slug,
        profile_image_url: '',
        url: `https://kick.com/${ch.slug}`,
      },
      ...fromKick(ch),
    });
  }
  return out;
}
