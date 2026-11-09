// =====================================================================
// v2.7.0: 具違いの料理（〜おにぎり など）を1品として扱う
// =====================================================================
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || path.join(__dirname, '..');
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

let failed = 0;
function check(label, cond) {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`);
    if (!cond) failed++;
}

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://localhost:${server.address().port}/`;
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on('pageerror', e => { console.log('PAGE ERROR', e.message); failed++; });
    await page.goto(url);

    // 材料検索: ご飯で探すと、おにぎりのなかまは1枚にまとまる
    await page.evaluate(() => localStorage.setItem('menuPlanner.seenVersion', APP_VERSION));
    await page.reload();
    await page.waitForSelector('.ingredient-tag');
    await page.fill('#ingredient-filter', 'ご飯');
    await page.click('.ingredient-tag:text-is("ご飯")');
    await page.click('#search-by-ingredient');
    const allNames = await page.evaluate(async () => {
        const out = [];
        for (;;) {
            const more = document.querySelector('#ingredient-result .more-btn');
            if (!more) break;
            more.click();
        }
        document.querySelectorAll('#ingredient-result .recipe-card h3').forEach(h => out.push(h.textContent));
        return out;
    });
    const ONIGIRI = ['おにぎり', '梅おにぎり', '鮭おにぎり', 'ツナマヨおにぎり', '昆布おにぎり', '明太子おにぎり'];
    const onigiri = allNames.filter(n => ONIGIRI.includes(n));
    check(`おにぎりのなかまは1枚だけ (${onigiri.join(',')})`, onigiri.length === 1);
    const variants = await page.locator('#ingredient-result .variants').first().textContent().catch(() => '');
    check(`ほかの具を表示: ${variants}`, variants.includes('ほかの具・味'));

    // 鮭おにぎりを食べたら、梅おにぎりも「最近食べた」で出ない
    const r = await page.evaluate(() => {
        const sake = RECIPES.find(x => x.name === '鮭おにぎり');
        const ume = RECIPES.find(x => x.name === '梅おにぎり');
        state.history.push({ id: sake.id, date: dateStr() });
        const eaten = lastEatenDays();
        const { ok } = applyFilters([ume]);
        // 重み: なかま全体で1品ぶん
        const w = RECIPES.filter(x => x.family === 'うどん').reduce((s, x) => s + baseWeight(x), 0);
        const single = baseWeight(RECIPES.find(x => x.name === 'カレーうどん'));
        return { umeEaten: eaten.has(ume.id), umeOk: ok.length, udonFamilyWeight: w, single };
    });
    check('鮭おにぎりを食べたら梅おにぎりも最近食べた扱い', r.umeEaten && r.umeOk === 0);
    check(`うどんのなかま全体の出やすさが1品程度 (${r.udonFamilyWeight.toFixed(2)})`, r.udonFamilyWeight <= 1.5);

    // 1週間の献立に同じなかまが2回出ない
    const dup = await page.evaluate(() => {
        let bad = 0;
        for (let t = 0; t < 30; t++) {
            const plan = [];
            const pool = RECIPES.filter(x => MAIN_DISH_ROLES.includes(x.role));
            for (let i = 0; i < 7; i++) plan[i] = pickPlanDay(plan, i, addDays(dateStr(), i), pool);
            const fams = plan.map(d => RECIPE_BY_ID.get(d.main).family).filter(Boolean);
            if (new Set(fams).size !== fams.length) bad++;
        }
        return bad;
    });
    check(`1週間の献立でなかまがかぶらない (30回中 ${dup} 回)`, dup === 0);

    await browser.close();
    server.close();
    console.log(failed ? `\n${failed} 件失敗` : '\nALL OK');
    process.exitCode = failed ? 1 : 0;
})();
