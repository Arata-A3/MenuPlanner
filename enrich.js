// =====================================================================
// data.js / data-extra.js の recipes に meta.js の情報を足して、
// アプリで使う RECIPES を作る
//
// 料理の材料は次の2種類に分かれる
//   ingredients  : 必ず使う材料
//   alternatives : 「どれか1つあればよい」材料のグループ（例: [['豚肉','牛肉','鶏肉']]）
//   allIngs      : 上の2つを合わせた全部の材料（検索・表示用）
// =====================================================================

const MAIN_CATEGORIES = {
    meat: { label: '肉', icon: 'meat' },
    fish: { label: '魚介', icon: 'fish' },
    eggsoy: { label: '卵・大豆', icon: 'egg' },
    veg: { label: '野菜・その他', icon: 'carrot' },
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

    const pfcMap = {};
    PFC_TEXT.trim().split('\n').forEach(line => {
        const [id, p, f] = line.trim().split(/\s+/).map(Number);
        pfcMap[id] = { p, f };
    });

    const genreFix = {};
    Object.entries(GENRE_FIX).forEach(([genre, ids]) => ids.forEach(id => { genreFix[id] = genre; }));

    const sources = {};
    Object.entries(NUTRIENT_SOURCES).forEach(([k, list]) => { sources[k] = new Set(list); });

    /** 材料リストを「必ず使う」と「どれか1つ」に分ける */
    function splitIngredients(r) {
        let required = [...new Set(r.ingredients.map(i => INGREDIENT_ALIAS[i] || i))];
        const alternatives = [];

        // ひき肉 → 種類のはっきりしたひき肉に（一緒に書かれていた豚肉・牛肉・鶏肉はひき肉の種類を表していた）
        if (required.includes('ひき肉')) {
            const kind = MINCE_MAP[r.id] || '合いびき肉';
            required = required.filter(i => !['ひき肉', '豚肉', '牛肉', '鶏肉'].includes(i));
            if (Array.isArray(kind)) alternatives.push(kind);
            else required.push(kind);
        }

        (ALT_GROUPS[r.id] || []).forEach(group => {
            const opts = group.filter(i => required.includes(i));
            if (opts.length >= 2) {
                required = required.filter(i => !opts.includes(i));
                alternatives.push(opts);
            }
        });
        return { required, alternatives };
    }

    function mainCategory(required, alternatives) {
        const ings = [...required, ...alternatives.map(g => g[0])];
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

    function nutrientLevels(required, alternatives, role) {
        const levels = {};
        const weight = (key, i) => (sources[key].has(i) ? (GARNISH.has(i) ? 0.5 : 1) : 0);
        NUTRIENTS.forEach(n => {
            let score = 0;
            required.forEach(i => { score += weight(n.key, i); });
            // 「どれか1つ」は1つの材料として数える
            alternatives.forEach(g => { score += Math.max(...g.map(i => weight(n.key, i))); });
            levels[n.key] = score >= 2 ? 2 : score >= 0.5 ? 1 : 0;
        });
        if (role === 'M') levels.carb = 2;
        return levels;
    }

    const ingAllergens = list => ALLERGENS.filter(a => list.some(i => a.ings.includes(i))).map(a => a.key);
    const nameAllergens = name => ALLERGENS
        .filter(a => a.name && a.name.test(name) && !(a.nameExclude && a.nameExclude.test(name)))
        .map(a => a.key);

    /** 必ず含むアレルゲンと、選ぶ材料によって含むアレルゲン */
    function allergensOf(name, required, alternatives) {
        const must = new Set([...ingAllergens(required), ...nameAllergens(name)]);
        const maybe = new Set();
        alternatives.forEach(g => {
            const per = g.map(i => new Set(ingAllergens([i])));
            const union = new Set(per.flatMap(s => [...s]));
            union.forEach(k => {
                if (per.every(s => s.has(k))) must.add(k);
                else maybe.add(k);
            });
        });
        must.forEach(k => maybe.delete(k));
        const order = ALLERGENS.map(a => a.key);
        return { must: order.filter(k => must.has(k)), maybe: order.filter(k => maybe.has(k)) };
    }

    /** 調味料に含まれやすいアレルゲン（料理そのものに含まれるものは除く） */
    function seasoningAllergens(r, exclude) {
        const found = new Set();
        r.allIngs.forEach(i => (SEASONING_ALLERGENS[i] || []).forEach(k => found.add(k)));
        SEASONING_RULES.forEach(rule => { if (rule.test(r)) rule.keys.forEach(k => found.add(k)); });
        exclude.forEach(k => found.delete(k));
        return ALLERGENS.map(a => a.key).filter(k => found.has(k));
    }

    function flagsOf(name, required, alternatives, allIngs) {
        const spicy = SPICY_NAME.test(name) || allIngs.some(i => SPICY_INGS.includes(i));
        const micro = MICRO_NAME.test(name) && !MICRO_EXCLUDE.test(name);
        const mainIngs = required.filter(i => !OPTIONAL_INGS.has(i) && !(i in SEASONING_ALLERGENS));
        const cheap = !EXPENSIVE_NAME.test(name)
            && required.every(i => !EXPENSIVE_INGS.has(i))
            && alternatives.every(g => g.some(i => !EXPENSIVE_INGS.has(i)))
            && mainIngs.length + alternatives.length <= 7;
        return { spicy, micro, cheap };
    }

    return recipes
        .filter(r => !DUPLICATE_IDS.has(r.id) && (r.meta || meta[r.id]))
        .map(r => {
            const m = r.meta || meta[r.id];
            const { required, alternatives } = splitIngredients(r);
            const allIngs = [...required, ...alternatives.flat()];
            const base = {
                id: r.id,
                name: r.name,
                ingredients: required,
                alternatives,
                allIngs,
                genre: genreFix[r.id] || r.genre,
                type: TYPE_FIX[r.id] || r.type,
                time: r.time,
                pop: m.pop,
                diff: m.diff,
                role: m.role,
                kcal: m.kcal,
            };
            base.main = mainCategory(required, alternatives);
            base.nutrients = nutrientLevels(required, alternatives, m.role);
            const al = allergensOf(r.name, required, alternatives);
            base.allergens = al.must;
            base.optionalAllergens = al.maybe;
            base.seasoningAllergens = seasoningAllergens(base, [...al.must, ...al.maybe]);
            base.flags = flagsOf(r.name, required, alternatives, allIngs);
            const pfc = pfcMap[r.id];
            base.pfc = pfc ? { p: pfc.p, f: pfc.f, c: Math.max(0, Math.round((m.kcal - 4 * pfc.p - 9 * pfc.f) / 4)) } : null;
            return base;
        });
})();

const RECIPE_BY_ID = new Map(RECIPES.map(r => [r.id, r]));
const ALLERGEN_BY_KEY = new Map(ALLERGENS.map(a => [a.key, a]));
const ALL_INGREDIENTS = [...new Set(RECIPES.flatMap(r => r.allIngs))];

// 材料のよく使われる度合い（定番の料理で使われるほど高い）。材料選択で上に並べるのに使う
const INGREDIENT_SCORE = (() => {
    const score = {};
    const w = { 1: 3, 2: 2, 3: 1 };
    RECIPES.forEach(r => r.allIngs.forEach(i => { score[i] = (score[i] || 0) + w[r.pop]; }));
    return score;
})();

// 実質同じ料理のなかま（DISH_FAMILIES）。id → なかまの id 一覧
const FAMILY_IDS = (() => {
    const byName = new Map(RECIPES.map(r => [r.name, r]));
    const map = new Map();
    Object.entries(DISH_FAMILIES).forEach(([key, names]) => {
        const members = names.map(n => byName.get(n)).filter(Boolean);
        members.forEach(r => { r.family = key; map.set(r.id, members.map(m => m.id)); });
    });
    return map;
})();

/** なかまの id 一覧（なかまがいなければ自分だけ） */
const familyIds = id => FAMILY_IDS.get(id) || [id];
const familySize = id => familyIds(id).length;
const sameFamily = (a, b) => a === b || familyIds(a).includes(b);
