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
const ZOOM_MS = 450;
const MAX_ANIM_DAYS = 120; // 変える前後を合わせた範囲がこれより長いときは、アニメーションなしで切り替える（描く量が増えすぎるため）

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

// 表示範囲を動かした直後だけ入る、動かす前の表示範囲 { start, days }。
// アニメーションのあいだは、前後の範囲をまとめて描いておく
let animFrom = null;
let animToken = 0;

const viewEnd = () => view.start + view.days * DAY;
/** いま描く範囲。ふだんは表示範囲そのもの、アニメーション中は動かす前の範囲も含める */
const drawRange = () => {
  const before = animFrom ?? view;
  return { from: Math.min(view.start, before.start), to: Math.max(viewEnd(), before.start + before.days * DAY) };
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
  document.querySelectorAll('.js-today').forEach((b) => b.setAttribute('aria-pressed', String(viewEnd() >= todayEnd())));
  document.querySelectorAll('.range button').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.days) === view.days)));
  fitHeader();
  moveThumb();
  // 用意した日数に当てはまらないときは「指定」を出す
  for (const select of document.querySelectorAll('.js-days')) {
    select.value = [...select.options].some((o) => Number(o.value) === view.days) ? String(view.days) : '';
  }

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
  const everyone = channels.flatMap((c) => c.sources.flatMap((source) =>
    source.streams.map((s) => ({ start: Date.parse(s.start), end: streamEnd(s, now), live: s.live }))));
  rows.push(renderTeamRow(mergeIntervals(everyone.map(clipTo(draw)).filter((g) => g.end > g.start)), {
    coveredMs: sumIn({ from, to }, everyone),
    from, to, pos, strip,
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

    rows.push(el('div', { className: 'row person' }, [who, track, totalCell(totalMs)]));
  }

  $('#board').style.setProperty('--rows', channels.length + 1);
  const body = el('div', { className: 'body' }, rows);
  attachCursorLine(body, from, span);
  $('#board').replaceChildren(head, body);
  renderScale();
  if (animFrom) animateBoard();
}

/** 全員ぶんをまとめた行。合計は、誰か1人でも配信していた時間（coveredMs） */
function renderTeamRow(merged, { coveredMs, from, to, pos, strip }) {
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

  const who = el('div', { className: `who${merged.some((g) => g.live) ? ' live' : ''}` }, [
    el('span', { className: 'who-link', title: TEAM_NAME }, [
      el('span', { className: 'avatar' }, [el('span', { className: 'initial', ariaHidden: 'true', textContent: '泥' })]),
      el('span', { className: 'name', textContent: TEAM_NAME }),
    ]),
  ]);
  return el('div', { className: 'row person team' }, [who, track, totalCell(coveredMs, '誰か1人でも配信していた時間')]);
}

/** 合計の列。広い画面では「9時間57分」、狭い画面では列を細くして「9h57m」と出す（どちらを出すかは CSS が決める） */
function totalCell(ms, title = '') {
  return el('span', { className: 'total', title }, ms
    ? [el('span', { className: 'long', textContent: formatDuration(ms) }), el('span', { className: 'short', textContent: formatHourMinute(ms) })]
    : ['—']);
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
  // 日付の横に曜日が入らない幅では、曜日を下の段に回す。そのときは時刻の段を出さず、見出しを2段までに収める
  // （その幅で出せる時刻は「12」だけなので、曜日を優先する。時刻の目盛り線は帯に残る）
  const weekdayBelow = dayPx < DATE_WEEKDAY_PX && dayStep === 1;
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
      else if (weekdayBelow) cell.append(short, el('span', { className: 'wd', textContent: weekdayLabel(wd) }));
      else cell.textContent = short;
      cell.classList.add('labeled');
    }
    dayCells.push(cell);

    if (hourStep && !weekdayBelow) {
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

/**
 * 表示範囲を変えたとき、変える前の見え方から新しい見え方へ動かす。
 * ◀ ▶ なら横に滑り、日数の切替なら横に伸び縮みする（時刻 t の位置は、前後とも t の一次式なので
 * 「新しい位置 x → 前の位置 a*x + b」の変形を 0 へ戻せばよい）
 */
function animateBoard() {
  const board = $('#board');
  // 幅と左端は帯の入れ物から測る（横軸の入れ物は、はみ出した中身のぶん広く測れてしまうことがある）
  const scaleBox = board.querySelector('.bands .track').getBoundingClientRect();
  const a = view.days / animFrom.days;
  const b = ((view.start - animFrom.start) / (animFrom.days * DAY)) * scaleBox.width;
  const zoom = a !== 1;
  const duration = zoom ? ZOOM_MS : SLIDE_MS;
  const timing = { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
  const token = ++animToken;
  board.classList.add('sliding');
  for (const node of board.querySelectorAll('.strip, .band-strip')) {
    // 左端がバーの領域の左端からずれている要素（帯）は、そのずれ m のぶん平行移動を補正する
    const m = node.getBoundingClientRect().left - scaleBox.left;
    node.animate([{ transform: `translateX(${a * m + b - m}px) scaleX(${a})` }, { transform: 'none' }], timing);
  }
  for (const node of board.querySelectorAll('.days, .hours')) {
    // 目盛りの文字は、伸び縮みさせると潰れて読めないので、日数の切替ではふわっと入れ替える
    node.animate(zoom ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: `translateX(${b}px)` }, { transform: 'none' }], timing);
  }
  // 片付けはタイマーで行う。アニメーションの完了通知は、描き直しで要素が消えたときや
  // タブが裏にあるときに届かないことがあり、それに頼ると範囲外のバーが残ったままになる
  setTimeout(() => {
    // 途中でもう一度動かされていたら、後から始まったほうに片付けを任せる
    if (token !== animToken) return;
    animFrom = null;
    board.classList.remove('sliding');
    renderBoard(Date.now());
  }, duration);
}

/**
 * 日数のボタン列がロゴの横に入りきるかを実測し、入らなければプルダウンに替える（.compact）。
 * 入るかどうかはフォントや文字の拡大率、期間の文字数で変わるので、幅の決め打ちにはしない
 */
function fitHeader() {
  const hero = $('.hero');
  hero.classList.remove('compact');
  // 狭い画面は、ヘッダーに期間だけを置く別の並べ方（CSS のメディアクエリ側で決める）
  if (matchMedia('(max-width: 40rem)').matches) return;
  const logo = hero.querySelector('h1').getBoundingClientRect();
  const controls = hero.querySelector('.controls');
  const box = controls.getBoundingClientRect();
  const wrapped = box.top >= logo.bottom - 1;
  const overflowing = controls.scrollWidth > controls.clientWidth + 1 || box.right > hero.getBoundingClientRect().right + 1;
  if (wrapped || overflowing) hero.classList.add('compact');
}

/** 日数ボタンの塗りつぶし（つまみ）を、選択中のボタンの位置へ動かす。用意した日数でなければ隠す */
function moveThumb() {
  const range = $('.range');
  const pressed = range.querySelector('[aria-pressed="true"]');
  const thumb = range.querySelector('.thumb');
  thumb.style.opacity = pressed ? 1 : 0;
  if (!pressed || !pressed.offsetWidth) return;
  thumb.style.width = `${pressed.offsetWidth}px`;
  thumb.style.transform = `translateX(${pressed.offsetLeft - thumb.offsetLeft}px)`;
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

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 表示範囲を変えたあとの描き直し。before（変える前の { start, days }）を渡すと、そこからアニメーションする */
function update(before = null) {
  hideDetail();
  // 動いている途中で別の操作が来たら、前のアニメーションの片付けは無効にする
  animFrom = before && !reducedMotion() && (before.start !== view.start || before.days !== view.days) ? before : null;
  if (animFrom && (drawRange().to - drawRange().from) / DAY > MAX_ANIM_DAYS) animFrom = null;
  animToken++;
  $('#board').classList.remove('sliding');
  writeUrl();
  render();
}

/** 日数はそのままで表示範囲を動かす。ボードは横に滑って切り替わる */
function moveTo(end) {
  const before = { ...view };
  setView(end, view.days);
  update(before);
}

/** 終わりの日はそのままで日数を変える。バーは横に伸び縮みして切り替わる */
function zoomTo(days) {
  const before = { ...view };
  setView(viewEnd(), days);
  update(before);
}

$('#prev').addEventListener('click', () => moveTo(viewEnd() - view.days * DAY));
$('#next').addEventListener('click', () => moveTo(viewEnd() + view.days * DAY));
document.querySelectorAll('.js-today').forEach((btn) => btn.addEventListener('click', () => moveTo(todayEnd())));
document.querySelectorAll('.range button').forEach((btn) => {
  btn.addEventListener('click', () => zoomTo(Number(btn.dataset.days)));
});
document.querySelectorAll('.js-days').forEach((select) =>
  select.addEventListener('change', () => zoomTo(Number(select.value))));
for (const input of [$('#from'), $('#to')]) {
  // 入力欄は透明で文字の上に重ねてあるので、どこを押してもカレンダーが開くようにする
  input.addEventListener('click', () => { try { input.showPicker?.(); } catch { /* 開けない環境では通常の入力欄として動く */ } });
  input.addEventListener('change', () => {
    const from = parseLocalDate($('#from').value);
    const to = parseLocalDate($('#to').value);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    // 1日表示のときは選んだ日へ移動する。開始と終了が逆転したら、いま触ったほうに合わせて1日表示にする
    const before = { ...view };
    if (view.days === 1 || from > to) setView((input.id === 'from' ? from : to) + DAY, 1);
    else setView(to + DAY, (to - from) / DAY + 1);
    update(before);
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

// 日数ボタンのつまみはボタンの実寸から位置を決めるので、大きさが変わったら置き直す
new ResizeObserver(moveThumb).observe($('.range'));
// ヘッダーの幅が変わったら、ボタン列が入るかを測り直す
new ResizeObserver(fitHeader).observe($('.hero'));
// フォントが入るとボタンの幅が変わる。太字などは使われてから読み込まれるので、読み込みが終わるたびに測り直す
document.fonts.addEventListener('loadingdone', () => { fitHeader(); moveThumb(); });
document.fonts.ready.then(() => { fitHeader(); moveThumb(); });

readUrl();
load();
setInterval(load, RELOAD_MS);
