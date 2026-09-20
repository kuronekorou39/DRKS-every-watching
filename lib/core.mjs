// 取得スクリプト（Node）とブラウザの両方から import する共通ロジック。
// Node 固有の API は使わないこと。

export const TZ_OFFSET_MIN = 9 * 60; // JST（夏時間なし）
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];

/** "3h8m33s" → ミリ秒 */
export function parseDuration(str) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(str ?? '');
  if (!str || !m) return 0;
  return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
}

/**
 * これまでの履歴に、今回取得した結果をマージして返す（引数は変更しない）。
 * 各プラットフォームの取得結果は、あらかじめ次の形にそろえて渡す:
 *   finished: 終わった配信 [{ stream_id, start, end, title, game, url, thumb }]（アーカイブ等から正確な時刻が取れたもの）
 *   live:     配信中なら { stream_id, start, title, game, url, thumb }、いなければ null
 *   url は配信（アーカイブ）のページ、thumb はサムネイル画像。どちらも無ければ省いてよい
 * - finished にある配信は開始・終了を確定（end_source: "vod"。手で足したものは "manual"）
 * - ライブ中の配信は start と「今」で記録（end_source: "poll"）
 * - 前回ライブ中で今回いない配信は、最後に確認した時刻を終了として閉じる
 */
export function mergeHistory(streams, { finished = [], live = null, now = new Date() }) {
  const byId = new Map(streams.map((s) => [s.stream_id, { ...s }]));
  const liveId = live?.stream_id ?? null;

  for (const s of byId.values()) {
    if (s.live && s.stream_id !== liveId) s.live = false;
  }

  for (const f of finished) {
    // ライブ中の配信のアーカイブは長さが伸び続けるので、終わるまで使わない
    if (!f.stream_id || f.stream_id === liveId) continue;
    const cur = byId.get(f.stream_id);
    byId.set(f.stream_id, {
      stream_id: f.stream_id,
      start: new Date(f.start).toISOString(),
      end: new Date(f.end).toISOString(),
      end_source: f.end_source ?? 'vod',
      live: false,
      title: cur?.title ?? f.title ?? '',
      game: cur?.game ?? f.game ?? null,
      // アーカイブができたら、そのページとサムネイルに差し替える
      url: f.url ?? cur?.url ?? null,
      thumb: f.thumb ?? cur?.thumb ?? null,
    });
  }

  if (live) {
    const cur = byId.get(live.stream_id);
    byId.set(live.stream_id, {
      stream_id: live.stream_id,
      start: new Date(live.start).toISOString(),
      end: now.toISOString(),
      end_source: 'poll',
      live: true,
      title: live.title ?? cur?.title ?? '',
      game: live.game || cur?.game || null,
      url: live.url ?? cur?.url ?? null,
      thumb: live.thumb ?? cur?.thumb ?? null,
    });
  }

  return [...byId.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

// Twitch のサムネイル URL は大きさが穴あきになっている（アーカイブは %{width}、ライブは {width}）
const THUMB_SIZE = { width: 320, height: 180 };
const twitchThumb = (url) =>
  url ? url.replace(/%?\{(width|height)\}/g, (_, key) => THUMB_SIZE[key]) : null;

/** Twitch の /videos（archive）と /streams の結果を mergeHistory に渡す形にそろえる */
export function fromTwitch(videos, live) {
  const finished = [];
  for (const v of videos) {
    const dur = parseDuration(v.duration);
    if (!v.stream_id || !dur) continue;
    const start = Date.parse(v.created_at);
    finished.push({ stream_id: v.stream_id, start, end: start + dur, title: v.title, url: v.url, thumb: twitchThumb(v.thumbnail_url) });
  }
  return {
    finished,
    live: live
      ? {
          stream_id: live.id,
          start: live.started_at,
          title: live.title,
          game: live.game_name,
          url: live.user_login ? `https://www.twitch.tv/${live.user_login}` : null,
          thumb: twitchThumb(live.thumbnail_url),
        }
      : null,
  };
}

/** YouTube の videos.list（snippet, liveStreamingDetails）の結果を mergeHistory に渡す形にそろえる */
export function fromYouTube(videos) {
  const finished = [];
  let live = null;
  for (const v of videos) {
    const d = v.liveStreamingDetails;
    // 予約枠（まだ始まっていない）と、ライブではない普通の動画は対象外
    if (!d?.actualStartTime) continue;
    const item = {
      stream_id: v.id,
      start: d.actualStartTime,
      title: v.snippet?.title,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      thumb: v.snippet?.thumbnails?.medium?.url ?? null,
    };
    if (d.actualEndTime) finished.push({ ...item, end: d.actualEndTime });
    else if (v.snippet?.liveBroadcastContent === 'live') live ??= item;
  }
  return { finished, live };
}

/** Kick の /channels の1件を mergeHistory に渡す形にそろえる。過去の配信は API から取れない */
export function fromKick(channel) {
  const s = channel.stream;
  if (!s?.is_live) return { finished: [], live: null };
  // 配信 ID が返らないので、開始時刻を ID 代わりにする
  return {
    finished: [],
    live: {
      stream_id: `kick-${new Date(s.start_time).toISOString()}`,
      start: s.start_time,
      title: channel.stream_title,
      game: channel.category?.name,
      url: `https://kick.com/${channel.slug}`,
      thumb: s.thumbnail || null,
    },
  };
}

/** "YYYY-MM-DD HH:MM"（日本時間）→ UTC ミリ秒。形式が違えば NaN */
export function parseLocalDateTime(str) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/.exec(str ?? '');
  return m ? Date.parse(`${m[1]}T${m[2].padStart(2, '0')}:${m[3]}:00Z`) - TZ_OFFSET_MIN * MIN : NaN;
}

/** manual.json の1件を mergeHistory の finished に渡す形にそろえる。時刻がおかしければ例外 */
export function fromManual(entry) {
  const start = parseLocalDateTime(entry.start);
  const end = parseLocalDateTime(entry.end);
  if (!(start < end)) throw new Error(`manual.json の時刻が正しくありません: ${entry.start} 〜 ${entry.end}`);
  return {
    stream_id: `manual-${new Date(start).toISOString()}`,
    start,
    end,
    end_source: 'manual',
    title: entry.title ?? '',
    game: entry.game ?? null,
  };
}

export const PLATFORMS = {
  twitch: { label: 'Twitch', mark: 'T' },
  youtube: { label: 'YouTube', mark: 'Y' },
  kick: { label: 'Kick', mark: 'K' },
};

/**
 * history.json を { recordFrom, channels: [{ name, icon, sources: [{ platform, key, channel, streams }] }] } の形にそろえる。
 * recordFrom は記録を残しはじめる日（"YYYY-MM-DD"。決めていなければ null）。
 * Twitch だけだった頃の形式（1チャンネル / channel と streams の組の配列）も読む。
 */
export function normalizeHistory(history) {
  const legacy = history?.channels ?? (history?.channel ? [history] : []);
  return {
    recordFrom: history?.recordFrom ?? null,
    channels: legacy.map((c) =>
      c.sources
        ? c
        : {
            name: c.channel.display_name || c.channel.login,
            icon: c.channel.profile_image_url ?? '',
            sources: [{
              platform: 'twitch',
              key: c.channel.login,
              channel: { ...c.channel, url: `https://www.twitch.tv/${c.channel.login}` },
              streams: c.streams ?? [],
            }],
          }),
  };
}

// ---- 表示用 ----

const shift = (ms) => ms + TZ_OFFSET_MIN * MIN;

/** その時刻を含む現地日の 0:00（UTC ミリ秒） */
export function localDayStart(ms) {
  const t = shift(ms);
  return t - (((t % DAY) + DAY) % DAY) - TZ_OFFSET_MIN * MIN;
}
/** 月=0 … 日=6 */
export const localWeekday = (ms) => (new Date(shift(ms)).getUTCDay() + 6) % 7;
export const localHour = (ms) => new Date(shift(ms)).getUTCHours();

/** 現地の日付を "YYYY-MM-DD" で（<input type="date"> や URL 用） */
export const localDateString = (ms) => new Date(shift(ms)).toISOString().slice(0, 10);
/** "YYYY-MM-DD" → その現地日の 0:00（UTC ミリ秒）。形式が違えば NaN */
export const parseLocalDate = (str) =>
  /^\d{4}-\d{2}-\d{2}$/.test(str ?? '') ? Date.parse(`${str}T00:00:00Z`) - TZ_OFFSET_MIN * MIN : NaN;

export function formatDate(ms) {
  const d = new Date(shift(ms));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAYS[localWeekday(ms)]}）`;
}
export function formatClock(ms) {
  const d = new Date(shift(ms));
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
export function formatDuration(ms) {
  const m = Math.round(ms / MIN);
  const h = Math.floor(m / 60);
  return h ? `${h}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}
/** 狭い場所に出すための短い書き方。9時間57分 → "9:57" */
export function formatHourMinute(ms) {
  const m = Math.round(ms / MIN);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
export const weekdayLabel = (i) => WEEKDAYS[i];

/** 配信の終了時刻。ライブ中なら nowMs まで伸ばす */
export const streamEnd = (s, nowMs) => (s.live ? Math.max(nowMs, Date.parse(s.end)) : Date.parse(s.end));

/**
 * 重なったり接したりしている区間 [{ start, end, live }]（ミリ秒）を1本ずつにまとめ、開始順で返す。
 * まとめた区間は、元のどれかが配信中なら配信中とする
 */
export function mergeIntervals(intervals) {
  const out = [];
  for (const { start, end, live = false } of [...intervals].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
      last.live ||= live;
    } else {
      out.push({ start, end, live });
    }
  }
  return out;
}

/** 配信を現地の暦日ごとに分割（日付またぎ対応） */
export function splitByLocalDay(stream, nowMs) {
  const out = [];
  const end = streamEnd(stream, nowMs);
  for (let cur = Date.parse(stream.start); cur < end; ) {
    const dayStart = localDayStart(cur);
    const next = Math.min(end, dayStart + DAY);
    out.push({ dayStart, from: cur, to: next, stream });
    cur = next;
  }
  return out;
}

function addRange(arr, a, b) {
  for (let t = Math.floor(a / HOUR) * HOUR; t < b; t += HOUR) {
    const overlap = Math.min(b, t + HOUR) - Math.max(a, t);
    if (overlap > 0) arr[localWeekday(t) * 24 + localHour(t)] += overlap;
  }
}

/** 曜日×時間（7×24=168 マス）ごとに、期間中その時間帯に配信していた割合 0..1 */
export function weeklyHeatmap(streams, fromMs, toMs, nowMs = toMs) {
  const on = new Float64Array(168);
  const total = new Float64Array(168);
  addRange(total, fromMs, toMs);
  for (const s of streams) {
    const a = Math.max(fromMs, Date.parse(s.start));
    const b = Math.min(toMs, streamEnd(s, nowMs));
    if (b > a) addRange(on, a, b);
  }
  return Array.from(on, (v, i) => (total[i] ? Math.min(1, v / total[i]) : 0));
}

/** 期間内に開始した配信の集計 */
export function summarize(streams, fromMs, toMs, nowMs = toMs) {
  const inWindow = streams.filter((s) => {
    const t = Date.parse(s.start);
    return t >= fromMs && t < toMs;
  });
  const totalMs = inWindow.reduce((sum, s) => sum + streamEnd(s, nowMs) - Date.parse(s.start), 0);
  const startHours = new Array(24).fill(0);
  for (const s of inWindow) startHours[localHour(Date.parse(s.start))]++;
  const count = inWindow.length;
  return {
    count,
    totalMs,
    avgMs: count ? totalMs / count : 0,
    peakStartHour: count ? startHours.indexOf(Math.max(...startHours)) : null,
  };
}
