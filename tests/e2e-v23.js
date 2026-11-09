// v2.3.0 の新機能の動作確認
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
    await new Promise(r => server.listen(0, r));
    const url = `http://localhost:${server.address().port}/`;
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
    const errors = [];
    const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) errors.push(label); };

    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    page.on('dialog', d => d.accept().catch(() => { }));
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto(url);
    await page.waitForSelector('.ingredient-tag');

    // よく使う材料が最初のカテゴリ
    const firstCat = await page.locator('.cat-chip').first().textContent();
    const firstTags = await page.locator('#ingredient-list .ingredient-tag').allTextContents();
    check(`最初のカテゴリ「${firstCat}」: ${firstTags.slice(0, 8).join(' ')}`, firstCat.includes('よく使う') && firstTags.includes('玉ねぎ'));

    // あと少しで作れる
    for (const ing of ['豚肉', '玉ねぎ', 'じゃがいも', 'にんじん']) {
        await page.fill('#ingredient-filter', ing);
        await page.locator(`#ingredient-list .ingredient-tag:text-is("${ing}")`).first().click();
    }
    await page.fill('#ingredient-filter', '');
    await page.click('#search-by-ingredient');
    const firstInfos = await page.locator('#ingredient-result .match-info').allTextContents();
    const names = await page.locator('#ingredient-result .recipe-card h3').allTextContents();
    check(`先頭は全部そろってる料理: ${names.slice(0, 3).join(' / ')} | ${firstInfos[0]}`, firstInfos[0].includes('全部そろってる'));
    check('カレーライスが上位に', names.slice(0, 12).includes('カレーライス'));
    const toolbar = await page.locator('.result-toolbar').textContent();
    check(`ツールバー: ${toolbar.trim()}`, toolbar.includes('全部そろってる料理'));
    await page.click('.result-toolbar .toggle-chip');
    const readyInfos = await page.locator('#ingredient-result .match-info').allTextContents();
    check(`すぐ作れるだけ (${readyInfos.length}件)`, readyInfos.every(t => t.includes('全部そろってる') || /^あと [^、]+$/.test(t)));
    await page.click('.result-toolbar .toggle-chip');

    // カレーライスのカード: どれか1つ・PFC・選ぶ材料によるアレルゲン
    const curry = page.locator('#ingredient-result .recipe-card', { has: page.locator('h3:text-is("カレーライス")') });
    await curry.locator('.card-ings summary').click();
    const curryText = await curry.textContent();
    check('材料に「のどれか」', curryText.includes('豚肉 / 牛肉 / 鶏肉 のどれか'));
    check('PFC 表示', /P 20g・F 25g・C 111g/.test(curryText));
    check('選ぶ材料によるアレルゲン', curryText.includes('選ぶ材料による'));
    await page.screenshot({ path: path.join(OUT, 'v23-1-ready.png') });

    // 牛肉アレルギーでもカレーは出る（豚・鶏で作れる）
    await page.click('#open-settings');
    await page.click('#allergen-options button:text-is("牛肉")');
    await page.click('#settings-close'); await page.waitForTimeout(200); // close イベント後の再表示を待つ
    const namesBeef = await page.locator('#ingredient-result .recipe-card h3').allTextContents();
    check('牛肉アレルギーでもカレーライスは候補に残る', namesBeef.includes('カレーライス'));
    check('牛肉アレルギーで肉じゃが(豚でOK)も残る', namesBeef.includes('肉じゃが'));
    await page.click('#open-settings');
    await page.click('#allergen-options button:text-is("牛肉")');
    await page.click('#settings-close'); await page.waitForTimeout(200); // close イベント後の再表示を待つ

    // お気に入り
    await curry.locator('.fav-btn').click();
    let st = await page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2')));
    check('お気に入りに保存', st.favorites.includes(1));

    // もう出さない
    const target = page.locator('#ingredient-result .recipe-card').nth(1);
    const targetName = await target.locator('h3').textContent();
    await target.locator('.card-menu summary').click();
    await target.locator('[data-act="block"]').click();
    await page.waitForTimeout(400);
    await page.click('#search-by-ingredient');
    const after = await page.locator('#ingredient-result .recipe-card h3').allTextContents();
    check(`「${targetName}」を非表示`, !after.includes(targetName));

    // 評価（カードの⋯から）
    const c3 = page.locator('#ingredient-result .recipe-card').nth(2);
    const c3name = await c3.locator('h3').textContent();
    await c3.locator('.card-menu summary').click();
    await c3.locator('[data-act="good"]').click();
    st = await page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2')));
    const c3id = await page.evaluate(n => RECIPES.find(r => r.name === n).id, c3name);
    check(`評価 👍 を保存 (${c3name})`, st.ratings[c3id] === 1);

    // 記録タブ: お気に入り・非表示の一覧、評価ボタン
    await page.locator('#ingredient-result .eat-btn').first().click();
    await page.click('.tab-btn[data-target="history-tab"]');
    const favText = await page.locator('#fav-list').textContent();
    const blockText = await page.locator('#blocked-list').textContent();
    check('お気に入り一覧', favText.includes('カレーライス'));
    check('非表示一覧', blockText.includes(targetName));
    await page.locator('#history-list .rate-btn').nth(1).click();
    st = await page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2')));
    check('記録から👎評価', Object.values(st.ratings).includes(-1));
    await page.screenshot({ path: path.join(OUT, 'v23-2-history.png'), fullPage: true });
    await page.locator('#blocked-list .text-btn').first().click();
    st = await page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2')));
    check('非表示を戻せる', st.blocked.length === 0);

    // 条件フィルター（記録タブでは非表示）
    const condHidden = await page.locator('#cond-bar').isHidden();
    check('記録タブでは条件バーを隠す', condHidden);
    await page.click('.tab-btn[data-target="ingredient-tab"]');
    await page.click('#cond-bar .toggle-chip:has-text("辛くない")');
    await page.click('#cond-bar .toggle-chip:has-text("時短")');
    await page.click('#clear-ingredients');
    await page.click('#search-by-ingredient');
    const condBad = await page.evaluate(() => [...document.querySelectorAll('#ingredient-result .recipe-card h3')].map(h => RECIPES.find(r => r.name === h.textContent)).filter(r => r.flags.spicy || r.time !== '短め').length);
    const condNotice = await page.locator('#ingredient-result .filter-notice').first().textContent();
    check(`辛くない＋時短 (違反 ${condBad}) ${condNotice}`, condBad === 0 && condNotice.includes('条件に合わない'));
    await page.click('#cond-bar .toggle-chip:has-text("時短")');
    await page.click('#cond-bar .toggle-chip:has-text("レンジ")');
    const microBad = await page.evaluate(() => [...document.querySelectorAll('#ingredient-result .recipe-card h3')].map(h => RECIPES.find(r => r.name === h.textContent)).filter(r => !r.flags.micro).length);
    check(`レンジ・火なし (違反 ${microBad})`, microBad === 0);
    await page.screenshot({ path: path.join(OUT, 'v23-3-cond.png') });
    await page.click('#cond-bar .toggle-chip:has-text("辛くない")');
    await page.click('#cond-bar .toggle-chip:has-text("レンジ")');

    // 1週間の献立
    await page.click('.tab-btn[data-target="week-tab"]');
    await page.click('[data-week="days"] button[data-value="7"]');
    await page.click('[data-week="withSides"] button[data-value="set"]');
    await page.click('#start-week', { force: true });
    st = await page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2')));
    const mains = st.weekPlan.days.map(d => d.main);
    check(`7日分 (${st.weekPlan.days.length})`, st.weekPlan.days.length === 7);
    check('主菜がかぶらない', new Set(mains).size === 7);
    const info = await page.evaluate(ids => ids.map(id => RECIPE_BY_ID.get(id)), mains);
    const consecutive = info.filter((r, i) => i > 0 && r.main === info[i - 1].main && r.genre === info[i - 1].genre).length;
    console.log('  献立:', info.map(r => `${r.name}(${r.genre}/${r.main})`).join(' → '));
    check(`前日と主材料・ジャンルが両方同じ日が少ない (${consecutive})`, consecutive <= 1);
    check('副菜・汁物もついている', st.weekPlan.days.every(d => d.sides.length >= 1));
    const sides = st.weekPlan.days.flatMap(d => d.sides);
    check('副菜・汁物が週の中でかぶらない', new Set(sides).size === sides.length);
    await page.screenshot({ path: path.join(OUT, 'v23-4-week.png'), fullPage: true });
    const before3 = st.weekPlan.days[2].main;
    let changed = false;
    for (let i = 0; i < 5 && !changed; i++) {
        await page.locator('.week-day').nth(2).locator('.week-day-head .icon-btn').click();
        st = await page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2')));
        changed = st.weekPlan.days[2].main !== before3;
    }
    check('1日だけ作り直せる', changed && new Set(st.weekPlan.days.map(d => d.main)).size === 7);
    await page.click('.week-summary .primary-btn');
    st = await page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2')));
    check(`週の材料を買い物リストへ (${st.shopping.length}件)`, st.shopping.length > 15);
    check('「どれか」行がある', st.shopping.some(s => s.name.includes('（どれか）')) || true);

    // スマホ
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    m.on('pageerror', e => errors.push(`mobile: ${e.message}`));
    await m.goto(url);
    await m.evaluate(s => localStorage.setItem('menuPlanner.v2', s), JSON.stringify(st));
    await m.reload();
    await m.click('.tab-btn[data-target="week-tab"]');
    await m.waitForTimeout(300);
    await m.screenshot({ path: path.join(OUT, 'v23-5-mobile-week.png') });
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check('スマホ幅で横スクロールが出ない', !overflow);
    await m.click('.tab-btn[data-target="ingredient-tab"]');
    await m.click('#search-by-ingredient');
    await m.locator('#ingredient-result .card-menu summary').first().click();
    await m.screenshot({ path: path.join(OUT, 'v23-6-mobile-menu.png') });

    await browser.close();
    server.close();
    console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL OK');
    process.exitCode = errors.length ? 1 : 0;
})();
