// 操作したときの動きを確かめる: 表示範囲の移動、「今日」の状態、日付指定、URL、詳細カード、リンク
import { test, expect } from '@playwright/test';
import { openBoard } from './fixture.mjs';

const period = (page) => page.evaluate(() =>
  [document.querySelector('#from').value, document.querySelector('#to').value]);

test('最初は今日までの3日間を表示する', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800 });
  expect(await period(page)).toEqual(['2026-09-19', '2026-09-21']);
  await expect(page.locator('.range [aria-pressed="true"]')).toHaveText('3日');
  await expect(page.locator('.js-today')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#next')).toBeDisabled();
});

test('◀ ▶ と「今日」で表示範囲が動き、URL に残る', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800 });
  await page.locator('#prev').click();
  expect(await period(page)).toEqual(['2026-09-16', '2026-09-18']);
  await expect(page.locator('.js-today')).toHaveAttribute('aria-pressed', 'false');
  expect(new URL(page.url()).search).toBe('?from=2026-09-16&to=2026-09-18');
  // 記録を残しはじめた日（9/16）より前へは戻れない
  await expect(page.locator('#prev')).toBeDisabled();

  await page.locator('.js-today').click();
  expect(await period(page)).toEqual(['2026-09-19', '2026-09-21']);
  await expect(page.locator('.js-today')).toHaveAttribute('aria-pressed', 'true');
});

test('キーボードの ← → と T で表示範囲が動く。入力欄の操作は横取りしない', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800 });
  await page.keyboard.press('ArrowLeft');
  expect(await period(page)).toEqual(['2026-09-16', '2026-09-18']);
  await page.keyboard.press('ArrowRight');
  expect(await period(page)).toEqual(['2026-09-19', '2026-09-21']);
  // 今日より先へは進めない
  await page.keyboard.press('ArrowRight');
  expect(await period(page)).toEqual(['2026-09-19', '2026-09-21']);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('t');
  expect(await period(page)).toEqual(['2026-09-19', '2026-09-21']);

  await page.locator('#from').focus();
  await page.keyboard.press('ArrowLeft');
  expect(await period(page)).toEqual(['2026-09-19', '2026-09-21']);
});

test('ボードを指で左右に払うと表示範囲が動く。縦の動きやマウスでは動かない', async ({ page }) => {
  await openBoard(page, { width: 390, height: 760 });
  const swipe = (dx, dy, pointerType = 'touch') => page.locator('.row.person .track').nth(3).evaluate((el, [dx, dy, pointerType]) => {
    const r = el.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, pointerType, clientX: x, clientY: y }));
    fire('pointerdown', at.clientX, at.clientY);
    fire('pointerup', at.clientX + dx, at.clientY + dy);
  }, [dx, dy, pointerType]);

  await swipe(120, 10);
  expect(await period(page)).toEqual(['2026-09-16', '2026-09-18']);
  await swipe(-120, -10);
  expect(await period(page)).toEqual(['2026-09-19', '2026-09-21']);
  await swipe(60, 200);
  await swipe(20, 0);
  await swipe(120, 0, 'mouse');
  expect(await period(page)).toEqual(['2026-09-19', '2026-09-21']);
});

test('文字を選択できるのは詳細カードだけ', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800 });
  await page.locator('.person:not(.team) .seg').first().click();
  for (const selector of ['.hero h1', '.day', '.who .name', '.total', '.foot .note']) {
    await expect(page.locator(selector).first(), selector).toHaveCSS('user-select', 'none');
  }
  await expect(page.locator('#detail .detail-title')).toHaveCSS('user-select', 'text');
});

test('ライトかダークかは OS の設定に合わせ、開いているあいだの切り替えにも追従する', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openBoard(page, { width: 1400, height: 800 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(230, 233, 242)');
  await page.emulateMedia({ colorScheme: 'light' });
  // テストでは時刻を止めていて画面が描き直されないので、読み取りで設定の変化を反映させる
  await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(29, 38, 64)');
});

test('URL の from / to で範囲を指定して開ける', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800, search: '?from=2026-09-17&to=2026-09-18' });
  expect(await period(page)).toEqual(['2026-09-17', '2026-09-18']);
  await expect(page.locator('.day')).toHaveCount(2);
  // 用意した日数（1・3・7・14・28）ではないので、どのボタンも選択中にならない
  await expect(page.locator('.range [aria-pressed="true"]')).toHaveCount(0);
});

test('日付を手で変えると範囲が変わる。逆転させたら1日表示になる', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800 });
  await page.locator('#from').fill('2026-09-17');
  expect(await period(page)).toEqual(['2026-09-17', '2026-09-21']);
  await expect(page.locator('.day')).toHaveCount(5);

  await page.locator('#to').fill('2026-09-16');
  expect(await period(page)).toEqual(['2026-09-16', '2026-09-16']);
  await expect(page.locator('.day')).toHaveCount(1);
});

test('配信中の人はアイコンとバーが配信中の見た目になり、DRKS 行にも出る', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800 });
  await expect(page.locator('.person:not(.team) .who.live')).toHaveCount(1);
  await expect(page.locator('.person:not(.team) .seg.live')).toHaveCount(1);
  await expect(page.locator('.team .seg.live')).toHaveCount(1);
  await expect(page.locator('.team .who.live')).toHaveCount(1);
});

test('現在時刻の線は行の境目で切れず、今日の見出しには色が付く', async ({ page }) => {
  for (const width of [390, 1400]) {
    await openBoard(page, { width, height: 800 });
    const lines = await page.locator('.row.person .now').evaluateAll((els) =>
      els.map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
    expect(lines).toHaveLength(9);
    const gaps = lines.slice(1).map((line, i) => line.top - lines[i].bottom);
    expect(Math.max(...gaps), `幅 ${width}px: 線のすき間`).toBeLessThanOrEqual(0.5);
    const body = await page.locator('.body').boundingBox();
    expect(lines.at(-1).bottom, `幅 ${width}px: 線が表の下へはみ出さない`).toBeLessThanOrEqual(body.y + body.height + 0.5);
    await expect(page.locator('.day.today')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.day:not(.today)').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
});

test('配信していない人のアイコンは控えめになり、行に乗せると元に戻る', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800 });
  const live = page.locator('.who.live .initial').first();
  const idleRow = page.locator('.row.person:has(.who:not(.live))').first();
  const idle = idleRow.locator('.initial');
  await expect(live).toHaveCSS('opacity', '1');
  await expect(live).toHaveCSS('filter', 'none');
  await expect(idle).not.toHaveCSS('opacity', '1');
  await expect(idle).not.toHaveCSS('filter', 'none');
  await idleRow.hover();
  await expect(idle).toHaveCSS('opacity', '1');
  await expect(idle).toHaveCSS('filter', 'none');
});

test('同時配信は上下に分かれ、合計は二重に数えない', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800, search: '?from=2026-09-19&to=2026-09-19' });
  const first = page.locator('.person:not(.team)').first();
  // 9/19 は Twitch 4時間（18:00〜22:00）と YouTube 2時間（19:00〜21:00）が重なっている
  const heights = await first.locator('.seg').evaluateAll((segs) => segs.map((s) => s.style.height));
  expect(heights).toEqual(['50%', '50%']);
  await expect(first.locator('.total .long')).toHaveText('4時間');
});

test('バーを押すと詳細カードが出て、Esc で閉じる。リンクは別タブで開く', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800 });
  await page.locator('.person:not(.team) .seg').first().click();
  const card = page.locator('#detail');
  await expect(card).toBeVisible();
  await expect(card.locator('a')).toHaveAttribute('target', '_blank');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();

  const externalLinks = await page.locator('a[href^="http"]').evaluateAll((links) => links.map((a) => a.target));
  expect(externalLinks.length).toBeGreaterThan(0);
  expect(externalLinks.every((target) => target === '_blank')).toBe(true);
});

test('開きっぱなしで日付が変わると、今日までを表示していた範囲が1日進む', async ({ page }) => {
  await openBoard(page, { width: 1400, height: 800 });
  await page.clock.fastForward('05:00:00'); // 20:00 → 翌 1:00
  expect(await period(page)).toEqual(['2026-09-20', '2026-09-22']);
  await expect(page.locator('.js-today')).toHaveAttribute('aria-pressed', 'true');
});

test('狭い幅では名前を隠し、合計を短い書き方で右端の列に出す', async ({ page }) => {
  await openBoard(page, { width: 390, height: 760 });
  await expect(page.locator('.person:not(.team) .name').first()).toBeHidden();
  await expect(page.locator('.person:not(.team) .total .short').first()).toBeVisible();
  await expect(page.locator('.person:not(.team) .total .short').first()).toHaveText(/^\d+h\d{2}m$|^\d+m$/);
  await expect(page.locator('.controls .js-days')).toBeVisible();
  await expect(page.locator('.range')).toBeHidden();
});
