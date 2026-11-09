// 献立メーカーの動作確認（ローカルサーバーを立てて Chrome で操作）
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
    const f = path.join(ROOT, p);
    fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
        res.end(data);
    });
});

(async () => {
    await new Promise(r => server.listen(0, r));
    const url = `http://localhost:${server.address().port}/`;
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
    const errors = [];
    const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) errors.push(label); };

    for (const vp of [{ name: 'desktop', width: 1000, height: 900 }, { name: 'mobile', width: 375, height: 800 }]) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        page.on('dialog', d => d.accept().catch(() => { }));
        page.on('pageerror', e => errors.push(`[${vp.name}] pageerror: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') errors.push(`[${vp.name}] console: ${m.text()}`); });
        await page.goto(url);
        await page.waitForSelector('.ingredient-tag');

        if (vp.name === 'desktop') {
            // 1. 材料検索
            await page.click('.ingredient-tag:text-is("鶏肉")');
            await page.click('#search-by-ingredient');
            const n = await page.locator('#ingredient-result .recipe-card').count();
            check(`材料検索で結果が出る (${n}件表示)`, n > 0 && n <= 24);
            await page.screenshot({ path: path.join(OUT, `1-ingredient.png`), fullPage: false });

            // 「食べた！」で記録
            const firstName = await page.locator('#ingredient-result .recipe-card h3').first().textContent();
            await page.locator('#ingredient-result .eat-btn').first().click();
            const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('menuPlanner.v2')));
            check(`食べた！で記録される (${firstName})`, stored.history.length === 1);

            // 再検索で除外される（デフォルト3日）
            await page.click('#search-by-ingredient');
            const names = await page.locator('#ingredient-result .recipe-card h3').allTextContents();
            const notice = await page.locator('#ingredient-result .filter-notice').textContent().catch(() => '');
            check(`最近食べた料理が除外される: ${notice}`, !names.includes(firstName) && notice.includes('最近食べた'));

            // 2. 設定: 卵・小麦アレルギー
            await page.click('#open-settings'); await page.evaluate(() => document.querySelectorAll('#settings-dialog details').forEach(d => d.open = true));
            await page.click('#allergen-options button:text-is("卵")');
            await page.click('#allergen-options button:text-is("小麦")');
            await page.fill('#dislike-input', 'パクチー');
            await page.click('#dislike-add');
            await page.click('[data-setting="minor"] button[data-value="never"]');
            await page.screenshot({ path: path.join(OUT, `2-settings.png`) });
            await page.click('#settings-close'); await page.waitForTimeout(200); // close イベント後の再表示を待つ
            const allergenOk = await page.evaluate(() => {
                const s = JSON.parse(localStorage.getItem('menuPlanner.v2')).settings;
                return s.allergens.join(',') + '|' + s.dislikes.join(',') + '|' + s.minor;
            });
            check(`設定が保存される (${allergenOk})`, allergenOk === 'egg,wheat|パクチー|never');
            // 結果が再計算され、卵・小麦の料理が無い
            const shown = await page.evaluate(() => [...document.querySelectorAll('#ingredient-result .recipe-card h3')].map(h => h.textContent));
            const bad = await page.evaluate(names => names.filter(n => {
                const r = RECIPES.find(x => x.name === n);
                return r.allergens.includes('egg') || r.allergens.includes('wheat') || r.pop === 3;
            }), shown);
            check(`アレルギー・マイナー料理が出ない (違反 ${bad.length})`, bad.length === 0 && shown.length > 0);

            // 3. ランダム（何回か回して違反が無いか）
            await page.click('.tab-btn[data-target="random-tab"]');
            let randomBad = 0;
            for (let i = 0; i < 5; i++) {
                await page.click('#start-random', { force: true });
                await page.waitForSelector('#random-result .recipe-card', { timeout: 5000 });
                const nm = await page.locator('#random-result .recipe-card h3').textContent();
                randomBad += await page.evaluate(n => { const r = RECIPES.find(x => x.name === n); return (r.allergens.includes('egg') || r.allergens.includes('wheat')) ? 1 : 0; }, nm);
                await page.waitForFunction(() => !document.getElementById('start-random').disabled);
            }
            check('ランダムでアレルギー料理が出ない', randomBad === 0);
            await page.screenshot({ path: path.join(OUT, `3-random.png`) });

            // 4. 質問
            await page.click('.tab-btn[data-target="question-tab"]');
            for (const label of ['がっつり食べたい！🥩', 'なんでもいい！', '魚介 🐟', 'じっくり長くてもOK🍳']) {
                await page.click(`.answer-btn:text-is("${label}")`);
            }
            const qn = await page.locator('#question-result .recipe-card').count();
            const hint = await page.locator('#question-result').textContent(); check(`質問で結果 or 0件ヒント (${qn})`, qn > 0 || hint.includes('調味料は除く'));

            // 記録を数件追加してからひらめき
            await page.evaluate(() => {
                const today = new Date();
                const ds = d => { const x = new Date(today); x.setDate(x.getDate() - d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
                const st = JSON.parse(localStorage.getItem('menuPlanner.v2'));
                [[1, 6], [1, 60], [2, 7], [2, 61], [3, 1], [4, 6], [5, 263]].forEach(([d, id]) => st.history.push({ id, date: ds(d) }));
                localStorage.setItem('menuPlanner.v2', JSON.stringify(st));
            });
            await page.reload();
            await page.click('.tab-btn[data-target="inspire-tab"]');
            const summary = await page.locator('#inspire-summary').textContent();
            check(`ひらめきの傾向表示: ${summary.trim()}`, summary.includes('肉'));
            await page.click('#start-inspire', { force: true });
            const reasons = await page.locator('#inspire-result .reason-chip').allTextContents();
            check(`ひらめきが3件・理由つき: ${reasons.join(' / ')}`, reasons.length === 3);
            await page.screenshot({ path: path.join(OUT, `4-inspire.png`), fullPage: true });

            // 献立セット
            await page.locator('#inspire-result .set-btn').first().click();
            const setCount = await page.locator('#set-body .recipe-card').count();
            check(`献立セットが出る (${setCount}枚)`, setCount >= 2);
            await page.screenshot({ path: path.join(OUT, `5-set.png`) });
            await page.click('#set-reroll');
            await page.click('#set-close');

            // 記録タブ
            await page.click('.tab-btn[data-target="history-tab"]');
            const rows = await page.locator('.balance-row').count();
            check(`栄養バランスが表示される (${rows}行)`, rows === 6);
            await page.fill('#history-input', 'カレーライス');
            await page.click('#history-add');
            const items = await page.locator('.history-day li').count();
            check(`手動で記録できる (${items}件)`, items >= 9);
            await page.screenshot({ path: path.join(OUT, `6-history.png`), fullPage: true });
        } else {
            await page.screenshot({ path: path.join(OUT, `m1-top.png`) });
            await page.click('.tab-btn[data-target="inspire-tab"]');
            await page.click('#start-inspire', { force: true });
            await page.screenshot({ path: path.join(OUT, `m2-inspire.png`), fullPage: true });
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
            check('スマホ幅で横スクロールが出ない', !overflow);
            await page.click('#open-settings'); await page.evaluate(() => document.querySelectorAll('#settings-dialog details').forEach(d => d.open = true));
            await page.screenshot({ path: path.join(OUT, `m3-settings.png`) });
        }
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL OK');
    process.exitCode = errors.length ? 1 : 0;
})();
