import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDuration, mergeHistory, normalizeHistory, fromTwitch, fromYouTube, fromKick, fromManual, splitByLocalDay, weeklyHeatmap,
  localDateString, parseLocalDate, localDayStart,
} from '../lib/core.mjs';

test('parseDuration', () => {
  assert.equal(parseDuration('3h8m33s'), (3 * 3600 + 8 * 60 + 33) * 1000);
  assert.equal(parseDuration('45m'), 45 * 60 * 1000);
  assert.equal(parseDuration('12s'), 12000);
  assert.equal(parseDuration(''), 0);
});

test('ライブ中はポーリング記録、終了後は VOD で補正', () => {
  const live = { id: 's1', started_at: '2026-09-18T12:00:00Z', title: 'A', game_name: 'G' };
  let h = mergeHistory([], { ...fromTwitch([], live), now: new Date('2026-09-18T13:00:00Z') });
  assert.equal(h[0].live, true);
  assert.equal(h[0].end_source, 'poll');

  // 次のポーリングで配信終了（VOD はまだ無い）→ 最終確認時刻で閉じる
  h = mergeHistory(h, { now: new Date('2026-09-18T15:10:00Z') });
  assert.equal(h[0].live, false);
  assert.equal(h[0].end, '2026-09-18T13:00:00.000Z');

  // VOD が見つかったら正確な終了時刻に
  const videos = [{ stream_id: 's1', created_at: '2026-09-18T12:00:05Z', duration: '2h30m0s', title: 'A' }];
  h = mergeHistory(h, fromTwitch(videos, null));
  assert.equal(h[0].end_source, 'vod');
  assert.equal(h[0].end, '2026-09-18T14:30:05.000Z');
  assert.equal(h[0].game, 'G');
});

test('同じ入力を再マージしても結果が変わらない（無駄コミット防止）', () => {
  const videos = [{ stream_id: 's2', created_at: '2026-09-10T11:00:00Z', duration: '1h0m0s', title: 'B' }];
  const a = mergeHistory([], fromTwitch(videos, null));
  const b = mergeHistory(a, fromTwitch(videos, null));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('日付またぎを JST で分割', () => {
  // JST 9/18 23:00 〜 9/19 01:30
  const s = { start: '2026-09-18T14:00:00Z', end: '2026-09-18T16:30:00Z', live: false };
  const parts = splitByLocalDay(s, Date.now());
  assert.equal(parts.length, 2);
  assert.equal(parts[0].to - parts[0].from, 3600_000);
  assert.equal(parts[1].to - parts[1].from, 90 * 60_000);
});

test('ヒートマップ: 1週間で金曜21時台を丸ごと配信 → そのマスが 1', () => {
  const from = Date.parse('2026-09-13T15:00:00Z'); // JST 9/14(月) 0:00
  const to = from + 7 * 24 * 3600_000;
  const s = { start: '2026-09-18T12:00:00Z', end: '2026-09-18T13:00:00Z', live: false }; // JST 金 21:00-22:00
  const v = weeklyHeatmap([s], from, to);
  assert.equal(v[4 * 24 + 21], 1);
  assert.equal(v.reduce((a, b) => a + b), 1);
});

test('normalizeHistory: Twitch だけだった頃の形式も sources にそろえる', () => {
  const channel = { id: '1', login: 'a', display_name: 'A', profile_image_url: 'i.png' };
  const expected = {
    channels: [{
      name: 'A',
      icon: 'i.png',
      sources: [{ platform: 'twitch', key: 'a', channel: { ...channel, url: 'https://www.twitch.tv/a' }, streams: [] }],
    }],
  };
  assert.deepEqual(normalizeHistory({ channel, streams: [] }), expected);
  assert.deepEqual(normalizeHistory({ channels: [{ channel, streams: [] }] }), expected);
  assert.deepEqual(normalizeHistory(null), { channels: [] });
  assert.deepEqual(normalizeHistory(expected), expected);
});

test('fromYouTube: 終わったライブと配信中だけ拾い、予約枠と普通の動画は無視', () => {
  const r = fromYouTube([
    { id: 'done', snippet: { title: 'D', liveBroadcastContent: 'none' }, liveStreamingDetails: { actualStartTime: '2026-09-18T12:00:00Z', actualEndTime: '2026-09-18T14:00:00Z' } },
    { id: 'now', snippet: { title: 'N', liveBroadcastContent: 'live' }, liveStreamingDetails: { actualStartTime: '2026-09-19T12:00:00Z' } },
    { id: 'soon', snippet: { title: 'S', liveBroadcastContent: 'upcoming' }, liveStreamingDetails: { scheduledStartTime: '2026-09-21T12:00:00Z' } },
    { id: 'video', snippet: { title: 'V', liveBroadcastContent: 'none' } },
  ]);
  assert.deepEqual(r.finished.map((f) => f.stream_id), ['done']);
  assert.equal(r.live.stream_id, 'now');
  const h = mergeHistory([], r);
  assert.equal(h[0].end, '2026-09-18T14:00:00.000Z');
  assert.equal(h[1].live, true);
});

test('fromKick: 配信 ID の代わりに開始時刻で同じ配信を見分ける', () => {
  const ch = { slug: 'k', stream_title: 'T', category: { name: 'G' }, stream: { is_live: true, start_time: '2026-09-18T12:00:00Z' } };
  let h = mergeHistory([], { ...fromKick(ch), now: new Date('2026-09-18T12:10:00Z') });
  h = mergeHistory(h, { ...fromKick(ch), now: new Date('2026-09-18T12:20:00Z') });
  assert.equal(h.length, 1);
  assert.equal(h[0].game, 'G');
  h = mergeHistory(h, fromKick({ ...ch, stream: { is_live: false } }));
  assert.equal(h[0].live, false);
  assert.equal(h[0].end, '2026-09-18T12:20:00.000Z');
});

test('日付文字列と JST の 0:00 を相互変換', () => {
  const day = parseLocalDate('2026-09-20');
  assert.equal(day, Date.parse('2026-09-19T15:00:00Z'));
  assert.equal(localDateString(day), '2026-09-20');
  assert.equal(localDateString(day + 23.5 * 3600_000), '2026-09-20');
  assert.equal(localDayStart(day + 3600_000), day);
  assert.ok(Number.isNaN(parseLocalDate('9/20')));
});

test('fromManual: 日本時間で書いた配信を記録に足す', () => {
  const f = fromManual({ start: '2026-09-01 21:00', end: '2026-09-02 1:30', title: 'M' });
  const h = mergeHistory([], { finished: [f] });
  assert.equal(h[0].start, '2026-09-01T12:00:00.000Z');
  assert.equal(h[0].end, '2026-09-01T16:30:00.000Z');
  assert.equal(h[0].end_source, 'manual');
  assert.throws(() => fromManual({ start: '2026-09-02 21:00', end: '2026-09-02 20:00' }));
  assert.throws(() => fromManual({ start: '9/2 21:00', end: '9/2 23:00' }));
});

test('配信のページとサムネイルを記録し、アーカイブができたら差し替える', () => {
  const live = { id: 's1', user_login: 'a', started_at: '2026-09-18T12:00:00Z', title: 'A', thumbnail_url: 'https://t/live-{width}x{height}.jpg' };
  let h = mergeHistory([], fromTwitch([], live));
  assert.equal(h[0].url, 'https://www.twitch.tv/a');
  assert.equal(h[0].thumb, 'https://t/live-320x180.jpg');
  const videos = [{ stream_id: 's1', created_at: '2026-09-18T12:00:00Z', duration: '1h0m0s', title: 'A', url: 'https://www.twitch.tv/videos/1', thumbnail_url: 'https://t/vod-%{width}x%{height}.jpg' }];
  h = mergeHistory(h, fromTwitch(videos, null));
  assert.equal(h[0].url, 'https://www.twitch.tv/videos/1');
  assert.equal(h[0].thumb, 'https://t/vod-320x180.jpg');
  // アーカイブが消えたあとも残る
  h = mergeHistory(h, fromTwitch([], null));
  assert.equal(h[0].thumb, 'https://t/vod-320x180.jpg');
});
