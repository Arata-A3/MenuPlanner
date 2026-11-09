// v2.4.0 の新機能の動作確認（冷蔵庫・食材の使い回し・共有・更新のお知らせ）
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    fs.readFile(path.join(ROOT, p), (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
        res.end(data);
    });
});

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://localhost:${server.address().port}/`;
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
    const errors = [];
    const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) errors.push(label); };

    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.replace(/\/$/, '') });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept().catch(() => { }));
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto(url);
    await page.waitForSelector('.ingredient-tag');
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2') || '{}'));

    // --- 冷蔵庫を覚える
    for (const ing of ['キャベツ', '豚肉', '卵']) {
        await page.fill('#ingredient-filter', ing);
        await page.locator(`#ingredient-list .ingredient-tag:text-is("${ing}")`).first().click();
    }
    await page.fill('#ingredient-filter', '');
    let st = await store();
    check(`冷蔵庫に保存 (${st.fridge.map(f => f.name).join(',')})`, st.fridge.length === 3);
    await page.reload();
    await page.waitForSelector('.ingredient-tag');
    const chips = await page.locator('#selected-chips .selected-chip').count();
    check('再読み込み後も冷蔵庫の材料が残る', chips === 3);

    // 早めに使う印
    const cabbage = page.locator('#selected-chips .selected-chip', { hasText: 'キャベツ' });
    await cabbage.locator('.urgent-btn').click();
    st = await store();
    check('⏰ 早めに使う印を保存', st.fridge.find(f => f.name === 'キャベツ').urgent === true);
    const firstChip = await page.locator('#selected-chips .selected-chip').first().textContent();
    check('早めに使う材料が先頭に並ぶ', firstChip.includes('キャベツ'));

    await page.click('#search-by-ingredient');
    const infos = await page.locator('#ingredient-result .match-info').allTextContents();
    const firstMissing = await page.evaluate(() => {
        const t = document.querySelector('#ingredient-result .match-info').textContent;
        return t.includes('全部そろってる') ? 0 : 1;
    });
    // 同じ「足りない数」の中ではキャベツを使う料理が先に並ぶ
    const group = infos.filter(t => (t.includes('全部そろってる') ? 0 : 1) === firstMissing);
    const flags = group.map(t => t.includes('⏰キャベツ'));
    const sorted = flags.every((f, i) => i === 0 || !f || flags[i - 1]);
    check(`キャベツを使う料理が同じ条件の中で先に並ぶ（先頭 ${flags.filter(Boolean).length} 品）`, flags[0] && sorted);
    await page.screenshot({ path: path.join(OUT, 'v24-1-fridge.png') });

    // ひらめきに「早めに使いたい」の理由
    await page.click('.tab-btn[data-target="inspire-tab"]');
    await page.click('#start-inspire', { force: true });
    const reasons = await page.locator('#inspire-result .reason-chip').allTextContents();
    check(`ひらめきに早めに使う材料: ${reasons.join(' / ')}`, reasons.some(t => t.includes('早めに使いたいキャベツ')));

    // --- 1週間の献立で食材を使い回す
    await page.click('.tab-btn[data-target="week-tab"]');
    await page.click('[data-week="days"] button[data-value="7"]');
    await page.click('[data-week="withSides"] button[data-value="main"]');
    await page.click('[data-week="reuse"] button[data-value="on"]');
    await page.click('#start-week', { force: true });
    const summary = await page.locator('.week-summary').textContent();
    check(`使い回し情報: ${summary.match(/買う材料.*?(?=7日分|$)/s)?.[0].trim()}`, summary.includes('買う材料') && summary.includes('使い回す材料'));
    st = await store();
    check('使い回しの設定を保存', st.weekPlan.reuse === true);
    const firstDays = await page.evaluate(() => {
        const plan = JSON.parse(localStorage.getItem('menuPlanner.v2')).weekPlan;
        return plan.days.slice(0, 3).some(d => RECIPE_BY_ID.get(d.main).allIngs.includes('キャベツ'));
    });
    check('早めに使うキャベツを最初の3日で使う', firstDays);

    // 使い回しあり／なしで買う材料の種類を比べる（10回の平均）
    const avgKinds = await page.evaluate(async () => {
        const kinds = reuse => {
            weekOptions.reuse = reuse;
            let total = 0;
            for (let i = 0; i < 10; i++) {
                generateWeek();
                const plan = state.weekPlan;
                total += new Set(plan.days.flatMap(d => [d.main, ...d.sides].flatMap(id => shopIngs(RECIPE_BY_ID.get(id))))).size;
            }
            return total / 10;
        };
        return { on: kinds(true), off: kinds(false) };
    });
    check(`使い回すと買う材料が減る（使い回す ${avgKinds.on} 種類 / 気にしない ${avgKinds.off} 種類）`, avgKinds.on < avgKinds.off);
    await page.click('[data-week="reuse"] button[data-value="on"]');
    await page.click('#start-week', { force: true });
    await page.screenshot({ path: path.join(OUT, 'v24-2-week.png'), fullPage: true });

    // --- 共有（PC ではコピー）
    await page.click('.week-summary button:has-text("共有")');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(`共有テキスト（1行目: ${clip.split('\n')[0]}）`, clip.startsWith('📆 献立') && clip.split('\n').length >= 9 && clip.includes('今日の献立メーカー'));

    await page.locator('.week-day .set-btn').first().click();
    await page.click('#set-body button:has-text("共有")');
    const clip2 = await page.evaluate(() => navigator.clipboard.readText());
    check('献立セットの共有テキスト', clip2.startsWith('🍱 今日の献立') && clip2.includes('主菜') || clip2.includes('主食系'));
    await page.click('#set-close');

    // --- 更新履歴・新しくなったこと
    await page.click('#app-version');
    const log = await page.locator('#changelog-body').textContent();
    check('フッターから更新履歴', log.includes('v2.4.0') && log.includes('v2.0.0'));
    await page.click('#changelog-close');

    await page.evaluate(() => localStorage.setItem('menuPlanner.seenVersion', '2.3.0'));
    await page.reload();
    await page.waitForTimeout(300);
    const title = await page.locator('#changelog-title').textContent();
    const open = await page.locator('#changelog-dialog').isVisible();
    check(`前の版から更新した人に新機能を表示: ${title}`, open && title.includes('新しくなりました'));
    await page.screenshot({ path: path.join(OUT, 'v24-3-whatsnew.png') });
    await page.click('#changelog-close');
    await page.reload();
    await page.waitForTimeout(300);
    check('2回目は表示しない', !(await page.locator('#changelog-dialog').isVisible()));

    // 初めて使う人には出さない
    const fresh = await browser.newPage();
    await fresh.goto(url);
    await fresh.waitForTimeout(300);
    check('初めて使う人には出さない', !(await fresh.locator('#changelog-dialog').isVisible()));
    await fresh.close();

    // 更新のお知らせバナー
    await page.evaluate(() => window.showUpdateBanner());
    check('更新のお知らせバナーを表示', await page.locator('#update-banner').isVisible());
    await page.click('#update-dismiss');
    check('お知らせバナーを閉じられる', !(await page.locator('#update-banner').isVisible()));

    // スマホ表示
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await m.goto(url);
    await m.evaluate(s => localStorage.setItem('menuPlanner.v2', s), JSON.stringify(await store()));
    await m.evaluate(() => localStorage.setItem('menuPlanner.seenVersion', '2.4.0'));
    await m.reload();
    await m.waitForSelector('.ingredient-tag');
    await m.screenshot({ path: path.join(OUT, 'v24-4-mobile-fridge.png') });
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check('スマホ幅で横スクロールが出ない', !overflow);

    await browser.close();
    server.close();
    console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL OK');
    process.exitCode = errors.length ? 1 : 0;
})();
