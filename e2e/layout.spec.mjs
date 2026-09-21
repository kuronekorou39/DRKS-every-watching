// 幅と日数の組み合わせごとに、レイアウトの約束が守られているかを確かめる。
// これまで手で測っていたもの: ヘッダーの行数、横軸の見出しの段数、フッターの行数、はみ出し、スクロール、バーの縦位置
import { test, expect } from '@playwright/test';
import { openBoard } from './fixture.mjs';

// ブレークポイント（640/641, 864/865, 1199/1200 など）の前後と、過去に崩れを指摘された幅（500, 659, 669, 711）を含める
const WIDTHS = [320, 344, 360, 375, 390, 412, 500, 640, 641, 659, 669, 711, 800, 864, 865, 1000, 1199, 1200, 1400, 1920];
const DAYS = [1, 3, 7, 14, 28];
const heightFor = (width) => (width <= 360 ? 640 : width <= 640 ? 760 : width >= 1900 ? 1080 : 800);

/** 日数を切り替える。広い幅ではボタン列、狭い幅ではプルダウンが出ている */
async function setDays(page, days) {
  const button = page.locator(`.range [data-days="${days}"]`);
  if (await button.isVisible()) await button.click();
  else await page.locator('.controls .js-days').selectOption(String(days));
}

function measure() {
  const visible = (el) => el && el.offsetWidth > 0;
  const rowsOf = (els) => new Set(els.map((el) => { const r = el.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 12); })).size;
  const doc = document.documentElement;

  const hero = document.querySelector('.hero');
  const headerParts = [...hero.querySelectorAll('h1, .step, .range, .controls .js-days')].filter(visible);
  const heroRight = hero.getBoundingClientRect().right;

  const scale = document.querySelector('#board .scale').getBoundingClientRect();
  const labels = [...document.querySelectorAll('.day.labeled')]
    .map((cell) => { const range = document.createRange(); range.selectNodeContents(cell); return range.getBoundingClientRect(); })
    .filter((r) => r.left >= scale.left - 1 && r.right <= scale.right + 1);

  const foot = document.querySelector('.foot');
  const footParts = [...foot.children].filter(visible);
  const note = foot.querySelector('.note');
  const noteLines = Math.round(note.offsetHeight / parseFloat(getComputedStyle(note).lineHeight));

  const rows = [...document.querySelectorAll('.row.person')].map((row) => {
    const box = row.getBoundingClientRect();
    const track = row.querySelector('.track').getBoundingClientRect();
    const avatar = row.querySelector('.avatar').getBoundingClientRect();
    const center = box.top + box.height / 2;
    return { bar: Math.abs(track.top + track.height / 2 - center), avatar: Math.abs(avatar.top + avatar.height / 2 - center), avatarFits: avatar.height <= box.height };
  });

  return {
    horizontalScroll: doc.scrollWidth > doc.clientWidth,
    verticalScroll: doc.scrollHeight > doc.clientHeight,
    headerRows: rowsOf(headerParts),
    headerOverflow: Math.max(...headerParts.map((el) => el.getBoundingClientRect().right)) > heroRight + 1,
    axisLines: (document.querySelector('.day .wd') ? 2 : 1) + (document.querySelector('.hours span') ? 1 : 0),
    labelsOverlap: labels.some((r, i) => i > 0 && labels[i - 1].right > r.left + 0.5),
    footRows: rowsOf(footParts.filter((el) => el !== note)) + (footParts.length > 1 && rowsOf([footParts[0], note]) === 1 ? 0 : noteLines),
    footOverflow: Math.max(...footParts.map((el) => el.getBoundingClientRect().right)) > foot.getBoundingClientRect().right + 1,
    worstBarOffset: Math.max(...rows.map((r) => r.bar)),
    worstAvatarOffset: Math.max(...rows.map((r) => r.avatar)),
    avatarsFit: rows.every((r) => r.avatarFits),
    personRows: rows.length,
  };
}

for (const width of WIDTHS) {
  test(`幅 ${width}px: どの日数でも崩れない`, async ({ page }) => {
    await openBoard(page, { width, height: heightFor(width) });
    for (const days of DAYS) {
      await setDays(page, days);
      const m = await page.evaluate(measure);
      const at = `幅 ${width}px / ${days}日`;
      expect(m.personRows, `${at}: DRKS 行 + 8人`).toBe(9);
      expect(m.horizontalScroll, `${at}: 横スクロール`).toBe(false);
      expect(m.verticalScroll, `${at}: 縦スクロール`).toBe(false);
      expect(m.headerRows, `${at}: ヘッダーの行数`).toBe(1);
      expect(m.headerOverflow, `${at}: ヘッダーのはみ出し`).toBe(false);
      expect(m.axisLines, `${at}: 横軸の見出しの段数`).toBeLessThanOrEqual(2);
      expect(m.labelsOverlap, `${at}: 日付ラベルの重なり`).toBe(false);
      expect(m.footRows, `${at}: フッターの行数`).toBeLessThanOrEqual(width < 350 ? 3 : 2);
      expect(m.footOverflow, `${at}: フッターのはみ出し`).toBe(false);
      expect(m.worstBarOffset, `${at}: バーが行の縦中央にある`).toBeLessThanOrEqual(1);
      expect(m.worstAvatarOffset, `${at}: アイコンが行の縦中央にある`).toBeLessThanOrEqual(1);
      expect(m.avatarsFit, `${at}: アイコンが行に収まる`).toBe(true);
    }
  });
}

test('ヘッダーの操作欄の上下の余白がそろっている', async ({ page }) => {
  for (const width of [390, 1000, 1400]) {
    await openBoard(page, { width, height: 800 });
    const gap = await page.evaluate(() => {
      const step = document.querySelector('.step').getBoundingClientRect();
      const head = document.querySelector('.row.head').getBoundingClientRect();
      return { above: step.top, below: head.top - step.bottom };
    });
    expect(Math.abs(gap.above - gap.below), `幅 ${width}px: 上 ${gap.above} / 下 ${gap.below}`).toBeLessThanOrEqual(1);
  }
});
