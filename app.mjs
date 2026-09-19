import {
  weeklyHeatmap, summarize, splitByLocalDay, localDayStart, localWeekday, normalizeHistory,
  formatDate, formatClock, formatDuration, weekdayLabel, streamEnd,
} from './lib/core.mjs';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const TIMELINE_DAYS = 28;

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let channels = [];
let weeks = 8;
// 集計期間を切り替えたときに描き直すヒートマップ: { streams, summary, heat }
let heatViews = [];

async function load() {
  try {
    const res = await fetch('./data/history.json', { cache: 'no-store' });
    if (res.status === 404) return renderMessage('まだ記録がありません。GitHub Actions の collect を一度実行すると、ここに表示されます。');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    channels = normalizeHistory(await res.json()).channels;
    render();
  } catch (e) {
    renderMessage(`記録を読み込めませんでした（${e.message}）。data/history.json があるか確認してください。`);
  }
}

function renderMessage(text) {
  $('#status').textContent = text;
}

const channelName = (c) => c.display_name || c.login;
const liveStream = (streams) => streams.find((s) => s.live);

function render() {
  const now = Date.now();
  if (!channels.length) return renderMessage('まだ記録がありません。');

  const liveNames = channels.filter((c) => liveStream(c.streams)).map((c) => channelName(c.channel));
  $('#status').replaceChildren(
    ...(liveNames.length
      ? [el('span', { className: 'dot', ariaHidden: 'true' }), el('strong', { textContent: '配信中' }), `　${liveNames.join('、')}`]
      : ['いま配信している人はいません。']),
  );

  $('#nav').replaceChildren(
    ...channels.map(({ channel, streams }) =>
      el('a', { href: `#ch-${channel.login}`, className: liveStream(streams) ? 'live' : '', textContent: channelName(channel) })),
  );

  heatViews = [];
  $('#channels').replaceChildren(...channels.map((c) => renderChannel(c, now)));
}

function renderChannel({ channel, streams }, now) {
  const name = channelName(channel);
  // サンプルデータのチャンネルは実在しないのでリンクにしない
  const title = channel.login.startsWith('sample')
    ? name
    : el('a', { href: `https://www.twitch.tv/${channel.login}`, textContent: name, rel: 'noopener' });
  const head = el('div', { className: 'ch-head' }, [
    ...(channel.profile_image_url
      ? [el('img', { className: 'avatar', src: channel.profile_image_url, alt: '', width: 40, height: 40, loading: 'lazy' })]
      : []),
    el('h2', {}, [title]),
    channelStatus(streams, now),
  ]);
  const section = el('section', { className: 'channel', id: `ch-${channel.login}` }, [head]);
  if (!streams.length) return section;

  const view = { streams, summary: el('p', { className: 'summary' }), heat: el('div', { className: 'heat', role: 'img' }) };
  view.heat.ariaLabel = `${name}の曜日と時間帯ごとの配信の多さ`;
  heatViews.push(view);
  renderHeat(view, now);

  section.append(el('div', { className: 'pair' }, [
    el('div', {}, [
      el('h3', { textContent: 'よく配信している時間帯' }),
      el('div', { className: 'scroll' }, [view.heat]),
      view.summary,
    ]),
    el('div', {}, [
      el('h3', { textContent: '直近4週間の配信' }),
      el('div', { className: 'scroll' }, [renderTimeline(streams, now)]),
    ]),
  ]));
  return section;
}

function channelStatus(streams, now) {
  const status = el('p', { className: 'status' });
  const live = liveStream(streams);
  if (live) {
    const start = Date.parse(live.start);
    status.append(
      el('span', { className: 'dot', ariaHidden: 'true' }),
      el('strong', { textContent: '配信中' }),
      `　${formatClock(start)}から${live.title ? `「${live.title}」` : ''}`,
    );
  } else if (streams.length) {
    const last = streams.at(-1);
    const start = Date.parse(last.start);
    status.textContent =
      `最後の配信は ${formatDate(start)} ${formatClock(start)}〜${formatClock(streamEnd(last, now))}` +
      (last.title ? `「${last.title}」` : '');
  } else {
    status.textContent = 'まだ配信の記録がありません。';
  }
  return status;
}

function renderHeat({ streams, summary, heat }, now) {
  const firstRecord = localDayStart(Date.parse(streams[0].start));
  const requested = weeks === 'all' ? firstRecord : now - weeks * WEEK;
  const from = Math.max(requested, firstRecord);
  const values = weeklyHeatmap(streams, from, now, now);
  const s = summarize(streams, from, now, now);

  const period = weeks === 'all' ? '全期間' : `直近${weeks}週`;
  const since = requested < firstRecord ? `（記録は${formatDate(firstRecord)}から）` : '';
  summary.textContent = s.count
    ? `${period}${since}で${s.count}回、合計${formatDuration(s.totalMs)}。` +
      `1回あたり平均${formatDuration(s.avgMs)}で、開始は${s.peakStartHour}時台がいちばん多い。`
    : `${period}${since}には配信がありません。`;

  const cells = [el('span')];
  for (let h = 0; h < 24; h++) cells.push(el('span', { className: 'hour', textContent: h % 3 === 0 ? h : '' }));
  for (let wd = 0; wd < 7; wd++) {
    cells.push(el('span', { className: 'wd', textContent: weekdayLabel(wd) }));
    for (let h = 0; h < 24; h++) {
      const v = values[wd * 24 + h];
      const cell = el('span', { className: 'cell', title: `${weekdayLabel(wd)}曜 ${h}時台：${Math.round(v * 100)}%` });
      cell.style.setProperty('--v', v.toFixed(3));
      cells.push(cell);
    }
  }
  heat.replaceChildren(...cells);
}

function renderTimeline(streams, now) {
  const today = localDayStart(now);
  const oldest = today - (TIMELINE_DAYS - 1) * DAY;
  const byDay = new Map();
  for (const s of streams) {
    if (streamEnd(s, now) < oldest) continue;
    for (const part of splitByLocalDay(s, now)) {
      if (!byDay.has(part.dayStart)) byDay.set(part.dayStart, []);
      byDay.get(part.dayStart).push(part);
    }
  }

  const axis = el('div', { className: 'track' },
    [0, 6, 12, 18, 24].map((h) => el('span', { textContent: `${h}時`, style: `left:${(h / 24) * 100}%` })));
  const rows = [el('div', { className: 'tl-row tl-axis' }, [el('span'), axis])];

  for (let i = 0; i < TIMELINE_DAYS; i++) {
    const day = today - i * DAY;
    const wd = localWeekday(day);
    const track = el('div', { className: 'track' });
    for (const p of byDay.get(day) ?? []) {
      const s = p.stream;
      const start = Date.parse(s.start);
      const label =
        `${formatDate(start)} ${formatClock(start)}〜${formatClock(streamEnd(s, now))}` +
        `（${formatDuration(streamEnd(s, now) - start)}）${s.title ? `\n${s.title}` : ''}${s.game ? `\n${s.game}` : ''}`;
      track.append(el('span', {
        className: `seg${s.live ? ' live' : ''}`,
        title: label,
        tabIndex: 0,
        ariaLabel: label,
        style: `left:${((p.from - day) / DAY) * 100}%;width:${((p.to - p.from) / DAY) * 100}%`,
      }));
    }
    const cls = ['tl-row'];
    if (wd >= 5) cls.push('weekend');
    if (wd === 6 && i > 0) cls.push('week-start');
    rows.push(el('div', { className: cls.join(' ') }, [
      el('span', { className: 'tl-date', textContent: formatDate(day) }),
      track,
    ]));
  }
  return el('div', { className: 'timeline' }, rows);
}

document.querySelectorAll('.range button').forEach((btn) => {
  btn.addEventListener('click', () => {
    weeks = btn.dataset.weeks === 'all' ? 'all' : Number(btn.dataset.weeks);
    document.querySelectorAll('.range button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    const now = Date.now();
    for (const view of heatViews) renderHeat(view, now);
  });
});

load();
