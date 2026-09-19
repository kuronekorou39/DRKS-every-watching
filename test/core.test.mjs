import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, mergeHistory, normalizeHistory, splitByLocalDay, weeklyHeatmap } from '../lib/core.mjs';

test('parseDuration', () => {
  assert.equal(parseDuration('3h8m33s'), (3 * 3600 + 8 * 60 + 33) * 1000);
  assert.equal(parseDuration('45m'), 45 * 60 * 1000);
  assert.equal(parseDuration('12s'), 12000);
  assert.equal(parseDuration(''), 0);
});

test('ライブ中はポーリング記録、終了後は VOD で補正', () => {
  const live = { id: 's1', started_at: '2026-09-18T12:00:00Z', title: 'A', game_name: 'G' };
  let h = mergeHistory([], { live, now: new Date('2026-09-18T13:00:00Z') });
  assert.equal(h[0].live, true);
  assert.equal(h[0].end_source, 'poll');

  // 次のポーリングで配信終了（VOD はまだ無い）→ 最終確認時刻で閉じる
  h = mergeHistory(h, { now: new Date('2026-09-18T15:10:00Z') });
  assert.equal(h[0].live, false);
  assert.equal(h[0].end, '2026-09-18T13:00:00.000Z');

  // VOD が見つかったら正確な終了時刻に
  const videos = [{ stream_id: 's1', created_at: '2026-09-18T12:00:05Z', duration: '2h30m0s', title: 'A' }];
  h = mergeHistory(h, { videos });
  assert.equal(h[0].end_source, 'vod');
  assert.equal(h[0].end, '2026-09-18T14:30:05.000Z');
  assert.equal(h[0].game, 'G');
});

test('同じ入力を再マージしても結果が変わらない（無駄コミット防止）', () => {
  const videos = [{ stream_id: 's2', created_at: '2026-09-10T11:00:00Z', duration: '1h0m0s', title: 'B' }];
  const a = mergeHistory([], { videos });
  const b = mergeHistory(a, { videos });
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

test('normalizeHistory: 1チャンネル時代の形式も channels にそろえる', () => {
  const channel = { id: '1', login: 'a' };
  assert.deepEqual(normalizeHistory({ channel, streams: [] }), { channels: [{ channel, streams: [] }] });
  assert.deepEqual(normalizeHistory(null), { channels: [] });
  const multi = { channels: [{ channel, streams: [] }] };
  assert.equal(normalizeHistory(multi), multi);
});
