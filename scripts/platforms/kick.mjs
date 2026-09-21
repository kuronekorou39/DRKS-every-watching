import { fromKick } from '../../lib/core.mjs';
import { buildUrl, getJson, getAppToken } from './http.mjs';

export const requiredEnv = ['KICK_CLIENT_ID', 'KICK_CLIENT_SECRET'];

const API = 'https://api.kick.com/public/v1/channels';

/**
 * keys: Kick のチャンネル名（kick.com/◯◯ の部分）の配列 → Map(key → { channel, finished, live })
 * 公開 API には過去の配信を返すものがないので、配信中かどうかのポーリングだけで記録する。
 * 見つからないチャンネルは結果に入れず、report で知らせる。名前が変わっていても、
 * knownIds（key → 前回までに分かっているユーザー ID）があれば ID で探し直す
 */
export async function fetchAll(keys, env, { knownIds = new Map(), report = () => {} } = {}) {
  const token = await getAppToken('https://id.kick.com/oauth/token', env.KICK_CLIENT_ID, env.KICK_CLIENT_SECRET);
  const headers = { Authorization: `Bearer ${token}` };

  const { data: bySlug = [] } = await getJson(buildUrl(API, { slug: keys.map((k) => k.toLowerCase()) }), headers);
  // slug と ID は同じ呼び出しに混ぜられないので、名前で見つからなかった分だけ ID で探し直す
  const lostIds = keys.filter((key) => !bySlug.some((c) => c.slug === key.toLowerCase())).map((key) => knownIds.get(key)).filter(Boolean);
  const { data: byId = [] } = lostIds.length ? await getJson(buildUrl(API, { broadcaster_user_id: lostIds }), headers) : {};

  const out = new Map();
  for (const key of keys) {
    const ch = bySlug.find((c) => c.slug === key.toLowerCase()) ?? byId.find((c) => String(c.broadcaster_user_id) === knownIds.get(key));
    if (!ch) {
      report(`Kick の ${key} が見つかりません（名前の変更・停止・書き間違いのどれか）。このチャンネルは飛ばして続けます`);
      continue;
    }
    if (ch.slug !== key.toLowerCase()) report(`Kick の ${key} は ${ch.slug} に名前が変わっています。channels.json を直してください（記録は続けています）`);
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
