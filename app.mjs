import {
  TZ_OFFSET_MIN, localDayStart, localWeekday, localDateString, parseLocalDate, normalizeHistory,
  formatDate, formatClock, formatDuration, weekdayLabel, streamEnd, PLATFORMS,
} from './lib/core.mjs';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 92;
// 横軸ラベルの出し分け（1日ぶんの幅 px に応じて決める）
const FULL_DATE_PX = 84; // 「9/14（月）」が収まる
const DATE_WEEKDAY_PX = 56; // 「9/14 月」が収まる
const MIN_DAY_LABEL_PX = 36; // これより狭いと日付ラベルを間引く
const MIN_HOUR_LABEL_PX = 18; // 時刻ラベルどうしの最小間隔
const HOUR_STEPS = [1, 2, 3, 6, 12];
const NARROW_DAY_PX = 12; // これより狭いと日ごとの区切りをやめ、週ごとに色分けする
const FALLBACK_TRACK_PX = 600;
const RELOAD_MS = 5 * 60_000;

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
    channels = normalizeHistory(await res.json()).channels.filter((c) => c.sources.length);
    render();
  } catch (e) {
    renderMessage(`記録を読み込めませんでした（${e.message}）。data/history.json があるか確認してください。`);
  }
}

function renderMessage(text) {
  $('#status').textContent = text;
}

// 操作欄の日付。曜日は別の要素にして、狭い画面で期間を出すときは CSS で隠せるようにする
function dateLabel(ms) {
  const [date, weekday] = formatDate(ms).replace('）', '').split('（');
  return [date, el('span', { className: 'w', textContent: `(${weekday})` })];
}
const isLive = (source) => source.streams.some((s) => s.live);

function render() {
  if (!channels.length) return renderMessage('まだ記録がありません。');
  const now = Date.now();

  // #status は読み込み中やエラーの表示にだけ使う
  renderMessage('');

  const lastDay = viewEnd() - DAY;
  $('#board-title').textContent =
    view.days === 1 ? `${formatDate(view.start)}の配信` : `${formatDate(view.start)}〜${formatDate(lastDay)}の配信`;
  $('#from-text').replaceChildren(...dateLabel(view.start));
  $('#to-text').replaceChildren(...dateLabel(lastDay));
  $('#to-part').hidden = view.days === 1;
  $('.step').classList.toggle('single', view.days === 1);
  $('#from').value = localDateString(view.start);
  $('#to').value = localDateString(lastDay);
  $('#to').max = $('#from').max = localDateString(now);
  $('#next').disabled = viewEnd() >= todayEnd();
  document.querySelectorAll('.range button').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.days) === view.days)));
  // 用意した日数に当てはまらないときは「指定」を出す
  const days = $('#days');
  days.value = [...days.options].some((o) => Number(o.value) === view.days) ? String(view.days) : '';

  renderBoard(now);
}

function renderBoard(now) {
  const from = view.start;
  const to = viewEnd();
  const span = to - from;
  const pos = (ms) => `${((ms - from) / span) * 100}%`;
  // 横軸と日ごとの帯は幅に応じて描き分けるので、renderScale() であとから埋める
  const head = el('div', { className: 'row head' }, [
    el('span'),
    el('div', { className: 'scale' }, [el('div', { className: 'days' }), el('div', { className: 'hours' })]),
    el('span', { className: 'total', textContent: '合計' }),
  ]);
  const rows = [el('div', { className: 'row bands', ariaHidden: 'true' }, [el('span'), el('div', { className: 'track' }), el('span')])];

  for (const { name, icon, sources } of channels) {
    // 1人1行。配信先（Twitch / YouTube / Kick）は色で見分ける
    const track = el('div', { className: 'track' });
    const segs = sources.flatMap((source, lane) =>
      source.streams.map((s) => ({ s, source, lane, start: Date.parse(s.start), end: streamEnd(s, now) })))
      .filter((g) => Math.min(to, g.end) > Math.max(from, g.start));

    for (const g of segs) {
      const { s, source, start, end } = g;
      const platform = PLATFORMS[source.platform];
      const a = Math.max(from, start);
      const b = Math.min(to, end);
      // 同時配信で別の配信先と重なるところは、行を上下に分けて両方見えるようにする
      const lanes = [...new Set(segs.filter((o) => o.start < end && o.end > start).map((o) => o.lane))].sort();
      const label =
        `${formatDate(start)} ${formatClock(start)}〜${s.live ? '配信中' : formatClock(end)}` +
        `（${formatDuration(end - start)}）${s.title ? `\n${s.title}` : ''}${s.game ? `\n${s.game}` : ''}`;
      const seg = el('button', {
        type: 'button',
        className: `seg p-${source.platform}${s.live ? ' live' : ''}`,
        title: `${platform.label}\n${label}`,
        ariaLabel: `${name} ${platform.label} ${label}`,
        style:
          `left:${pos(a)};width:${((b - a) / span) * 100}%;` +
          `top:${(lanes.indexOf(g.lane) / lanes.length) * 100}%;height:${100 / lanes.length}%`,
      });
      seg.addEventListener('click', () => showDetail(`${name}（${platform.label}）`, label));
      track.append(seg);
    }
    if (now >= from && now < to) track.append(el('span', { className: 'now', ariaHidden: 'true', style: `left:${pos(now)}` }));

    // 合計は、同時配信を二重に数えないよう重なりをまとめてから足す
    let totalMs = 0;
    let coveredTo = from;
    for (const g of [...segs].sort((x, y) => x.start - y.start)) {
      const a = Math.max(coveredTo, g.start);
      const b = Math.min(to, g.end);
      if (b > a) totalMs += b - a;
      coveredTo = Math.max(coveredTo, b);
    }

    // サンプルデータのチャンネルは実在しない（url が空）のでリンクにしない
    const link = (url, props, children) => (url ? el('a', { ...props, href: url, rel: 'noopener' }, children) : el('span', props, children));
    const live = sources.some(isLive);
    const who = el('div', { className: `who${live ? ' live' : ''}` }, [
      link(sources[0].channel.url, { className: 'who-link', title: name }, [
        // 狭い画面では名前を隠してアイコンだけにするので、画像がなければ頭文字で代用する
        el('span', { className: 'avatar' }, [
          icon
            ? el('img', { src: icon, alt: '', width: 24, height: 24, referrerPolicy: 'no-referrer' })
            : el('span', { className: 'initial', ariaHidden: 'true', textContent: [...name][0] }),
        ]),
        el('span', { className: 'name', textContent: name }),
      ]),
      ...(live ? [el('span', { className: 'live-chip', textContent: 'LIVE' })] : []),
      el('span', { className: 'plats' }, sources.map((source) =>
        link(source.channel.url, {
          className: `plat p-${source.platform}${isLive(source) ? ' live' : ''}`,
          title: PLATFORMS[source.platform].label,
          ariaLabel: `${name}の${PLATFORMS[source.platform].label}`,
          textContent: PLATFORMS[source.platform].mark,
        }))),
    ]);

    rows.push(el('div', { className: 'row person' }, [
      who,
      track,
      el('span', { className: 'total', textContent: totalMs ? formatDuration(totalMs) : '—' }),
    ]));
  }

  $('#board').style.setProperty('--rows', channels.length);
  $('#board').replaceChildren(head, el('div', { className: 'body' }, rows));
  renderScale();
  $('#detail').textContent = '';
}

/** 横軸（上段: 日付、下段: 時刻）と、日ごとの帯を描く。ラベルの細かさは実際の幅から決める */
function renderScale() {
  const scale = $('#board .scale');
  if (!scale) return;
  const width = scale.getBoundingClientRect().width || FALLBACK_TRACK_PX;
  const dayPx = width / view.days;
  const hourStep = HOUR_STEPS.find((h) => (dayPx / 24) * h >= MIN_HOUR_LABEL_PX);
  const dayStep = Math.ceil(MIN_DAY_LABEL_PX / dayPx) || 1;
  const narrow = dayPx < NARROW_DAY_PX;
  const today = localDayStart(Date.now());

  const dayCells = [];
  const hourLabels = [];
  const bands = [];
  let lastMonth = null;
  for (let i = 0; i < view.days; i++) {
    const day = view.start + i * DAY;
    const wd = localWeekday(day);
    const cell = el('span', { className: `day wd${wd}${day === today ? ' today' : ''}` });
    // 右端で見切れるラベルは出さない
    if (i % dayStep === 0 && (view.days - i) * dayPx >= MIN_DAY_LABEL_PX) {
      const [, month, date] = localDateString(day).split('-').map(Number);
      // 月は最初のラベルと、月が変わったところにだけ付ける
      const short = `${month === lastMonth ? '' : `${month}/`}${date}`;
      lastMonth = month;
      // 幅があれば1行で、狭ければ曜日を下の行に回し、間引くほど狭ければ日付だけにする
      if (dayPx >= FULL_DATE_PX) cell.textContent = formatDate(day);
      else if (dayPx >= DATE_WEEKDAY_PX) cell.textContent = `${short} ${weekdayLabel(wd)}`;
      else if (dayStep === 1) cell.append(short, el('span', { className: 'wd', textContent: weekdayLabel(wd) }));
      else cell.textContent = short;
      cell.classList.add('labeled');
    }
    dayCells.push(cell);

    if (hourStep) {
      for (let h = hourStep; h < 24; h += hourStep) {
        hourLabels.push(el('span', { textContent: h, style: `left:${((i + h / 24) / view.days) * 100}%` }));
      }
    }

    // 色の交互は通算の日（狭いときは月曜始まりの週）で決め、範囲を動かしても同じ日は同じ色にする
    const dayIndex = Math.floor((day + TZ_OFFSET_MIN * 60_000) / DAY);
    const alt = (narrow ? Math.floor((dayIndex + 3) / 7) : dayIndex) % 2 === 1;
    bands.push(el('span', { className: `band${alt ? ' alt' : ''}` }));
  }

  const days = scale.querySelector('.days');
  days.classList.toggle('sparse', dayStep > 1);
  days.replaceChildren(...dayCells);
  scale.querySelector('.hours').replaceChildren(...hourLabels);
  const bandTrack = $('#board .bands .track');
  bandTrack.classList.toggle('narrow', narrow);
  bandTrack.style.setProperty('--hour-frac', hourStep ? hourStep / 24 : 1);
  bandTrack.replaceChildren(...bands);
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
$('#days').addEventListener('change', (e) => { setView(viewEnd(), Number(e.target.value)); update(); });
for (const input of [$('#from'), $('#to')]) {
  // 入力欄は透明で文字の上に重ねてあるので、どこを押してもカレンダーが開くようにする
  input.addEventListener('click', () => { try { input.showPicker?.(); } catch { /* 開けない環境では通常の入力欄として動く */ } });
  input.addEventListener('change', () => {
    const from = parseLocalDate($('#from').value);
    const to = parseLocalDate($('#to').value);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    // 1日表示のときは選んだ日へ移動する。開始と終了が逆転したら、いま触ったほうに合わせて1日表示にする
    if (view.days === 1 || from > to) setView((input.id === 'from' ? from : to) + DAY, 1);
    else setView(to + DAY, (to - from) / DAY + 1);
    update();
  });
}

// 幅が変わったら横軸の細かさを決め直す
let scaleWidth = 0;
new ResizeObserver(([entry]) => {
  if (entry.contentRect.width === scaleWidth) return;
  scaleWidth = entry.contentRect.width;
  renderScale();
}).observe($('#board'));

readUrl();
load();
setInterval(load, RELOAD_MS);
