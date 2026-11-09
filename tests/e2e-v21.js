// v2.1.0 の新機能の動作確認
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

    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto(url);
    await page.waitForSelector('.ingredient-tag');

    // バージョン表示
    const footer = await page.locator('.app-footer').textContent();
    check(`フッターにバージョン: ${footer.trim()}`, /v2\.\d+\.\d+/.test(footer) && /料理 \d{3} 品/.test(footer));

    // 材料グループ（新しい材料が分類されている）
    const groups = await page.locator('.cat-chip').allTextContents();
    check(`材料グループ: ${groups.join(' / ')}`, groups.includes('果物・ナッツ') && groups.includes('調味料'));
    await page.click('.cat-chip:text("その他")');
    const otherCount = await page.locator('#ingredient-list .ingredient-tag').count();
    check(`「その他」に残る材料は少ない (${otherCount}個)`, otherCount < 40);
    await page.fill('#ingredient-filter', 'きのこ');
    const found = await page.locator('#ingredient-list .ingredient-tag').allTextContents();
    check(`材料検索: ${found.join(',')}`, found.includes('きのこ類'));
    await page.click('#ingredient-list .ingredient-tag:text-is("きのこ類")');
    const chips = await page.locator('#selected-chips .selected-chip').count();
    check('選んだ材料がバーに出る', chips === 1);
    await page.click('#clear-ingredients');
    await page.fill('#ingredient-filter', '');

    // アレルギー項目数
    await page.click('#open-settings'); await page.evaluate(() => document.querySelectorAll('#settings-dialog details').forEach(d => d.open = true));
    const allergenCount = await page.locator('#allergen-options button').count();
    check(`アレルギー項目数 ${allergenCount}`, allergenCount >= 30);

    // 調味料の扱い：大豆アレルギーで「含めて」と「除く」の件数比較
    await page.click('#allergen-options button:text-is("大豆")');
    await page.click('[data-setting="allergenScope"] button[data-value="all"]');
    await page.click('#settings-close'); await page.waitForTimeout(200); // close イベント後の再表示を待つ
    await page.click('#search-by-ingredient');
    const countAll = await page.evaluate(() => parseInt(document.querySelector('#ingredient-result .result-count').textContent));
    const badAll = await page.evaluate(() => [...document.querySelectorAll('#ingredient-result .recipe-card h3')].map(h => RECIPES.find(r => r.name === h.textContent)).filter(r => r.allergens.includes('soy') || r.seasoningAllergens.includes('soy')).length);
    await page.click('#open-settings'); await page.evaluate(() => document.querySelectorAll('#settings-dialog details').forEach(d => d.open = true));
    await page.click('[data-setting="allergenScope"] button[data-value="main"]');
    await page.click('#settings-close'); await page.waitForTimeout(200); // close イベント後の再表示を待つ
    const countMain = await page.evaluate(() => parseInt(document.querySelector('#ingredient-result .result-count').textContent));
    const badMain = await page.evaluate(() => [...document.querySelectorAll('#ingredient-result .recipe-card h3')].map(h => RECIPES.find(r => r.name === h.textContent)).filter(r => r.allergens.includes('soy')).length);
    check(`大豆: 調味料含む ${countAll}品 / 調味料除く ${countMain}品（違反 ${badAll}/${badMain}）`, countMain > countAll && badAll === 0 && badMain === 0);
    await page.screenshot({ path: path.join(OUT, 'v21-1-search.png') });

    // 人数とレシピ検索のURL
    await page.click('#open-settings'); await page.evaluate(() => document.querySelectorAll('#settings-dialog details').forEach(d => d.open = true));
    await page.click('[data-setting="servings"] button[data-value="4"]');
    await page.screenshot({ path: path.join(OUT, 'v21-2-settings.png'), fullPage: true });
    await page.click('#settings-close'); await page.waitForTimeout(200); // close イベント後の再表示を待つ
    const href = await page.locator('#ingredient-result .search-recipe-btn').first().getAttribute('href');
    check('レシピ検索に人数が入る', decodeURIComponent(href).includes('4人分'));

    // 買い物リスト
    await page.locator('#ingredient-result .shop-btn').first().click();
    const badge = await page.locator('#shopping-badge').textContent();
    check(`買い物バッジ: ${badge}`, Number(badge) > 0);
    await page.click('#open-shopping');
    const shopItems = await page.locator('#shopping-body li').count();
    check(`買い物リストに材料 (${shopItems})`, shopItems > 0);
    await page.locator('#shopping-body li input[type=checkbox]').first().check();
    await page.screenshot({ path: path.join(OUT, 'v21-3-shopping.png') });
    await page.click('#shopping-clear-checked');
    const after = await page.locator('#shopping-body li').count();
    check('チェック済みを消せる', after === shopItems - 1);
    await page.click('#shopping-close');

    // 献立セットから買い物リスト
    await page.locator('#ingredient-result .set-btn').first().click();
    await page.click('#set-body button:text("材料を買い物リストへ")');
    const total = await page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2')).shopping.length);
    check(`献立セットの材料も追加 (${total})`, total > after);
    await page.click('#set-close');

    // バックアップ書き出し → 消す → 読み込み
    await page.click('#open-settings'); await page.evaluate(() => document.querySelectorAll('#settings-dialog details').forEach(d => d.open = true));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backup-export')]);
    const file = path.join(OUT, 'backup.json');
    await download.saveAs(file);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    check(`バックアップの中身 (servings=${backup.settings.servings}, shopping=${backup.shopping.length})`, backup.app === 'menu-planner' && backup.settings.servings === 4);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('#open-settings'); await page.evaluate(() => document.querySelectorAll('#settings-dialog details').forEach(d => d.open = true));
    page.once('dialog', d => d.accept());
    await page.setInputFiles('#backup-file', file);
    await page.waitForTimeout(500);
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2')));
    check('バックアップを読み込める', restored && restored.settings.servings === 4 && restored.shopping.length === backup.shopping.length);

    // ダークモード
    await page.click('[data-setting="theme"] button[data-value="dark"]');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(`ダークモードで背景が暗い (${bg})`, bg === 'rgb(21, 17, 14)');
    await page.click('#settings-close'); await page.waitForTimeout(200); // close イベント後の再表示を待つ
    await page.click('#search-by-ingredient');
    await page.screenshot({ path: path.join(OUT, 'v21-4-dark.png') });
    await page.locator('#ingredient-result .set-btn').first().click();
    await page.screenshot({ path: path.join(OUT, 'v21-5-dark-set.png') });
    await page.click('#set-close');
    await page.reload();
    const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check('再読み込み後もダークのまま', themeAttr === 'dark');

    // スマホ幅（ダーク）
    const m = await browser.newPage({ viewport: { width: 375, height: 800 } });
    m.on('pageerror', e => errors.push(`mobile pageerror: ${e.message}`));
    await m.goto(url);
    await m.evaluate(() => localStorage.setItem('menuPlanner.v2', JSON.stringify({ settings: { theme: 'dark' } })));
    await m.reload();
    await m.waitForSelector('.ingredient-tag');
    await m.click('#open-settings'); await m.evaluate(() => document.querySelectorAll('#settings-dialog details').forEach(d => d.open = true));
    await m.screenshot({ path: path.join(OUT, 'v21-6-mobile-settings.png') });
    await m.click('#settings-close'); await m.waitForTimeout(200);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check('スマホ幅で横スクロールが出ない', !overflow);
    await m.screenshot({ path: path.join(OUT, 'v21-7-mobile-top.png'), fullPage: false });

    await browser.close();
    server.close();
    console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL OK');
    process.exitCode = errors.length ? 1 : 0;
})();
