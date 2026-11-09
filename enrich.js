// =====================================================================
// data.js の recipes に meta.js の情報を足して、アプリで使う RECIPES を作る
// =====================================================================

const MAIN_CATEGORIES = {
    meat: { label: '肉', icon: '🍖' },
    fish: { label: '魚介', icon: '🐟' },
    eggsoy: { label: '卵・大豆', icon: '🥚' },
    veg: { label: '野菜・その他', icon: '🥕' },
};

const MEAT_INGS = new Set(['豚肉', '牛肉', '鶏肉', 'ひき肉', 'ラム肉', '馬肉', '牛もつ', '豚もつ', '牛すじ', 'チャーシュー',
    'ベーコン', 'ウインナー', 'ソーセージ', 'ハム', '生ハム', 'チョリソー', 'サラミ', '豚バラ', '手羽先', '手羽元', '手羽中',
    'レバー', 'つくね', '照り焼きチキン', 'ハンバーグ', 'とんかつ']);
const EGGSOY_INGS = new Set(['卵', '温玉', 'ピータン', '豆腐', '厚揚げ', '油揚げ', '大豆', '納豆', '豆乳', 'おから', '枝豆',
    'そら豆', '茶豆', 'モッツァレラチーズ', 'ゴルゴンゾーラチーズ', 'カマンベール', 'ブルーチーズ', 'チェダーチーズ',
    'クリームチーズ']);
const SEAFOOD_INGS = new Set(['鮭', 'サーモン', 'サバ', 'アジ', 'マグロ', '白身魚', 'ぶり', '鯛', 'カツオ', 'カレイ', '金目鯛',
    '赤魚', 'サワラ', '銀だら', '舌平目', 'ホッケ', 'にしん', 'さんま', 'あゆ', 'うなぎ', 'ししゃも', 'イワシ', 'えんがわ', 'ふぐ',
    'あんこう', 'タラ', 'ハマチ', 'エビ', 'イカ', 'タコ', 'アサリ', 'はまぐり', 'しじみ', 'カキ', 'ホタテ', 'カニ', 'しらす',
    '明太子', 'たらこ', 'ツナ', 'ちくわ', 'スモークサーモン', '白身魚のフライ', '魚のあら', 'イカ天', 'クラゲ', 'タラの胃袋',
    'サメ軟骨']);

const RECIPES = (() => {
    const meta = {};
    RECIPE_META_TEXT.trim().split('\n').forEach(line => {
        const [id, pop, diff, role, kcal] = line.trim().split(/\s+/);
        meta[id] = { pop: +pop, diff: +diff, role, kcal: +kcal };
    });

    const genreFix = {};
    Object.entries(GENRE_FIX).forEach(([genre, ids]) => ids.forEach(id => { genreFix[id] = genre; }));

    const sources = {};
    Object.entries(NUTRIENT_SOURCES).forEach(([k, list]) => { sources[k] = new Set(list); });

    function mainCategory(ings) {
        let meat = 0, fish = 0, eggsoy = 0;
        ings.forEach(i => {
            if (MEAT_INGS.has(i)) meat++;
            else if (EGGSOY_INGS.has(i)) eggsoy += (i === '卵' ? 0.5 : 1);
            else if (SEAFOOD_INGS.has(i)) fish++;
        });
        if (meat === 0 && fish === 0 && eggsoy === 0) return 'veg';
        if (fish > meat) return 'fish';
        if (meat > 0) return 'meat';
        if (fish > 0) return 'fish';
        return 'eggsoy';
    }

    function nutrientLevels(ings, role) {
        const levels = {};
        NUTRIENTS.forEach(n => {
            let score = 0;
            ings.forEach(i => {
                if (sources[n.key].has(i)) score += GARNISH.has(i) ? 0.5 : 1;
            });
            levels[n.key] = score >= 2 ? 2 : score >= 0.5 ? 1 : 0;
        });
        if (role === 'M') levels.carb = 2;
        return levels;
    }

    function allergensOf(name, ings) {
        const found = [];
        ALLERGENS.forEach(a => {
            const byIng = ings.some(i => a.ings.includes(i));
            const byName = a.name && a.name.test(name) && !(a.nameExclude && a.nameExclude.test(name));
            if (byIng || byName) found.push(a.key);
        });
        return found;
    }

    return recipes
        .filter(r => !DUPLICATE_IDS.has(r.id) && meta[r.id])
        .map(r => {
            const m = meta[r.id];
            const ingredients = [...new Set(r.ingredients.map(i => INGREDIENT_ALIAS[i] || i))];
            return {
                ...r,
                ingredients,
                genre: genreFix[r.id] || r.genre,
                type: TYPE_FIX[r.id] || r.type,
                pop: m.pop,
                diff: m.diff,
                role: m.role,
                kcal: m.kcal,
                main: mainCategory(ingredients),
                nutrients: nutrientLevels(ingredients, m.role),
                allergens: allergensOf(r.name, ingredients),
            };
        });
})();

const RECIPE_BY_ID = new Map(RECIPES.map(r => [r.id, r]));
const ALLERGEN_BY_KEY = new Map(ALLERGENS.map(a => [a.key, a]));
