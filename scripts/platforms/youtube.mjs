import { fromYouTube } from '../../lib/core.mjs';
import { buildUrl, getJson } from './http.mjs';

export const requiredEnv = ['YOUTUBE_API_KEY'];

const API = 'https://www.googleapis.com/youtube/v3';

/**
 * keys: チャンネル ID（UC…）か @ハンドル の配列 → Map(key → { channel, finished, live })
 * search.list は1回100ユニットかかるので使わず、アップロード一覧 → videos.list で
 * 1チャンネルあたり3ユニットに抑える（10分おき×8チャンネルでも1日の上限1万に収まる）。
 * 見つからないチャンネルは結果に入れず、report で知らせる。ハンドルが変わっていても、
 * knownIds（key → 前回までに分かっているチャンネル ID）があれば ID で探し直す
 */
export async function fetchAll(keys, env, { knownIds = new Map(), report = () => {} } = {}) {
  const api = (path, params) => getJson(buildUrl(`${API}/${path}`, { ...params, key: env.YOUTUBE_API_KEY }));
  const lookup = async (params) => (await api('channels', { part: 'snippet,contentDetails', ...params })).items?.[0];

  const out = new Map();
  for (const key of keys) {
    let ch = await lookup(key.startsWith('@') ? { forHandle: key } : { id: key });
    if (!ch && knownIds.get(key)) {
      ch = await lookup({ id: knownIds.get(key) });
      if (ch) report(`YouTube の ${key} はハンドルが変わっています（今は ${ch.snippet.customUrl ?? ch.id}）。channels.json を直してください（記録は続けています）`);
    }
    if (!ch) {
      report(`YouTube の ${key} が見つかりません（ハンドルの変更・停止・書き間違いのどれか）。このチャンネルは飛ばして続けます`);
      continue;
    }

    // ライブのアーカイブも配信中の枠も、アップロード一覧の新しい側に入る
    const { items: uploads = [] } = await api('playlistItems', {
      part: 'contentDetails',
      playlistId: ch.contentDetails.relatedPlaylists.uploads,
      maxResults: 50,
    });
    const ids = uploads.map((u) => u.contentDetails.videoId);
    const { items: videos = [] } = ids.length
      ? await api('videos', { part: 'snippet,liveStreamingDetails', id: ids.join(','), maxResults: 50 })
      : {};

    out.set(key, {
      channel: {
        id: ch.id,
        login: ch.snippet.customUrl ?? ch.id,
        display_name: ch.snippet.title,
        profile_image_url: ch.snippet.thumbnails?.default?.url ?? '',
        url: `https://www.youtube.com/channel/${ch.id}`,
      },
      ...fromYouTube(videos),
    });
  }
  return out;
}
