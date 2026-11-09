// =====================================================================
// data.js / data-extra.js の recipes に meta.js の情報を足して、
// アプリで使う RECIPES を作る
// =====================================================================

const MAIN_CATEGORIES = {
    meat: { label: '肉', icon: '🍖' },
    fish: { label: '魚介', icon: '🐟' },
    eggsoy: { label: '卵・大豆', icon: '🥚' },
    veg: { label: '野菜・その他', icon: '🥕' },
};

const MEAT_INGS = new Set(MEAT_LIST);
const SEAFOOD_INGS = new Set(SEAFOOD_LIST);
const EGGSOY_INGS = new Set([...EGGSOY_LIST, ...CHEESE_LIST.filter(c => c !== 'チーズ' && c !== '粉チーズ' && c !== 'パルメザンチーズ')]);

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
            else if (SEAFOOD_INGS.has(i)) fish++;
            else if (EGGSOY_INGS.has(i)) eggsoy += (i === '卵' ? 0.5 : 1);
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

    /** 料理そのもの（材料・料理名）から分かるアレルゲン */
    function mainAllergens(name, ings) {
        return ALLERGENS.filter(a => {
            const byIng = ings.some(i => a.ings.includes(i));
            const byName = a.name && a.name.test(name) && !(a.nameExclude && a.nameExclude.test(name));
            return byIng || byName;
        }).map(a => a.key);
    }

    /** 調味料に含まれやすいアレルゲン（料理そのものに含まれるものは除く） */
    function seasoningAllergens(r, main) {
        const found = new Set();
        r.ingredients.forEach(i => (SEASONING_ALLERGENS[i] || []).forEach(k => found.add(k)));
        SEASONING_RULES.forEach(rule => { if (rule.test(r)) rule.keys.forEach(k => found.add(k)); });
        main.forEach(k => found.delete(k));
        // 並び順を ALLERGENS に合わせる
        return ALLERGENS.map(a => a.key).filter(k => found.has(k));
    }

    return recipes
        .filter(r => !DUPLICATE_IDS.has(r.id) && (r.meta || meta[r.id]))
        .map(r => {
            const m = r.meta || meta[r.id];
            const ingredients = [...new Set(r.ingredients.map(i => INGREDIENT_ALIAS[i] || i))];
            const base = {
                id: r.id,
                name: r.name,
                ingredients,
                genre: genreFix[r.id] || r.genre,
                type: TYPE_FIX[r.id] || r.type,
                time: r.time,
                pop: m.pop,
                diff: m.diff,
                role: m.role,
                kcal: m.kcal,
            };
            base.main = mainCategory(ingredients);
            base.nutrients = nutrientLevels(ingredients, m.role);
            base.allergens = mainAllergens(r.name, ingredients);
            base.seasoningAllergens = seasoningAllergens(base, base.allergens);
            return base;
        });
})();

const RECIPE_BY_ID = new Map(RECIPES.map(r => [r.id, r]));
const ALLERGEN_BY_KEY = new Map(ALLERGENS.map(a => [a.key, a]));
const ALL_INGREDIENTS = [...new Set(RECIPES.flatMap(r => r.ingredients))];
