import {
  TZ_OFFSET_MIN, localDayStart, localWeekday, localDateString, parseLocalDate, normalizeHistory,
  formatDate, formatClock, formatDuration, formatHourMinute, weekdayLabel, streamEnd, mergeIntervals, PLATFORMS,
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
const BASE_FONT_PX = 13; // 上の px のしきい値は、この文字サイズのときの値
const RELOAD_MS = 5 * 60_000;
const TEAM_NAME = 'DRKS';
const SLIDE_MS = 380;
const MAX_SLIDE_SPANS = 2; // これより遠くへ動くときはスライドさせない（描く範囲が広がりすぎるため）

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let channels = [];
// 記録を残しはじめた日の 0:00。これより前は「記録なし」として扱う（決めていなければ -Infinity）
let recordFromMs = -Infinity;
// 表示範囲: start（現地日の 0:00）から days 日ぶん
const view = { start: 0, days: DEFAULT_DAYS };

// ◀ ▶ で動かした直後だけ入る、動かす前の表示範囲の開始。スライドのあいだは前後の範囲をまとめて描く
let slideFrom = null;
let slideToken = 0;

const viewEnd = () => view.start + view.days * DAY;
/** いま描く範囲。ふだんは表示範囲そのもの、スライド中は動かす前の範囲も含める */
const drawRange = () => {
  const from = Math.min(view.start, slideFrom ?? view.start);
  const to = Math.max(viewEnd(), (slideFrom ?? view.start) + view.days * DAY);
  return { from, to };
};
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
    const history = normalizeHistory(await res.json());
    channels = history.channels.filter((c) => c.sources.length);
    recordFromMs = history.recordFrom ? parseLocalDate(history.recordFrom) : -Infinity;
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
  $('#to').min = $('#from').min = Number.isFinite(recordFromMs) ? localDateString(recordFromMs) : '';
  // 記録のない期間へは戻らせない
  $('#prev').disabled = view.start <= recordFromMs;
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
  // バーは描く範囲ぶん作る（表示範囲の外は 0〜100% をはみ出し、スライドで入ってくる）
  const draw = drawRange();
  const strip = (children) => el('div', { className: 'strip' }, [
    ...children,
    ...(now >= from && now < to ? [el('span', { className: 'now', ariaHidden: 'true', style: `left:${pos(now)}` })] : []),
  ]);
  // 横軸と日ごとの帯は幅に応じて描き分けるので、renderScale() であとから埋める
  const head = el('div', { className: 'row head' }, [
    el('span'),
    el('div', { className: 'scale' }, [el('div', { className: 'days' }), el('div', { className: 'hours' })]),
    el('span', { className: 'total', textContent: '合計' }),
  ]);
  const rows = [el('div', { className: 'row bands', ariaHidden: 'true' }, [el('span'), el('div', { className: 'track' }), el('span')])];

  // いちばん上に、全員ぶんをまとめた行（誰か1人でも配信していた時間）を置く
  const clipTo = (range) => (g) => ({ start: Math.max(range.from, g.start), end: Math.min(range.to, g.end), live: g.live });
  const sumIn = (range, list) =>
    mergeIntervals(list.map(clipTo(range)).filter((g) => g.end > g.start)).reduce((sum, g) => sum + g.end - g.start, 0);
  const streamsOf = (c) => c.sources.flatMap((source) =>
    source.streams.map((s) => ({ start: Date.parse(s.start), end: streamEnd(s, now), live: s.live })));
  const everyone = channels.flatMap(streamsOf);
  rows.push(renderTeamRow(mergeIntervals(everyone.map(clipTo(draw)).filter((g) => g.end > g.start)), {
    coveredMs: sumIn({ from, to }, everyone),
    // のべ時間は、各行の「合計」を足したもの（同じ時間に2人が配信していれば2人ぶん数える）
    grossMs: channels.reduce((sum, c) => sum + sumIn({ from, to }, streamsOf(c)), 0),
    from, to, now, pos, strip,
  }));

  for (const { name, icon, sources } of channels) {
    // 1人1行。配信先（Twitch / YouTube / Kick）は色で見分ける
    const track = el('div', { className: 'track' });
    const segs = sources.flatMap((source, lane) =>
      source.streams.map((s) => ({ s, source, lane, start: Date.parse(s.start), end: streamEnd(s, now) })))
      .filter((g) => Math.min(draw.to, g.end) > Math.max(draw.from, g.start));
    const bars = [];

    for (const g of segs) {
      const { s, source, start, end } = g;
      const platform = PLATFORMS[source.platform];
      const a = Math.max(draw.from, start);
      const b = Math.min(draw.to, end);
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
      seg.addEventListener('click', (e) => {
        e.stopPropagation();
        showDetail(seg, { name, source, stream: s, start, end });
      });
      bars.push(seg);
    }
    track.append(strip(bars));

    // 合計は、同時配信を二重に数えないよう重なりをまとめてから足す
    const totalMs = sumIn({ from, to }, segs);

    // サンプルデータのチャンネルは実在しない（url が空）のでリンクにしない
    const link = (url, props, children) => (url ? externalLink(url, props, children) : el('span', props, children));
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
      el('span', { className: 'plats' }, sources.map((source) =>
        link(source.channel.url, {
          className: `plat p-${source.platform}${isLive(source) ? ' live' : ''}`,
          title: PLATFORMS[source.platform].label,
          ariaLabel: `${name}の${PLATFORMS[source.platform].label}`,
          textContent: PLATFORMS[source.platform].mark,
        }))),
    ]);

    if (totalMs) track.append(trackTotal(formatHourMinute(totalMs)));
    rows.push(el('div', { className: 'row person' }, [
      who,
      track,
      el('span', { className: 'total', textContent: totalMs ? formatDuration(totalMs) : '—' }),
    ]));
  }

  $('#board').style.setProperty('--rows', channels.length + 1);
  const body = el('div', { className: 'body' }, rows);
  attachCursorLine(body, from, span);
  $('#board').replaceChildren(head, body);
  renderScale();
  if (slideFrom != null) slide();
}

/**
 * 全員ぶんをまとめた行。誰かが配信していた時間（coveredMs）と、それが表示範囲（今より先は除く）に占める割合、
 * 全員の配信時間を足したのべ時間（grossMs）を出す
 */
function renderTeamRow(merged, { coveredMs, grossMs, from, to, now, pos, strip }) {
  const track = el('div', { className: 'track' }, [strip(merged.map((g) => {
    const label =
      `${formatDate(g.start)} ${formatClock(g.start)}〜${g.live ? '配信中' : `${formatDate(g.end)} ${formatClock(g.end)}`}` +
      `（${formatDuration(g.end - g.start)}）`;
    return el('span', {
      className: `seg team${g.live ? ' live' : ''}`,
      title: `誰かが配信していた時間\n${label}`,
      style: `left:${pos(g.start)};width:${((g.end - g.start) / (to - from)) * 100}%;top:0;height:100%`,
    });
  }))]);

  // 割合の分母からは、まだ来ていない時間と、記録を残す前の期間を除く
  const elapsed = Math.min(to, now) - Math.max(from, recordFromMs);
  const who = el('div', { className: `who${merged.some((g) => g.live) ? ' live' : ''}` }, [
    el('span', { className: 'who-link', title: TEAM_NAME }, [
      el('span', { className: 'avatar' }, [el('span', { className: 'initial', ariaHidden: 'true', textContent: '泥' })]),
      el('span', { className: 'name', textContent: TEAM_NAME }),
    ]),
  ]);
  const percent = elapsed > 0 ? `${Math.round((coveredMs / elapsed) * 100)}%` : null;
  if (coveredMs) track.append(trackTotal([formatHourMinute(coveredMs), percent].filter(Boolean).join(' · ')));
  return el('div', { className: 'row person team' }, [
    who,
    track,
    el('span', { className: 'total' }, coveredMs
      ? [
          el('span', { title: '誰か1人でも配信していた時間', textContent: formatDuration(coveredMs) }),
          ...(percent ? [el('small', { title: '表示範囲のうち、誰かが配信していた時間の割合', textContent: `カバー ${percent}` })] : []),
          el('small', { title: '全員の配信時間を足した合計（下の各行の合計の和）', textContent: `のべ ${formatDuration(grossMs)}` }),
        ]
      : ['—']),
  ]);
}

/** 狭い画面で合計の列を隠す代わりに、バーの右端へ重ねて出す合計（広い画面では CSS で隠す）。スライドしても動かないよう strip の外に置く */
function trackTotal(text) {
  return el('span', { className: 'track-total', ariaHidden: 'true', textContent: text });
}

/** 横軸（上段: 日付、下段: 時刻）と、日ごとの帯を描く。ラベルの細かさは実際の幅から決める */
function renderScale() {
  const scale = $('#board .scale');
  if (!scale) return;
  const width = scale.getBoundingClientRect().width || FALLBACK_TRACK_PX;
  // 広い画面では文字が大きくなるので、ラベルの出し分けは文字サイズで割った幅で決める
  const fontScale = parseFloat(getComputedStyle(scale).fontSize) / BASE_FONT_PX || 1;
  const narrow = width / view.days < NARROW_DAY_PX;
  const dayPx = width / view.days / fontScale;
  const hourStep = HOUR_STEPS.find((h) => (dayPx / 24) * h >= MIN_HOUR_LABEL_PX);
  const dayStep = Math.ceil(MIN_DAY_LABEL_PX / dayPx) || 1;
  const today = localDayStart(Date.now());

  // スライド中は動かす前の範囲の日も並べ、表示範囲の幅を 100% として左右にはみ出させる
  const draw = drawRange();
  const drawDays = Math.round((draw.to - draw.from) / DAY);
  const stripStyle = `width:${(drawDays / view.days) * 100}%;margin-left:${((draw.from - view.start) / DAY / view.days) * 100}%`;

  const dayCells = [];
  const hourLabels = [];
  const bands = [];
  let lastMonth = null;
  for (let n = 0; n < drawDays; n++) {
    const day = draw.from + n * DAY;
    const i = Math.round((day - view.start) / DAY); // 表示範囲の先頭から数えた日（範囲の外は負や days 以上になる）
    const wd = localWeekday(day);
    const cell = el('span', { className: `day wd${wd}${day === today ? ' today' : ''}` });
    // 右端で見切れるラベルは出さない
    if (((i % dayStep) + dayStep) % dayStep === 0 && (i >= view.days || (view.days - i) * dayPx >= MIN_DAY_LABEL_PX)) {
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
        hourLabels.push(el('span', { textContent: h, style: `left:${((n + h / 24) / drawDays) * 100}%` }));
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
  days.style.cssText = stripStyle;
  const hours = scale.querySelector('.hours');
  hours.replaceChildren(...hourLabels);
  hours.style.cssText = stripStyle;

  // 記録を残す前の期間は、斜線をかけて「配信なし」と区別する
  const noData = (Math.min(draw.to, recordFromMs) - draw.from) / (draw.to - draw.from);
  const bandStrip = el('div', { className: `band-strip${narrow ? ' narrow' : ''}`, style: stripStyle }, [
    ...bands,
    ...(noData > 0 ? [el('span', { className: 'no-data', title: '記録なし', style: `width:${noData * 100}%` })] : []),
  ]);
  bandStrip.style.setProperty('--hour-frac', hourStep ? hourStep / 24 : 1);
  $('#board .bands .track').replaceChildren(bandStrip);
}

/** ◀ ▶ で動かしたとき、動かす前の位置から新しい位置へ横に滑らせる */
function slide() {
  const board = $('#board');
  const shiftPx = ((view.start - slideFrom) / (view.days * DAY)) * board.querySelector('.scale').getBoundingClientRect().width;
  const token = ++slideToken;
  board.classList.add('sliding');
  for (const node of board.querySelectorAll('.strip, .band-strip, .days, .hours')) {
    node.animate([{ transform: `translateX(${shiftPx}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }
  // 片付けはタイマーで行う。アニメーションの完了通知は、描き直しで要素が消えたときや
  // タブが裏にあるときに届かないことがあり、それに頼ると範囲外のバーが残ったままになる
  setTimeout(() => {
    // 途中でもう一度動かされていたら、後から始まったほうに片付けを任せる
    if (token !== slideToken) return;
    slideFrom = null;
    board.classList.remove('sliding');
    renderBoard(Date.now());
  }, SLIDE_MS);
}

/** マウスの位置に縦の補助線を出し、その位置の日時を添える（タッチ操作では出さない） */
function attachCursorLine(body, from, span) {
  const label = el('span');
  const line = el('div', { className: 'cursor-line', hidden: true, ariaHidden: 'true' }, [label]);
  body.append(line);
  body.addEventListener('pointermove', (e) => {
    const track = body.querySelector('.bands .track').getBoundingClientRect();
    const ratio = (e.clientX - track.left) / track.width;
    line.hidden = e.pointerType !== 'mouse' || ratio < 0 || ratio > 1;
    if (line.hidden) return;
    const t = from + ratio * span;
    line.style.left = `${e.clientX - body.getBoundingClientRect().left}px`;
    label.textContent = `${formatDate(t)} ${formatClock(t)}`;
    // 右端ではラベルが画面からはみ出すので、線の左側に出す
    line.classList.toggle('flip', ratio > 0.85);
  });
  body.addEventListener('pointerleave', () => { line.hidden = true; });
}

/** 外部へのリンクは、ボードを開いたままにできるよう別タブで開く */
function externalLink(url, props, children) {
  return el('a', { ...props, href: url, target: '_blank', rel: 'noopener' }, children);
}

/** 押したバーのそばに、その配信の詳細（サムネイル・時刻・タイトル）をカードで出す */
function showDetail(seg, { name, source, stream, start, end }) {
  const platform = PLATFORMS[source.platform];
  const url = stream.url || source.channel.url;
  const time =
    `${formatDate(start)} ${formatClock(start)}〜${stream.live ? '配信中' : formatClock(end)}（${formatDuration(end - start)}）`;
  const openLabel = stream.live ? '配信を開く ↗' : stream.url ? 'アーカイブを開く ↗' : 'チャンネルを開く ↗';
  const thumb = el('img', { src: stream.thumb ?? '', alt: '', referrerPolicy: 'no-referrer' });
  // アーカイブが消えるとサムネイルも消えるので、読めなければ枠ごと出さない
  thumb.addEventListener('error', () => thumb.parentElement.remove());
  const close = el('button', { type: 'button', className: 'close', ariaLabel: '閉じる', textContent: '×' });
  close.addEventListener('click', hideDetail);

  const card = $('#detail');
  card.replaceChildren(
    ...(stream.thumb && url ? [externalLink(url, { className: 'thumb', tabIndex: -1, ariaHidden: 'true' }, [thumb])] : []),
    el('div', { className: 'detail-text' }, [
      el('p', { className: 'detail-who' }, [
        el('i', { className: `plat p-${source.platform}`, textContent: platform.mark }),
        `${name}（${platform.label}）`,
      ]),
      el('p', { textContent: time }),
      ...(stream.title ? [el('p', { className: 'detail-title', textContent: stream.title })] : []),
      ...(stream.game ? [el('p', { textContent: stream.game })] : []),
      ...(url ? [el('p', {}, [externalLink(url, { textContent: openLabel })])] : []),
    ]),
    close,
  );
  card.hidden = false;

  // バーのすぐ下に出す。下に入らなければ上、左右は画面内に収める（狭い画面では CSS で下端に固定する）
  const r = seg.getBoundingClientRect();
  const margin = 8;
  const below = r.bottom + margin;
  const top = below + card.offsetHeight <= innerHeight ? below : Math.max(margin, r.top - margin - card.offsetHeight);
  card.style.left = `${Math.max(margin, Math.min(r.left, innerWidth - card.offsetWidth - margin))}px`;
  card.style.top = `${top}px`;
}

function hideDetail() {
  $('#detail').hidden = true;
}

/** 表示範囲を変えたあとの描き直し。slideStart を渡すと、その位置から横に滑らせる */
function update(slideStart = null) {
  hideDetail();
  // 滑っている途中で別の操作が来たら、前のスライドの片付けは無効にする
  slideFrom = slideStart;
  slideToken++;
  $('#board').classList.remove('sliding');
  writeUrl();
  render();
}

/** 日数はそのままで表示範囲を動かす。近くへの移動なら横に滑らせる（「動きを減らす」設定のときはしない） */
function moveTo(end) {
  const before = view.start;
  setView(end, view.days);
  const near = Math.abs(view.start - before) <= MAX_SLIDE_SPANS * view.days * DAY;
  update(near && view.start !== before && !matchMedia('(prefers-reduced-motion: reduce)').matches ? before : null);
}

$('#prev').addEventListener('click', () => moveTo(viewEnd() - view.days * DAY));
$('#next').addEventListener('click', () => moveTo(viewEnd() + view.days * DAY));
$('#today').addEventListener('click', () => moveTo(todayEnd()));
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

// カードの外を押すか Esc で閉じる
document.addEventListener('click', (e) => { if (!e.target.closest('#detail')) hideDetail(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideDetail(); });

readUrl();
load();
setInterval(load, RELOAD_MS);
