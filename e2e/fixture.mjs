// 画面のテスト用の決まったデータと時刻。本物の history.json の代わりに差し込む。
const HOUR = 3600_000;

/** テストの中の「今」: 2026-09-21（月）20:00 JST */
export const NOW = Date.parse('2026-09-21T11:00:00Z');

const iso = (ms) => new Date(ms).toISOString();
const stream = (id, startHoursAgo, hours, extra = {}) => ({
  stream_id: id,
  start: iso(NOW - startHoursAgo * HOUR),
  end: iso(NOW - (startHoursAgo - hours) * HOUR),
  end_source: 'vod',
  live: false,
  title: `配信 ${id}`,
  game: 'Just Chatting',
  url: `https://example.com/${id}`,
  thumb: null,
  ...extra,
});
const source = (platform, login, streams) => ({
  platform,
  key: login,
  channel: { id: login, login, display_name: login, profile_image_url: '', url: `https://example.com/${platform}/${login}` },
  streams,
});

export const HISTORY = {
  recordFrom: '2026-09-16',
  channels: [
    {
      // 長い名前 + 配信中 + Twitch と YouTube の同時配信
      name: 'とても長い名前の配信者さんです',
      icon: '',
      sources: [
        source('twitch', 'long', [stream('a1', 50, 4), stream('a2', 3, 3, { live: true, end_source: 'poll' })]),
        source('youtube', 'long-yt', [stream('a3', 49, 2)]),
      ],
    },
    { name: '三つ持ち', icon: '', sources: [source('twitch', 'tri', [stream('b1', 30, 5)]), source('youtube', 'tri-yt', []), source('kick', 'tri-k', [stream('b2', 100, 2)])] },
    { name: '記録なし', icon: '', sources: [source('twitch', 'none', [])] },
    ...['D', 'E', 'F', 'G', 'H'].map((n, i) => ({
      name: `配信者${n}`,
      icon: '',
      sources: [source('twitch', `ch${n}`, [stream(`${n}1`, 20 + i * 7, 3), stream(`${n}2`, 70 + i * 5, 6)])],
    })),
  ],
};

/** 時刻を固定し、データを差し込んでからページを開く */
export async function openBoard(page, { width, height, search = '' }) {
  await page.setViewportSize({ width, height });
  await page.clock.install({ time: NOW });
  await page.route('**/data/history.json', (route) => route.fulfill({ json: HISTORY }));
  await page.goto(`/index.html${search}`);
  await page.locator('.row.person').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}
