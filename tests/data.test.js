// =====================================================================
// データの検査（ブラウザなしで動く）
//   料理データ・注釈・アレルギー判定などが壊れていないかを確かめる。
//   料理を追加・修正したら `npm test` で実行する。
// =====================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const files = ['data.js', 'data-extra.js', 'meta.js', 'enrich.js'];
const code = files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
    + '\n;({ RECIPES, ALLERGENS, ALT_GROUPS, MINCE_MAP, PFC_TEXT, recipes, DUPLICATE_IDS });';
const { RECIPES, ALLERGENS, ALT_GROUPS, MINCE_MAP, PFC_TEXT, recipes, DUPLICATE_IDS } = vm.runInNewContext(code, {});

let failed = 0;
function check(label, cond, detail = '') {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${!cond && detail ? `\n     ${detail}` : ''}`);
    if (!cond) failed++;
}
const byName = name => RECIPES.find(r => r.name === name);

// --- 基本の形 -----------------------------------------------------------
check(`料理数 ${RECIPES.length} 品`, RECIPES.length >= 600);

const ids = new Set();
const dupIds = RECIPES.filter(r => ids.size === ids.add(r.id).size).map(r => r.id);
check('id が重複していない', dupIds.length === 0, dupIds.join(','));

const names = new Set();
const dupNames = RECIPES.filter(r => names.size === names.add(r.name).size).map(r => r.name);
check('料理名が重複していない', dupNames.length === 0, dupNames.join(','));

const missingMeta = recipes.filter(r => !DUPLICATE_IDS.has(r.id) && !RECIPES.some(x => x.id === r.id)).map(r => `${r.id}:${r.name}`);
check('すべての料理に注釈（定番度・手間・役割・kcal）がある', missingMeta.length === 0, missingMeta.join(', '));

const badMeta = RECIPES.filter(r => ![1, 2, 3].includes(r.pop) || ![1, 2, 3].includes(r.diff)
    || !['M', 'K', 'F', 'S', 'N', 'T'].includes(r.role) || !(r.kcal > 0)
    || !['和食', '洋食', '中華', '韓国', 'エスニック'].includes(r.genre)
    || !['短め', '普通', '長め'].includes(r.time) || !['がっつり', '普通', 'あっさり'].includes(r.type));
check('注釈の値が正しい範囲', badMeta.length === 0, badMeta.map(r => r.name).join(', '));

const empty = RECIPES.filter(r => r.ingredients.length + r.alternatives.length === 0);
check('材料が空の料理がない', empty.length === 0, empty.map(r => r.name).join(', '));

// --- どれか1つ・ひき肉 --------------------------------------------------
const recipeIds = new Set(RECIPES.map(r => r.id));
const badAltIds = [...Object.keys(ALT_GROUPS), ...Object.keys(MINCE_MAP)].filter(id => !recipeIds.has(Number(id)));
check('「どれか1つ」・ひき肉の指定が存在する料理を指している', badAltIds.length === 0, badAltIds.join(','));

const overlap = RECIPES.filter(r => r.alternatives.some(g => g.some(i => r.ingredients.includes(i)) || g.length < 2));
check('「どれか1つ」の材料が必須材料と重なっていない', overlap.length === 0, overlap.map(r => r.name).join(', '));

const generic = RECIPES.filter(r => r.allIngs.includes('ひき肉'));
check('種類のわからない「ひき肉」が残っていない', generic.length === 0, generic.map(r => r.name).join(', '));

// --- PFC -------------------------------------------------------------
const pfcIds = PFC_TEXT.trim().split('\n').map(l => Number(l.trim().split(/\s+/)[0]));
const badPfcIds = pfcIds.filter(id => !recipeIds.has(id));
check('PFC の指定が存在する料理を指している', badPfcIds.length === 0, badPfcIds.join(','));
const badPfc = RECIPES.filter(r => r.pfc && (4 * r.pfc.p + 9 * r.pfc.f > r.kcal + 5 || r.pfc.c < 0));
check('PFC がカロリーと矛盾しない', badPfc.length === 0, badPfc.map(r => `${r.name}(${JSON.stringify(r.pfc)} ${r.kcal}kcal)`).join(', '));

// --- アレルギー判定（過去に直した誤判定が戻っていないか） ------------------
const has = (name, key) => byName(name).allergens.includes(key);
const maybe = (name, key) => byName(name).optionalAllergens.includes(key);
const cases = [
    ['とんかつ に小麦', has('とんかつ', 'wheat')],
    ['エビフライ に卵・小麦・えび', has('エビフライ', 'egg') && has('エビフライ', 'wheat') && has('エビフライ', 'shrimp')],
    ['ざるそば にそば', has('ざるそば', 'buckwheat')],
    ['焼きそば にそばが付かない', !has('焼きそば', 'buckwheat')],
    ['ドライカレー にいかが付かない', !has('ドライカレー', 'squid')],
    ['杏仁豆腐 に大豆が付かない', !has('杏仁豆腐', 'soy')],
    ['豆腐ステーキ に牛肉が付かない', !has('豆腐ステーキ', 'beef')],
    ['タコライス・タコス にたこが付かない', !has('タコライス', 'octopus') && !has('タコス', 'octopus')],
    ['フライドポテト に卵・小麦が付かない', !has('フライドポテト', 'egg') && !has('フライドポテト', 'wheat')],
    ['いなり寿司 に魚が付かない', !has('いなり寿司', 'fish')],
    ['アジの南蛮漬け に卵が付かない', !has('アジの南蛮漬け', 'egg')],
    ['カレーライスの肉は「選ぶ材料による」', !has('カレーライス', 'beef') && maybe('カレーライス', 'beef') && maybe('カレーライス', 'chicken')],
    ['餃子は豚肉（必ず）', has('餃子', 'pork') && !has('餃子', 'beef') && !maybe('餃子', 'beef')],
    ['寄せ鍋は鶏肉・豚肉とも必ず', has('寄せ鍋', 'chicken') && has('寄せ鍋', 'pork')],
    ['冷奴の醤油（小麦）は調味料扱い', !has('冷奴', 'wheat') && byName('冷奴').seasoningAllergens.includes('wheat')],
    ['キムチは調味料にえび・魚', byName('キムチ').seasoningAllergens.includes('shrimp')],
];
cases.forEach(([label, ok]) => check(`アレルギー: ${label}`, ok));

const allergenKeys = new Set(ALLERGENS.map(a => a.key));
const badKeys = RECIPES.filter(r => [...r.allergens, ...r.optionalAllergens, ...r.seasoningAllergens].some(k => !allergenKeys.has(k)));
check('アレルゲンのキーがすべて定義済み', badKeys.length === 0, badKeys.map(r => r.name).join(', '));
check('アレルギー項目が30以上', ALLERGENS.length >= 30);

// --- 条件フィルター -------------------------------------------------------
check('麻婆豆腐は辛い', byName('麻婆豆腐').flags.spicy);
check('「甘辛」「塩辛」は辛い扱いにしない', !byName('豚こまの甘辛炒め').flags.spicy && !byName('イカの塩辛').flags.spicy);
check('冷奴はレンジ・火なし', byName('冷奴').flags.micro);
check('とんかつはレンジ・火なしではない', !byName('とんかつ').flags.micro);
check('ステーキは節約ではない', !byName('ステーキ').flags.cheap);
check('もやしのナムルは節約', byName('もやしのナムル').flags.cheap);

console.log(failed ? `\n${failed} 件失敗` : '\nALL OK');
process.exitCode = failed ? 1 : 0;
