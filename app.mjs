import {
  localDayStart, localHour, localDateString, parseLocalDate, normalizeHistory,
  formatDate, formatClock, formatDuration, streamEnd,
} from './lib/core.mjs';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 92;
const MAX_AXIS_LABELS = 10;
const RELOAD_MS = 5 * 60_000;
const DETAIL_HINT = 'バーを選ぶと、その配信の詳細がここに出ます。';

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let channels = [];
// 表示範囲: start（現地日の 0:00）から days 日ぶん
const view = { start: 0, days: DEFAULT_DAYS };

const viewEnd = () => view.start + view.days * DAY;
const todayEnd = () => localDayStart(Date.now()) + DAY;

/** 終わりの日を固定して範囲を決める。未来にはみ出す分は今日までに詰める */
function setView(end, days) {
  view.days = Math.min(MAX_DAYS, Math.max(1, days));
  view.start = Math.min(end, todayEnd()) - view.days * DAY;
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  const from = parseLocalDate(params.get('from'));
  const to = parseLocalDate(params.get('to'));
  if (from <= to) setView(to + DAY, (to - from) / DAY + 1);
  else setView(todayEnd(), DEFAULT_DAYS);
}

function writeUrl() {
  const params = new URLSearchParams({ from: localDateString(view.start), to: localDateString(viewEnd() - DAY) });
  history.replaceState(null, '', `?${params}`);
}

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
  if (!channels.length) return renderMessage('まだ記録がありません。');
  const now = Date.now();

  const liveNames = channels.filter((c) => liveStream(c.streams)).map((c) => channelName(c.channel));
  $('#status').replaceChildren(
    ...(liveNames.length
      ? [el('span', { className: 'dot', ariaHidden: 'true' }), el('strong', { textContent: '配信中' }), `　${liveNames.join('、')}`]
      : ['いま配信している人はいません。']),
  );

  const lastDay = viewEnd() - DAY;
  $('#board-title').textContent =
    view.days === 1 ? formatDate(view.start) : `${formatDate(view.start)}〜${formatDate(lastDay)}`;
  $('#from').value = localDateString(view.start);
  $('#to').value = localDateString(lastDay);
  $('#to').max = $('#from').max = localDateString(now);
  $('#next').disabled = viewEnd() >= todayEnd();
  document.querySelectorAll('.range button').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.days) === view.days)));

  renderBoard(now);
}

/** 目盛りの位置（ミリ秒）と間隔。3日までは時間単位、それより長ければ日単位 */
function axisTicks() {
  const step = view.days === 1 ? 3 * HOUR : view.days <= 3 ? 6 * HOUR : Math.ceil(view.days / MAX_AXIS_LABELS) * DAY;
  const ticks = [];
  for (let t = view.start; t < viewEnd(); t += step) ticks.push(t);
  return { ticks, step };
}

function renderBoard(now) {
  const from = view.start;
  const to = viewEnd();
  const span = to - from;
  const pos = (ms) => `${((ms - from) / span) * 100}%`;
  const { ticks, step } = axisTicks();

  const axis = el('div', { className: 'track axis' }, ticks.map((t) =>
    el('span', {
      className: localHour(t) === 0 ? 'day' : '',
      textContent: step < DAY && localHour(t) !== 0 ? `${localHour(t)}時` : formatDate(t),
      style: `left:${pos(t)}`,
    })));
  const rows = [el('div', { className: 'row head' }, [el('span', { className: 'who' }), axis, el('span', { className: 'total', textContent: '合計' })])];

  for (const { channel, streams } of channels) {
    const name = channelName(channel);
    const track = el('div', { className: 'track' });
    let totalMs = 0;
    for (const s of streams) {
      const start = Date.parse(s.start);
      const end = streamEnd(s, now);
      const a = Math.max(from, start);
      const b = Math.min(to, end);
      if (b <= a) continue;
      totalMs += b - a;
      const label =
        `${formatDate(start)} ${formatClock(start)}〜${s.live ? '配信中' : formatClock(end)}` +
        `（${formatDuration(end - start)}）${s.title ? `\n${s.title}` : ''}${s.game ? `\n${s.game}` : ''}`;
      const seg = el('button', {
        type: 'button',
        className: `seg${s.live ? ' live' : ''}`,
        title: label,
        ariaLabel: `${name} ${label}`,
        style: `left:${pos(a)};width:${((b - a) / span) * 100}%`,
      });
      seg.addEventListener('click', () => showDetail(name, label));
      track.append(seg);
    }
    if (now >= from && now < to) track.append(el('span', { className: 'now', ariaHidden: 'true', style: `left:${pos(now)}` }));

    // サンプルデータのチャンネルは実在しないのでリンクにしない
    const who = channel.login.startsWith('sample')
      ? el('span', { className: 'who' })
      : el('a', { className: 'who', href: `https://www.twitch.tv/${channel.login}`, rel: 'noopener' });
    if (liveStream(streams)) who.classList.add('live');
    if (channel.profile_image_url) {
      who.append(el('img', { src: channel.profile_image_url, alt: '', width: 24, height: 24 }));
    }
    who.append(el('span', { textContent: name }));

    rows.push(el('div', { className: 'row' }, [
      who,
      track,
      el('span', { className: 'total', textContent: totalMs ? formatDuration(totalMs) : '—' }),
    ]));
  }

  const board = $('#board');
  board.style.setProperty('--step', step / span);
  board.replaceChildren(...rows);
  $('#detail').textContent = DETAIL_HINT;
}

function showDetail(name, label) {
  $('#detail').replaceChildren(el('strong', { textContent: name }), `　${label.replaceAll('\n', ' / ')}`);
}

function update() {
  writeUrl();
  render();
}

$('#prev').addEventListener('click', () => { setView(viewEnd() - view.days * DAY, view.days); update(); });
$('#next').addEventListener('click', () => { setView(viewEnd() + view.days * DAY, view.days); update(); });
$('#today').addEventListener('click', () => { setView(todayEnd(), view.days); update(); });
document.querySelectorAll('.range button').forEach((btn) => {
  btn.addEventListener('click', () => { setView(viewEnd(), Number(btn.dataset.days)); update(); });
});
for (const input of [$('#from'), $('#to')]) {
  input.addEventListener('change', () => {
    const from = parseLocalDate($('#from').value);
    const to = parseLocalDate($('#to').value);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    // 開始と終了が逆転したら、いま触ったほうに合わせて1日表示にする
    if (from > to) setView((input.id === 'from' ? from : to) + DAY, 1);
    else setView(to + DAY, (to - from) / DAY + 1);
    update();
  });
}

readUrl();
load();
setInterval(load, RELOAD_MS);
