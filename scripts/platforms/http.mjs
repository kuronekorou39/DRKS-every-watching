import { setTimeout as sleep } from 'node:timers/promises';

/** channels.json の書き間違いなど、放っておいても直らない誤り。これが出たら記録を書き換えずに止める */
export class ConfigError extends Error {}

/** 配列の値は同じキーの繰り返しにする（login=a&login=b） */
export function buildUrl(base, params = {}) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    for (const item of [v].flat()) if (item != null) url.searchParams.append(k, item);
  }
  return url;
}

/** JSON を GET する。429 のときは少し待って3回までやり直す */
export async function getJson(url, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 && attempt < 3) {
      const reset = Number(res.headers.get('ratelimit-reset')) * 1000;
      await sleep(Math.min(30_000, Math.max(1000, reset - Date.now())));
      continue;
    }
    // URL にはAPIキーが入ることがあるので、エラーにはパスまでしか出さない
    if (!res.ok) throw new Error(`${url.origin}${url.pathname}: ${res.status} ${await res.text()}`);
    return res.json();
  }
}

/** client_credentials でアプリ用トークンを取る（Twitch と Kick で共通） */
export async function getAppToken(tokenUrl, clientId, clientSecret) {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`${tokenUrl}: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}
