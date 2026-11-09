// すべてのテストを順に実行する（1つでも失敗したら終了コード 1）
//   ブラウザのテストは Playwright の Chromium を使う。
//   手元の Chrome を使う場合は環境変数 CHROME_PATH にパスを入れる。
const { spawnSync } = require('child_process');
const path = require('path');

const tests = ['data.test.js', 'e2e-basic.js', 'e2e-v21.js', 'e2e-v23.js', 'e2e-v24.js'];
const only = process.argv.slice(2);
const failed = [];

for (const t of tests) {
    if (only.length && !only.some(o => t.includes(o))) continue;
    console.log(`\n===== ${t} =====`);
    const r = spawnSync(process.execPath, [path.join(__dirname, t)], { stdio: 'inherit' });
    if (r.status !== 0) failed.push(t);
}

console.log(failed.length ? `\n失敗: ${failed.join(', ')}` : '\nすべてのテストが通りました');
process.exitCode = failed.length ? 1 : 0;
