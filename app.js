// =====================================================================
// 今日の献立メーカー  メインスクリプト
// 依存: data.js → meta.js → enrich.js の順で読み込まれていること
// =====================================================================

// ---------------------------------------------------------------------
// 保存データ（設定と食事の記録）
// ---------------------------------------------------------------------
const APP_VERSION = '2.5.0';
const APP_UPDATED = '2026-11-10';

const STORE_KEY = 'menuPlanner.v2';
const DEFAULT_SETTINGS = {
    allergens: [],          // ALLERGENS の key
    allergenScope: 'all',   // all = 調味料に含まれやすいものも除外 / main = 料理そのものだけで判定
    dislikes: [],           // 苦手な食材（部分一致）
    recentDays: 3,          // この日数以内に食べた料理は出さない（0 = 除外しない）
    minor: 'rare',          // マイナーな料理: never / rare / normal
    hard: 'rare',           // 手間のかかる料理: never / rare / normal
    servings: 2,            // 何人分作るか
    theme: 'auto',          // auto / light / dark
    conditions: [],         // 条件フィルター: mild / micro / cheap / quick
};

/** 読み込んだデータを、壊れた値が混ざっていても使える形に整える */
function normalizeState(parsed) {
    const settings = { ...DEFAULT_SETTINGS, ...(parsed && parsed.settings ? parsed.settings : {}) };
    if (!Array.isArray(settings.allergens)) settings.allergens = [];
    settings.allergens = settings.allergens.filter(k => ALLERGEN_BY_KEY.has(k));
    if (!Array.isArray(settings.dislikes)) settings.dislikes = [];
    settings.dislikes = settings.dislikes.filter(w => typeof w === 'string' && w);
    const history = Array.isArray(parsed && parsed.history)
        ? parsed.history.filter(h => h && RECIPE_BY_ID.has(h.id) && /^\d{4}-\d{2}-\d{2}$/.test(h.date))
        : [];
    const shopping = Array.isArray(parsed && parsed.shopping)
        ? parsed.shopping.filter(s => s && typeof s.name === 'string').map(s => ({
            name: s.name, from: Array.isArray(s.from) ? s.from.filter(f => typeof f === 'string') : [], checked: !!s.checked,
        }))
        : [];
    if (!Array.isArray(settings.conditions)) settings.conditions = [];
    settings.conditions = settings.conditions.filter(k => CONDITIONS.some(c => c.key === k));
    const ids = list => (Array.isArray(list) ? [...new Set(list.filter(id => RECIPE_BY_ID.has(id)))] : []);
    const favorites = ids(parsed && parsed.favorites);
    const blocked = ids(parsed && parsed.blocked);
    const ratings = {};
    if (parsed && parsed.ratings && typeof parsed.ratings === 'object') {
        Object.entries(parsed.ratings).forEach(([id, v]) => {
            if (RECIPE_BY_ID.has(Number(id)) && (v === 1 || v === -1)) ratings[id] = v;
        });
    }
    let weekPlan = null;
    const wp = parsed && parsed.weekPlan;
    if (wp && Array.isArray(wp.days)) {
        const days = wp.days.filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && RECIPE_BY_ID.has(d.main))
            .map(d => ({ date: d.date, main: d.main, sides: ids(d.sides) }));
        if (days.length) weekPlan = { withSides: !!wp.withSides, days };
    }
    // 冷蔵庫の中身（材料タブで選んだ材料）。urgent = 早めに使いたい
    const fridge = Array.isArray(parsed && parsed.fridge)
        ? parsed.fridge.filter(f => f && ALL_INGREDIENTS.includes(f.name))
            .map(f => ({ name: f.name, urgent: !!f.urgent, added: /^\d{4}-\d{2}-\d{2}$/.test(f.added) ? f.added : null }))
        : [];
    return { settings, history, shopping, favorites, blocked, ratings, weekPlan, fridge };
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) return normalizeState(JSON.parse(raw));
    } catch (e) { /* 読めなければ初期状態で動かす */ }
    return normalizeState(null);
}

const state = loadState();

function saveState() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* 保存できない環境（プライベートモード等）でも動作は続ける */ }
}

// ---------------------------------------------------------------------
// 小さな道具
// ---------------------------------------------------------------------
function esc(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysSince(str) {
    const [y, m, d] = str.split('-').map(Number);
    const then = new Date(y, m - 1, d);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((now - then) / 86400000);
}

function formatDate(str) {
    const n = daysSince(str);
    if (n === 0) return '今日';
    if (n === 1) return '昨日';
    if (n === 2) return 'おととい';
    const [, m, d] = str.split('-').map(Number);
    const wd = '日月火水木金土'[new Date(str.replace(/-/g, '/')).getDay()];
    return `${m}/${d}(${wd})`;
}

function weightedPick(items, weightFn) {
    const weights = items.map(weightFn);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
    }
    return items[items.length - 1];
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ---------------------------------------------------------------------
// 絞り込みと重み
// ---------------------------------------------------------------------
const POP_WEIGHT = { never: [1, 0.7, 0], rare: [1, 0.55, 0.12], normal: [1, 0.9, 0.6] };
const DIFF_WEIGHT = { never: [1, 1, 0], rare: [1, 0.85, 0.25], normal: [1, 1, 0.8] };

/** 設定（マイナー・手間）だけで決まる重み。0 なら「出さない」 */
function settingWeight(r) {
    return POP_WEIGHT[state.settings.minor][r.pop - 1] * DIFF_WEIGHT[state.settings.hard][r.diff - 1];
}

/** 提案のしやすさ（お気に入り・評価も反映） */
function baseWeight(r) {
    let w = settingWeight(r);
    if (r.role === 'T') w *= 0.3; // おつまみ・軽食は控えめに
    if (isFavorite(r.id)) w *= 1.8;
    const rating = state.ratings[r.id];
    if (rating === 1) w *= 1.5;
    if (rating === -1) w *= 0.35;
    return w;
}

const isFavorite = id => state.favorites.includes(id);
const isBlocked = id => state.blocked.includes(id);

function meetsConditions(r) {
    return state.settings.conditions.every(c => {
        if (c === 'mild') return !r.flags.spicy;
        if (c === 'micro') return r.flags.micro;
        if (c === 'cheap') return r.flags.cheap;
        if (c === 'quick') return r.time === '短め';
        return true;
    });
}

function lastEatenDays() {
    const map = new Map();
    state.history.forEach(h => {
        const n = daysSince(h.date);
        if (!map.has(h.id) || map.get(h.id) > n) map.set(h.id, n);
    });
    return map;
}

/** 苦手な食材を使う料理か（「どれか1つ」の材料は、全部が苦手なときだけ） */
function matchesDislike(r) {
    return state.settings.dislikes.some(w => r.name.includes(w)
        || r.ingredients.some(i => i.includes(w))
        || r.alternatives.some(g => g.every(i => i.includes(w))));
}

/** 設定に引っかかる理由を返す（問題なければ null） */
function hitsAllergy(r) {
    const mine = state.settings.allergens;
    if (mine.length === 0) return false;
    if (r.allergens.some(a => mine.includes(a))) return true;
    return state.settings.allergenScope === 'all' && r.seasoningAllergens.some(a => mine.includes(a));
}

function exclusionReason(r, eaten) {
    if (hitsAllergy(r)) return 'allergy';
    if (isBlocked(r.id)) return 'blocked';
    if (matchesDislike(r)) return 'dislike';
    if (!meetsConditions(r)) return 'condition';
    const days = state.settings.recentDays;
    if (days > 0 && eaten.has(r.id) && eaten.get(r.id) < days) return 'recent';
    if (settingWeight(r) === 0) return 'setting';
    return null;
}

/** 設定で除外される料理を取り除き、除外件数も返す */
function applyFilters(list) {
    const eaten = lastEatenDays();
    const counts = { allergy: 0, blocked: 0, dislike: 0, condition: 0, recent: 0, setting: 0 };
    const ok = [];
    list.forEach(r => {
        const reason = exclusionReason(r, eaten);
        if (reason) counts[reason]++;
        else ok.push(r);
    });
    return { ok, counts };
}

function exclusionNotice(counts) {
    const parts = [];
    if (counts.allergy) parts.push(`アレルギー${state.settings.allergenScope === 'all' ? '（調味料含む）' : ''} ${counts.allergy}品`);
    if (counts.blocked) parts.push(`非表示にした料理 ${counts.blocked}品`);
    if (counts.dislike) parts.push(`苦手な食材 ${counts.dislike}品`);
    if (counts.condition) parts.push(`条件に合わない料理 ${counts.condition}品`);
    if (counts.recent) parts.push(`最近食べた料理 ${counts.recent}品`);
    if (counts.setting) parts.push(`マイナー・手間のかかる料理 ${counts.setting}品`);
    return parts.length ? `設定により ${parts.join('、')} を除外しています` : '';
}

/** 結果が0件のときのヒント */
function emptyHint(counts) {
    if (counts.allergy && state.settings.allergenScope === 'all') {
        return '醤油・だしなど調味料に含まれやすいものまで除外しています。設定の「調味料の扱い」を「調味料は除く」にすると候補が増えます（アレルギー対応の調味料を使う場合など）。';
    }
    if (counts.condition) return '上の条件（辛くない・レンジ・節約・時短）を外すと候補が増えます。';
    if (counts.setting) return '設定の「マイナーな料理」「手間のかかる料理」を「たまに」以上にすると候補が増えます。';
    if (counts.recent) return '設定の「最近食べた料理を除外」の日数を短くすると候補が増えます。';
    return '';
}

// ---------------------------------------------------------------------
// 季節
// ---------------------------------------------------------------------
const SEASONS = [
    { months: [3, 4, 5], label: '春', ings: ['たけのこ', 'アスパラ', 'そら豆', 'グリーンピース', 'キャベツ', 'アサリ', '鯛', '山菜', 'せり', '三つ葉'] },
    { months: [6, 7, 8], label: '夏', ings: ['トマト', 'ナス', 'きゅうり', 'ゴーヤ', 'ピーマン', '枝豆', 'コーン', 'アジ', 'うなぎ', 'あゆ', '大葉', 'ズッキーニ', 'パプリカ'] },
    { months: [9, 10, 11], label: '秋', ings: ['さんま', '鮭', 'きのこ類', 'しいたけ', 'まいたけ', 'えのき', 'なめこ', '松茸', '栗', 'さつまいも', '里芋', 'かぼちゃ', 'れんこん', 'ごぼう', 'サバ'] },
    { months: [12, 1, 2], label: '冬', ings: ['白菜', '大根', 'ほうれん草', '小松菜', 'ぶり', 'カキ', 'タラ', 'カニ', 'ふぐ', 'あんこう', 'ねぎ'] },
];
const COLD_MONTHS = [11, 12, 1, 2, 3];
const HOT_MONTHS = [6, 7, 8, 9];
const WARM_DISH = /鍋|おでん|シチュー|グラタン|ポタージュ|雑炊|ふろふき|ぶり大根|豚汁|けんちん|粕汁|チゲ|クッパ|角煮|煮込み/;
const COOL_DISH = /冷やし|冷奴|ざる|冷しゃぶ|冷製|カルパッチョ|マリネ|酢の物|もずく|サラダ|ゴーヤ|ガパオ|タコライス/;

function seasonInfo(r) {
    const month = new Date().getMonth() + 1;
    const season = SEASONS.find(s => s.months.includes(month));
    const seasonal = r.allIngs.find(i => season.ings.includes(i) && i !== 'ねぎ' && i !== 'キャベツ');
    if (COLD_MONTHS.includes(month)) {
        if (WARM_DISH.test(r.name) || r.role === 'N') return { factor: 1.5, reason: '寒い日にあったまる' };
        if (/冷やし|冷奴|ざる|冷しゃぶ|冷製|冷麺|ビビン麺|そうめん|冷や汁|ガスパチョ|ビシソワーズ|ポキ/.test(r.name)) return { factor: 0.3, reason: null };
    }
    if (HOT_MONTHS.includes(month)) {
        if (COOL_DISH.test(r.name)) return { factor: 1.5, reason: '暑い日にさっぱり' };
        if (r.role === 'N' || WARM_DISH.test(r.name)) return { factor: 0.4, reason: null };
    }
    if (seasonal) return { factor: 1.4, reason: `旬の${seasonal}を使う（${season.label}）` };
    return { factor: 1, reason: null };
}

// ---------------------------------------------------------------------
// 栄養バランス
// ---------------------------------------------------------------------
// 「記録した日」1日あたりの目標スコア（料理ごとの 0〜2 の合計で見る）
// 夕食の主菜だけを記録する人も多いので、控えめな目標にしている
const DAILY_TARGET = { protein: 2, carb: 2, veg: 2, fiber: 1.5, calcium: 1, iron: 1 };

/** 直近 days 日の記録から栄養の足り具合を見積もる。記録が少なければ null */
function recentBalance(days = 7) {
    const entries = state.history.filter(h => daysSince(h.date) < days);
    if (entries.length < 2) return null;
    const byDay = new Map();
    entries.forEach(h => {
        if (!byDay.has(h.date)) byDay.set(h.date, []);
        byDay.get(h.date).push(RECIPE_BY_ID.get(h.id));
    });
    const dayCount = byDay.size;
    const ratios = {};
    NUTRIENTS.forEach(n => {
        let total = 0;
        byDay.forEach(list => list.forEach(r => { total += r.nutrients[n.key]; }));
        ratios[n.key] = (total / dayCount) / DAILY_TARGET[n.key];
    });
    const lacking = NUTRIENTS
        .filter(n => n.key !== 'carb' && ratios[n.key] < 0.6)
        .sort((a, b) => ratios[a.key] - ratios[b.key])
        .map(n => n.key);
    return { ratios, lacking, dayCount, entryCount: entries.length };
}

/** 直近の記録で偏っているジャンル・主材料 */
function recentTrend(limit = 10) {
    const recent = [...state.history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
        .map(h => RECIPE_BY_ID.get(h.id));
    if (recent.length < 3) return null;
    const top = key => {
        const c = {};
        recent.forEach(r => { c[r[key]] = (c[r[key]] || 0) + 1; });
        const [name, count] = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
        return count / recent.length >= 0.5 ? name : null;
    };
    const topGenre = top('genre');
    const topMain = top('main');
    if (!topGenre && !topMain) return null;
    return { topGenre, topMain };
}

// ---------------------------------------------------------------------
// レシピカード
// ---------------------------------------------------------------------
function nutrientChips(r) {
    return NUTRIENTS
        .filter(n => r.nutrients[n.key] > 0)
        .map(n => `<span class="nutri-chip lv${r.nutrients[n.key]}" title="${n.label}${r.nutrients[n.key] === 2 ? '（多め）' : ''}">${icon(n.icon)}${n.short}${r.nutrients[n.key] === 2 ? '◎' : ''}</span>`)
        .join('');
}

function allergenLine(r) {
    if (r.allergens.length === 0 && r.optionalAllergens.length === 0 && r.seasoningAllergens.length === 0) return '';
    const mine = state.settings.allergens;
    const fmt = keys => keys.map(k => {
        const label = ALLERGEN_BY_KEY.get(k).label;
        return mine.includes(k) ? `<strong>${label}</strong>` : label;
    }).join('・');
    const main = r.allergens.length ? `<span class="allergen-main">${icon('warning')}${fmt(r.allergens)}</span>` : '';
    const optional = r.optionalAllergens.length
        ? `<span class="optional-allergens" title="「どれか1つ」の材料の選び方で変わります">選ぶ材料による: ${fmt(r.optionalAllergens)}</span>`
        : '';
    const seasoning = r.seasoningAllergens.length
        ? `<span class="seasoning-allergens">調味料: ${fmt(r.seasoningAllergens)}</span>`
        : '';
    return `<p class="recipe-allergens">${main}${optional}${seasoning}</p>`;
}

function difficultyStars(diff) {
    return `<span class="pips" aria-label="手間 ${diff}/3">${[1, 2, 3].map(i => `<i class="${i <= diff ? 'on' : ''}"></i>`).join('')}</span>`;
}

function isEatenToday(id) {
    const today = dateStr();
    return state.history.some(h => h.id === id && h.date === today);
}

/** 材料の表示（「どれか1つ」は「豚肉 / 牛肉 / 鶏肉 のどれか」） */
function ingredientText(r) {
    const parts = r.ingredients.map(esc);
    r.alternatives.forEach(g => parts.push(`<span class="alt-ing">${g.map(esc).join(' / ')} のどれか</span>`));
    return parts.join('、');
}

function pfcText(pfc) {
    return `P ${pfc.p}g・F ${pfc.f}g・C ${pfc.c}g`;
}

function toggleFavorite(id) {
    if (isFavorite(id)) state.favorites = state.favorites.filter(x => x !== id);
    else state.favorites.push(id);
    saveState();
}

function setRating(id, value) {
    if (state.ratings[id] === value) delete state.ratings[id];
    else state.ratings[id] = value;
    saveState();
}

function blockRecipe(id) {
    if (!isBlocked(id)) state.blocked.push(id);
    state.favorites = state.favorites.filter(x => x !== id);
    saveState();
}

function unblockRecipe(id) {
    state.blocked = state.blocked.filter(x => x !== id);
    saveState();
}

function createRecipeCard(recipe, opts = {}) {
    const card = document.createElement('article');
    card.className = 'recipe-card' + (opts.compact ? ' compact' : '');
    card.dataset.id = recipe.id;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${recipe.name} レシピ ${state.settings.servings}人分`)}`;
    const eaten = isEatenToday(recipe.id);
    const canMakeSet = ['K', 'M', 'N'].includes(recipe.role) && !opts.noSet;
    const fav = isFavorite(recipe.id);
    const rating = state.ratings[recipe.id];
    const meta = [
        `<span class="role-dot role-${recipe.role}"></span>${ROLE_LABELS[recipe.role]}`,
        recipe.genre,
        `${icon('clock')}${recipe.time}`,
        `<span title="手間">手間${difficultyStars(recipe.diff)}</span>`,
    ];
    if (recipe.flags.spicy) meta.push(`<span class="flag spicy" title="辛い料理">${icon('chili')}辛い</span>`);
    if (recipe.flags.micro) meta.push(`<span class="flag" title="レンジ・火なしで作れる目安">${icon('microwave')}レンジ</span>`);
    if (recipe.pop === 3) meta.push('<span class="rare">レア</span>');
    if (rating === 1) meta.push(`<span class="flag good" title="おいしかった">${icon('thumb-up')}</span>`);
    if (rating === -1) meta.push(`<span class="flag bad" title="いまいち">${icon('thumb-down')}</span>`);

    card.innerHTML = `
        ${opts.reason ? `<div class="reason-chip">${opts.reason.icon ? icon(opts.reason.icon) : ''}${esc(opts.reason.text || opts.reason)}</div>` : ''}
        <div class="card-head">
            <h3>${esc(recipe.name)}</h3>
            <span class="kcal" title="1人前の目安${recipe.role === 'K' ? '（ご飯別）' : ''}">${recipe.kcal}<small>kcal</small></span>
            <button class="fav-btn${fav ? ' on' : ''}" aria-pressed="${fav}" title="お気に入り" aria-label="お気に入り">${icon('star', fav ? 'fill' : '')}</button>
            <details class="card-menu">
                <summary title="その他の操作" aria-label="その他の操作">${icon('dots')}</summary>
                <div class="card-menu-list">
                    <button data-act="good" class="${rating === 1 ? 'on' : ''}">${icon('thumb-up')}おいしかった${rating === 1 ? icon('check', 'end') : ''}</button>
                    <button data-act="bad" class="${rating === -1 ? 'on' : ''}">${icon('thumb-down')}いまいち${rating === -1 ? icon('check', 'end') : ''}</button>
                    <button data-act="block">${icon('ban')}もう出さない</button>
                </div>
            </details>
        </div>
        <p class="card-meta">${meta.join('<span class="sep">·</span>')}</p>
        ${recipe.pfc ? `<p class="pfc" title="たんぱく質・脂質・炭水化物（1人前の目安）">${pfcText(recipe.pfc)}</p>` : ''}
        ${opts.matchInfo ? `<p class="match-info ${opts.matchInfo.ok ? 'ok' : ''}">${opts.matchInfo.ok ? icon('check') : ''}${esc(opts.matchInfo.text)}${opts.matchInfo.urgent ? `<span class="urgent-note">${icon('alarm')}${esc(opts.matchInfo.urgent)}</span>` : ''}</p>` : ''}
        <div class="nutri-row">${nutrientChips(recipe)}</div>
        ${allergenLine(recipe)}
        ${opts.compact ? '' : `<details class="card-ings"><summary>材料（${recipe.ingredients.length + recipe.alternatives.length}）</summary><p>${ingredientText(recipe)}</p></details>`}
        <div class="card-actions">
            <a href="${searchUrl}" target="_blank" rel="noopener noreferrer" class="act search-recipe-btn" title="レシピを検索"><span class="act-icon">${icon('search')}</span><span>レシピ</span></a>
            <button class="act eat-btn" ${eaten ? 'disabled' : ''} title="今日食べた料理として記録"><span class="act-icon">${icon(eaten ? 'check' : 'utensils')}</span><span class="eat-label">${eaten ? '記録済み' : '食べた'}</span></button>
            ${canMakeSet ? `<button class="act set-btn" title="副菜・汁物を組み合わせる"><span class="act-icon">${icon('tray')}</span><span>献立</span></button>` : ''}
            <button class="act shop-btn" title="材料を買い物リストに追加"><span class="act-icon">${icon('cart')}</span><span>買う</span></button>
        </div>
    `;
    card.querySelector('.shop-btn').addEventListener('click', () => addToShopping([recipe]));

    const favBtn = card.querySelector('.fav-btn');
    favBtn.addEventListener('click', () => {
        toggleFavorite(recipe.id);
        const on = isFavorite(recipe.id);
        favBtn.classList.toggle('on', on);
        favBtn.innerHTML = icon('star', on ? 'fill' : '');
        favBtn.setAttribute('aria-pressed', String(on));
        showToast(on ? `「${recipe.name}」をお気に入りにしました` : 'お気に入りから外しました');
    });

    const menu = card.querySelector('.card-menu');
    menu.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
        menu.open = false;
        const act = b.dataset.act;
        if (act === 'block') {
            blockRecipe(recipe.id);
            card.classList.add('removed');
            setTimeout(() => card.remove(), 250);
            showToast(`「${recipe.name}」はもう出しません（記録タブで戻せます）`);
            return;
        }
        setRating(recipe.id, act === 'good' ? 1 : -1);
        const replaced = createRecipeCard(recipe, opts);
        card.replaceWith(replaced);
        const v = state.ratings[recipe.id];
        showToast(v === 1 ? 'おいしかった料理は出やすくなります' : v === -1 ? 'いまいちだった料理は出にくくなります' : '評価を取り消しました');
    }));

    const eatBtn = card.querySelector('.eat-btn');
    eatBtn.addEventListener('click', () => {
        addHistory(recipe.id, dateStr());
        eatBtn.disabled = true;
        eatBtn.querySelector('.act-icon').innerHTML = icon('check');
        eatBtn.querySelector('.eat-label').textContent = '記録済み';
        showToast(`「${recipe.name}」を記録しました。⋯ から評価もできます`);
    });
    if (canMakeSet) {
        card.querySelector('.set-btn').addEventListener('click', () => openSetDialog(recipe));
    }
    return card;
}

// 開いている ⋯ メニューは、外側をタップしたら閉じる
document.addEventListener('click', e => {
    document.querySelectorAll('.card-menu[open]').forEach(m => { if (!m.contains(e.target)) m.open = false; });
});

// スマホでは一度に出す枚数を少なめに
const PAGE_SIZE = window.matchMedia('(max-width: 600px)').matches ? 12 : 24;

/** 料理リストを表示（多いときは「もっと見る」で追加表示） */
function renderRecipes(recipesArray, container, opts = {}) {
    if (typeof container === 'string') container = document.getElementById(container);
    container.innerHTML = '';

    if (opts.notice) {
        const p = document.createElement('p');
        p.className = 'filter-notice';
        p.textContent = opts.notice;
        container.appendChild(p);
    }
    if (opts.header) container.appendChild(opts.header);

    if (recipesArray.length === 0) {
        const p = document.createElement('p');
        p.className = 'empty-msg';
        p.textContent = '当てはまる料理が見つかりませんでした';
        container.appendChild(p);
        if (opts.emptyHint) {
            const h = document.createElement('p');
            h.className = 'filter-notice';
            h.innerHTML = `${icon('bulb')}${esc(opts.emptyHint)}`;
            container.appendChild(h);
        }
        return;
    }

    const count = document.createElement('p');
    count.className = 'result-count';
    count.textContent = `${recipesArray.length} 品見つかりました`;
    container.appendChild(count);

    const grid = document.createElement('div');
    grid.className = 'recipe-cards';
    container.appendChild(grid);

    let shown = 0;
    const more = document.createElement('button');
    more.className = 'secondary-btn more-btn';
    const showMore = () => {
        recipesArray.slice(shown, shown + PAGE_SIZE).forEach(r => {
            grid.appendChild(createRecipeCard(r, { matchInfo: opts.matchInfo ? opts.matchInfo(r) : null }));
        });
        shown += PAGE_SIZE;
        if (shown >= recipesArray.length) more.remove();
        else more.textContent = `もっと見る（残り ${recipesArray.length - shown} 品）`;
    };
    more.addEventListener('click', showMore);
    container.appendChild(more);
    showMore();
}

// ---------------------------------------------------------------------
// トースト
// ---------------------------------------------------------------------
let toastTimer = null;
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------------
// タブ切り替え
// ---------------------------------------------------------------------
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tabPanes.forEach(pane => pane.classList.remove('active'));
        document.getElementById(btn.dataset.target).classList.add('active');
        window.scrollTo({ top: 0 });
        document.body.dataset.tab = btn.dataset.target;
        if (btn.dataset.target === 'history-tab') renderHistory();
        if (btn.dataset.target === 'week-tab') renderWeek();
        if (btn.dataset.target === 'inspire-tab') renderInspireSummary();
    });
});

// ---------------------------------------------------------------------
// 1. 材料から探す
// ---------------------------------------------------------------------
// 家にあることが多い調味料（材料選択では「調味料」にまとめ、買い物リストでは別枠にする）
const PANTRY = ['塩', '胡椒', '黒胡椒', '砂糖', '醤油', '味噌', '白味噌', 'もろみ味噌', '酢', 'みりん', '酒', '白ワイン', 'ポン酢',
    'めんつゆ', 'わさび醤油', 'マヨネーズ', 'ケチャップ', 'ソース', 'タルタルソース', 'ホワイトソース', 'トマトソース',
    'デミグラスソース', 'オリーブオイル', 'ごま油', 'ラー油', 'バター', '出汁', 'コンソメ', '中華スープ', 'カレールー', 'カレー粉',
    'チリパウダー', '五香粉', 'シナモン', '豆板醤', 'コチュジャン', '甜麺醤', 'オイスターソース', 'ナンプラー', 'ごまだれ',
    'ドレッシング', 'ごまドレッシング', 'シーザードレッシング', '小麦粉', '片栗粉', 'パン粉', 'はちみつ', 'メープルシロップ', 'マスタード',
    'からし', 'わさび', '山椒', '唐辛子', 'タバスコ', '塩麹', '練りごま', 'ごま', '黒ごま', 'かつお節', '青のり', '天かす', '魚粉',
    '杏仁霜', 'ゼラチン', 'マーマレード', 'レモン', 'ライム'];
const PANTRY_SET = new Set(PANTRY);

const CATEGORY_ICONS = {
    'よく使う': 'star', '肉類': 'meat', '魚介類': 'fish', '野菜・きのこ': 'carrot', '卵・大豆・乳製品': 'egg',
    '主食・粉・麺': 'rice', '果物・ナッツ': 'apple', '調味料': 'bottle', 'その他': 'box',
};

const ingredientCategories = {
    '肉類': MEAT_LIST,
    '魚介類': SEAFOOD_LIST,
    '野菜・きのこ': ['キャベツ', '白菜', 'レタス', 'サニーレタス', 'ベビーリーフ', 'サンチュ', 'トマト', 'ピーマン', 'パプリカ', 'ししとう', 'ナス', '大根', 'かぶ', 'にんじん', '玉ねぎ', 'じゃがいも', 'さつまいも', '里芋', '長芋', 'とろろ', 'かぼちゃ', '冬瓜', 'ほうれん草', '小松菜', '春菊', '菜の花', 'チンゲン菜', '空芯菜', '豆苗', 'もやし', 'ブロッコリー', 'カリフラワー', 'アスパラ', 'いんげん', 'オクラ', 'ゴーヤ', 'ズッキーニ', 'アボカド', 'ビーツ', 'ごぼう', 'れんこん', 'たけのこ', 'ニラ', 'ねぎ', '生姜', 'にんにく', 'セロリ', 'きゅうり', '水菜', 'せり', '三つ葉', '大葉', 'パクチー', 'バジル', 'パセリ', 'ローズマリー', 'グリーンピース', 'コーン', '枝豆', 'そら豆', 'オリーブ', '切り干し大根', '山菜', 'ぜんまい', 'きのこ類', 'しいたけ', '干ししいたけ', 'しめじ', 'エリンギ', 'えのき', 'なめこ', 'まいたけ', 'マッシュルーム', '松茸', 'きくらげ'],
    '卵・大豆・乳製品': [...EGGSOY_LIST, ...CHEESE_LIST, '牛乳', '生クリーム', 'サワークリーム', 'ヨーグルト'],
    '主食・粉・麺': ['ご飯', '米', 'もち米', '餅', 'トック', 'オートミール', 'ホットケーキミックス', '白玉粉', '食パン', 'フランスパン', 'コッペパン', 'バンズ', 'イングリッシュマフィン', 'トルティーヤ', 'パイシート', 'ピザ生地', 'うどん', 'そうめん', 'ほうとう麺', 'そば', '茶そば', '中華麺', 'ちゃんぽん麺', 'インスタント麺', '冷麺', 'パスタ', 'マカロニ', 'ラザニア', '米麺', 'ビーフン', '春雨', '餃子の皮', 'シュウマイの皮', '春巻きの皮', 'ワンタンの皮', 'ライスペーパー', 'そば粉'],
    '果物・ナッツ': ['りんご', 'もも', 'オレンジ', 'バナナ', 'イチゴ', 'キウイ', 'メロン', 'イチジク', 'ブルーベリー', 'レーズン', '栗', 'あずき', 'アーモンド', 'カシューナッツ', 'マカダミアナッツ', 'くるみ', 'ピーナッツ', 'ナッツ', '松の実', 'ココナッツミルク', 'チョコレート'],
    '調味料': PANTRY,
    'その他': [],
};

const allIngredients = ALL_INGREDIENTS;
const ingredientContainer = document.getElementById('ingredient-list');
const ingredientCats = document.getElementById('ingredient-cats');
const ingredientFilter = document.getElementById('ingredient-filter');
const selectedChips = document.getElementById('selected-chips');
const searchIngBtn = document.getElementById('search-by-ingredient');
// 選んでいる材料 = 冷蔵庫の中身（保存して次回も残す）
const selectedIngredients = new Set(state.fridge.map(f => f.name));

function saveFridge() {
    const old = new Map(state.fridge.map(f => [f.name, f]));
    state.fridge = [...selectedIngredients].map(name => old.get(name) || { name, urgent: false, added: dateStr() });
    saveState();
}

const urgentIngredients = () => new Set(state.fridge.filter(f => f.urgent).map(f => f.name));

/** 冷蔵庫の材料（特に早めに使いたいもの）を使う料理ほど大きくなる倍率 */
function fridgeBoost(r) {
    if (state.fridge.length === 0) return 1;
    const urgent = urgentIngredients();
    const urgentHit = r.allIngs.filter(i => urgent.has(i)).length;
    const have = r.allIngs.filter(i => selectedIngredients.has(i) && !PANTRY_SET.has(i)).length;
    return (1 + 1.2 * Math.min(urgentHit, 2)) * (1 + 0.15 * Math.min(have, 4));
}

// カテゴリごとの材料（どのカテゴリにも入らないものは「その他」へ）
const ingredientGroups = (() => {
    const shown = new Set();
    const groups = [];
    Object.entries(ingredientCategories).forEach(([catName, list]) => {
        const items = catName === 'その他'
            ? allIngredients.filter(i => !shown.has(i))
            : [...new Set(list)].filter(i => allIngredients.includes(i) && !shown.has(i));
        items.forEach(i => shown.add(i));
        // よく使われる材料ほど上に
        items.sort((a, b) => (INGREDIENT_SCORE[b] || 0) - (INGREDIENT_SCORE[a] || 0));
        if (items.length) groups.push({ name: catName, items });
    });
    // 先頭に「よく使う」材料（調味料・薬味を除く）
    const popular = [...allIngredients]
        .filter(i => !PANTRY_SET.has(i) && !OPTIONAL_INGS.has(i))
        .sort((a, b) => (INGREDIENT_SCORE[b] || 0) - (INGREDIENT_SCORE[a] || 0))
        .slice(0, 36);
    groups.unshift({ name: 'よく使う', items: popular });
    return groups;
})();
let activeCategory = ingredientGroups[0].name;

function makeIngredientTag(ing) {
    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'ingredient-tag' + (selectedIngredients.has(ing) ? ' selected' : '');
    tag.textContent = ing;
    tag.setAttribute('aria-pressed', String(selectedIngredients.has(ing)));
    tag.addEventListener('click', () => toggleIngredient(ing));
    return tag;
}

function toggleIngredient(ing) {
    if (selectedIngredients.has(ing)) selectedIngredients.delete(ing);
    else selectedIngredients.add(ing);
    saveFridge();
    renderIngredientTags();
    renderSelectedChips();
}

function toggleUrgent(ing) {
    const f = state.fridge.find(x => x.name === ing);
    if (!f) return;
    f.urgent = !f.urgent;
    saveState();
    renderSelectedChips();
}

function renderIngredientCats() {
    ingredientCats.innerHTML = '';
    const searching = ingredientFilter.value.trim() !== '';
    ingredientGroups.forEach(g => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cat-chip' + (g.name === activeCategory && !searching ? ' active' : '');
        b.setAttribute('role', 'tab');
        const picked = g.items.filter(i => selectedIngredients.has(i)).length;
        b.innerHTML = `${icon(CATEGORY_ICONS[g.name] || 'box')}${esc(g.name)}${picked ? `<span class="cat-count">${picked}</span>` : ''}`;
        b.addEventListener('click', () => {
            activeCategory = g.name;
            ingredientFilter.value = '';
            renderIngredientTags();
        });
        ingredientCats.appendChild(b);
    });
}

function renderIngredientTags() {
    const q = ingredientFilter.value.trim();
    const items = q
        ? allIngredients.filter(i => i.includes(q)).sort((a, b) => (INGREDIENT_SCORE[b] || 0) - (INGREDIENT_SCORE[a] || 0))
        : ingredientGroups.find(g => g.name === activeCategory).items;
    ingredientContainer.innerHTML = '';
    if (items.length === 0) {
        ingredientContainer.innerHTML = '<p class="muted small">見つかりませんでした</p>';
    }
    items.forEach(ing => ingredientContainer.appendChild(makeIngredientTag(ing)));
    renderIngredientCats();
}

function renderSelectedChips() {
    selectedChips.innerHTML = '';
    if (selectedIngredients.size === 0) {
        selectedChips.innerHTML = `<span class="muted small hint">${icon('fridge')}冷蔵庫にある材料をタップ（選んだ材料は次回も残ります）</span>`;
    }
    const urgent = urgentIngredients();
    // 早めに使いたい材料を先に並べる
    [...selectedIngredients].sort((a, b) => urgent.has(b) - urgent.has(a)).forEach(ing => {
        const chip = document.createElement('span');
        chip.className = 'selected-chip' + (urgent.has(ing) ? ' urgent' : '');
        const u = document.createElement('button');
        u.type = 'button';
        u.className = 'urgent-btn';
        u.title = urgent.has(ing) ? '「早めに使う」をやめる' : '早めに使いたい材料にする';
        u.setAttribute('aria-pressed', String(urgent.has(ing)));
        u.innerHTML = icon('alarm');
        u.addEventListener('click', () => toggleUrgent(ing));
        const name = document.createElement('span');
        name.textContent = ing;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'remove-btn';
        x.title = '冷蔵庫からはずす';
        x.setAttribute('aria-label', `${ing}をはずす`);
        x.innerHTML = icon('x');
        x.addEventListener('click', () => toggleIngredient(ing));
        chip.append(u, name, x);
        selectedChips.appendChild(chip);
    });
    searchIngBtn.textContent = selectedIngredients.size ? `${selectedIngredients.size}つの材料で探す` : '料理を探す';
}

ingredientFilter.addEventListener('input', renderIngredientTags);

let ingredientSearched = false;
let readyOnly = false; // 「すぐ作れる（足りない材料1つまで）」だけ表示

/**
 * 選んだ材料でどれだけ作れるか
 *   used    : 選んだ材料のうち使うもの（「どれか1つ」は1つと数える）
 *   missing : 足りない材料（調味料・薬味は家にある前提で数えない）
 *   extra   : 足りないが、なくても作れる薬味など
 */
function readiness(r) {
    const has = i => selectedIngredients.has(i);
    const urgent = urgentIngredients();
    const urgentUsed = r.allIngs.filter(i => urgent.has(i));
    let used = 0;
    const missing = [];
    const extra = [];
    r.ingredients.forEach(i => {
        if (has(i)) used++;
        else if (PANTRY_SET.has(i)) { /* 調味料は家にある前提 */ }
        else if (OPTIONAL_INGS.has(i)) extra.push(i);
        else missing.push(i);
    });
    r.alternatives.forEach(g => {
        if (g.some(has)) used++;
        else if (!g.every(i => PANTRY_SET.has(i))) missing.push(`${g.join('・')}のどれか`);
    });
    return { used, missing, extra, urgentUsed };
}

function readinessText(info) {
    const urgent = info.urgentUsed.length ? `${info.urgentUsed.join('・')}を使える` : '';
    if (info.missing.length === 0) {
        return { ok: true, urgent, text: `全部そろってる！${info.extra.length ? `（あれば: ${info.extra.slice(0, 3).join('、')}）` : ''}` };
    }
    const list = info.missing.slice(0, 3).join('、') + (info.missing.length > 3 ? ` ほか${info.missing.length - 3}つ` : '');
    return { ok: false, urgent, text: `あと ${list}` };
}

function runIngredientSearch(scroll) {
    ingredientSearched = true;
    const picking = selectedIngredients.size > 0;
    const info = new Map(RECIPES.map(r => [r.id, readiness(r)]));
    const base = picking ? RECIPES.filter(r => info.get(r.id).used > 0) : RECIPES;
    const { ok, counts } = applyFilters(base);
    // 足りない材料が少ない順 → 早めに使いたい材料を使う順 → 選んだ材料をたくさん使う順 → 定番順
    ok.sort((a, b) => (info.get(a.id).missing.length - info.get(b.id).missing.length)
        || (info.get(b.id).urgentUsed.length - info.get(a.id).urgentUsed.length)
        || (info.get(b.id).used - info.get(a.id).used)
        || (baseWeight(b) - baseWeight(a)));
    const ready = ok.filter(r => info.get(r.id).missing.length <= 1);
    const list = picking && readyOnly ? ready : ok;

    let header = null;
    if (picking) {
        header = document.createElement('div');
        header.className = 'result-toolbar';
        const zero = ok.filter(r => info.get(r.id).missing.length === 0).length;
        header.innerHTML = `<span class="muted small">全部そろってる料理 <strong>${zero}</strong> 品・あと1つで作れる料理 <strong>${ready.length - zero}</strong> 品</span>`;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'toggle-chip' + (readyOnly ? ' on' : '');
        toggle.setAttribute('aria-pressed', String(readyOnly));
        toggle.innerHTML = `${icon('flame')}すぐ作れるものだけ`;
        toggle.addEventListener('click', () => { readyOnly = !readyOnly; runIngredientSearch(false); });
        header.appendChild(toggle);
    }
    renderRecipes(list, 'ingredient-result', {
        notice: exclusionNotice(counts), emptyHint: emptyHint(counts), header,
        matchInfo: picking ? r => readinessText(info.get(r.id)) : null,
    });
    if (scroll === true) document.getElementById('ingredient-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
searchIngBtn.addEventListener('click', () => runIngredientSearch(true));

document.getElementById('clear-ingredients').addEventListener('click', () => {
    if (selectedIngredients.size >= 3 && !confirm('冷蔵庫の材料を全部はずしますか？')) return;
    selectedIngredients.clear();
    saveFridge();
    renderIngredientTags();
    renderSelectedChips();
});

renderIngredientTags();
renderSelectedChips();

// ---------------------------------------------------------------------
// 2. ランダム
// ---------------------------------------------------------------------
const startRandomBtn = document.getElementById('start-random');
const randomDisplay = document.getElementById('random-display');
const randomResult = document.getElementById('random-result');
let isSpinning = false;

startRandomBtn.addEventListener('click', () => {
    if (isSpinning) return;
    const { ok, counts } = applyFilters(RECIPES);
    if (ok.length === 0) {
        randomDisplay.textContent = '候補がありません…設定を見直してください';
        return;
    }
    isSpinning = true;
    startRandomBtn.disabled = true;
    startRandomBtn.classList.remove('pulse');
    randomResult.innerHTML = '';

    let counter = 0;
    const maxSpins = 20;
    const spinInterval = setInterval(() => {
        randomDisplay.textContent = ok[Math.floor(Math.random() * ok.length)].name;
        counter++;
        if (counter > maxSpins) {
            clearInterval(spinInterval);
            const finalRecipe = weightedPick(ok, r => baseWeight(r) * fridgeBoost(r));
            randomDisplay.textContent = finalRecipe.name;
            const notice = exclusionNotice(counts);
            if (notice) {
                const p = document.createElement('p');
                p.className = 'filter-notice';
                p.textContent = notice;
                randomResult.appendChild(p);
            }
            const card = createRecipeCard(finalRecipe);
            card.classList.add('single');
            randomResult.appendChild(card);
            isSpinning = false;
            startRandomBtn.disabled = false;
            startRandomBtn.textContent = 'もう一度回す！';
        }
    }, 50);
});

// ---------------------------------------------------------------------
// 3. 質問から
// ---------------------------------------------------------------------
const questions = [
    {
        text: '今日の気分（お腹の空き具合）は？',
        key: 'type',
        options: [
            { label: 'がっつり食べたい！', icon: 'meat', value: 'がっつり' },
            { label: 'ふつう！', icon: 'utensils', value: '普通' },
            { label: 'あっさりでいいかな', icon: 'sprout', value: 'あっさり' },
            { label: 'どれでもいい', value: null },
        ],
    },
    {
        text: 'どのジャンルが食べたい？',
        key: 'genre',
        options: [
            { label: '和食', value: '和食' },
            { label: '洋食', value: '洋食' },
            { label: '中華', value: '中華' },
            { label: '韓国', value: '韓国' },
            { label: 'エスニック', value: 'エスニック' },
            { label: 'なんでもいい！', value: null },
        ],
    },
    {
        text: 'メインは何がいい？',
        key: 'main',
        options: [
            { label: '肉', icon: 'meat', value: 'meat' },
            { label: '魚介', icon: 'fish', value: 'fish' },
            { label: '卵・大豆', icon: 'egg', value: 'eggsoy' },
            { label: '野菜たっぷり', icon: 'carrot', value: 'veggie' },
            { label: 'なんでもいい！', value: null },
        ],
    },
    {
        text: '調理時間はどうする？',
        key: 'time',
        options: [
            { label: 'パパッと短めで！', icon: 'clock', value: '短め' },
            { label: 'じっくり長くてもOK', icon: 'flame', value: null },
        ],
    },
];

let currentQuestionIndex = 0;
let userFilters = {};

const questionText = document.getElementById('question-text');
const answerButtons = document.getElementById('answer-buttons');
const questionResult = document.getElementById('question-result');
const resetQuestionBtn = document.getElementById('reset-question');
const questionContainer = document.getElementById('question-container');
const questionProgress = document.getElementById('question-progress');

function showQuestion() {
    answerButtons.innerHTML = '';
    if (currentQuestionIndex >= questions.length) {
        showQuestionResult();
        return;
    }
    const currentQ = questions[currentQuestionIndex];
    questionText.textContent = currentQ.text;
    questionProgress.textContent = `${currentQuestionIndex + 1} / ${questions.length}`;
    currentQ.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.innerHTML = `${opt.icon ? icon(opt.icon) : ''}<span>${esc(opt.label)}</span>`;
        btn.addEventListener('click', () => {
            if (opt.value !== null) userFilters[currentQ.key] = opt.value;
            currentQuestionIndex++;
            showQuestion();
        });
        answerButtons.appendChild(btn);
    });
}

function showQuestionResult() {
    questionContainer.classList.add('hidden');
    questionResult.classList.remove('hidden');
    resetQuestionBtn.classList.remove('hidden');

    const base = RECIPES.filter(r => {
        if (r.role === 'T') return false;
        if (userFilters.type && r.type !== userFilters.type) return false;
        if (userFilters.genre && r.genre !== userFilters.genre) return false;
        if (userFilters.time && r.time !== userFilters.time) return false;
        if (userFilters.main === 'veggie') return r.nutrients.veg === 2;
        if (userFilters.main && r.main !== userFilters.main) return false;
        return true;
    });
    const { ok, counts } = applyFilters(base);
    // 定番・かんたんな料理を上に。ただし毎回同じ並びにならないよう少し揺らす
    const keyed = ok.map(r => ({ r, k: baseWeight(r) * (0.7 + Math.random() * 0.6) }));
    keyed.sort((a, b) => b.k - a.k);
    renderRecipes(keyed.map(x => x.r), questionResult, { notice: exclusionNotice(counts), emptyHint: emptyHint(counts) });
}

resetQuestionBtn.addEventListener('click', () => {
    currentQuestionIndex = 0;
    userFilters = {};
    questionContainer.classList.remove('hidden');
    questionResult.classList.add('hidden');
    resetQuestionBtn.classList.add('hidden');
    questionResult.innerHTML = '';
    showQuestion();
});

showQuestion();

// ---------------------------------------------------------------------
// 4. ひらめき（思いつかない範囲からのおすすめ）
// ---------------------------------------------------------------------
const MAIN_DISH_ROLES = ['K', 'M', 'N'];
const inspireResult = document.getElementById('inspire-result');
const inspireSummary = document.getElementById('inspire-summary');

function nutrientLabel(key) {
    return NUTRIENTS.find(n => n.key === key).label;
}

function renderInspireSummary() {
    const balance = recentBalance();
    const trend = recentTrend();
    const lines = [];
    if (trend) {
        const parts = [];
        if (trend.topMain) parts.push(`${MAIN_CATEGORIES[trend.topMain].label}料理`);
        if (trend.topGenre) parts.push(trend.topGenre);
        lines.push(`最近は <strong>${parts.join('・')}</strong> が多めです`);
    }
    if (balance && balance.lacking.length) {
        lines.push(`<strong>${balance.lacking.slice(0, 2).map(nutrientLabel).join('・')}</strong> が少なめかも`);
    }
    if (state.history.length === 0) {
        lines.push('「食べた！」で記録すると、最近の傾向や不足しがちな栄養も考えて提案します');
    } else if (!lines.length) {
        lines.push(`最近の記録はバランスよさそうです ${icon('thumb-up')}`);
    }
    inspireSummary.innerHTML = lines.map(l => `<p>${l}</p>`).join('');
}

function generateInspiration() {
    const { ok, counts } = applyFilters(RECIPES.filter(r => MAIN_DISH_ROLES.includes(r.role)));
    if (ok.length === 0) {
        renderRecipes([], inspireResult, { notice: exclusionNotice(counts), emptyHint: emptyHint(counts) });
        return;
    }
    const eaten = lastEatenDays();
    const balance = recentBalance();
    const trend = recentTrend();
    const lacking = balance ? balance.lacking : [];

    const novelty = r => {
        if (!eaten.has(r.id)) return 1.5;
        return eaten.get(r.id) > 30 ? 1.2 : 0.5;
    };
    const generalWeight = r => {
        let w = baseWeight(r) * novelty(r) * seasonInfo(r).factor * fridgeBoost(r);
        lacking.forEach(k => { w *= 1 + 0.6 * r.nutrients[k]; });
        if (trend && trend.topGenre === r.genre) w *= 0.4;
        if (trend && trend.topMain === r.main) w *= 0.4;
        return w;
    };

    const picks = [];
    const usedMain = new Set();
    const usedGenre = new Set();

    // 条件に合うものから、主材料・ジャンルがなるべくかぶらないように1品選ぶ
    function pick(cond, reasonFn) {
        let pool = ok.filter(r => cond(r) && !picks.some(p => p.r.id === r.id));
        const fresh = pool.filter(r => !usedMain.has(r.main) && !usedGenre.has(r.genre));
        if (fresh.length) pool = fresh;
        const r = weightedPick(pool, generalWeight);
        if (!r) return false;
        picks.push({ r, reason: reasonFn(r) });
        usedMain.add(r.main);
        usedGenre.add(r.genre);
        return true;
    }

    const slots = [];
    const urgent = [...urgentIngredients()];
    if (urgent.length) {
        slots.push([r => r.allIngs.some(i => urgent.includes(i)),
            r => ({ icon: 'alarm', text: `早めに使いたい${r.allIngs.filter(i => urgent.includes(i)).slice(0, 2).join('・')}を使う` })]);
    }
    if (lacking.length) {
        const key = lacking[0];
        slots.push([r => r.nutrients[key] === 2, () => ({ icon: 'heart-pulse', text: `不足ぎみの${nutrientLabel(key)}がとれる` })]);
    }
    if (trend) {
        const avoidLabel = trend.topMain ? `${MAIN_CATEGORIES[trend.topMain].label}料理` : trend.topGenre;
        slots.push([
            r => r.main !== trend.topMain && r.genre !== trend.topGenre,
            r => ({ icon: 'refresh', text: `最近${avoidLabel}が多いので${trend.topMain ? MAIN_CATEGORIES[r.main].label : r.genre}で気分転換` }),
        ]);
    }
    slots.push([r => isFavorite(r.id) && (!eaten.has(r.id) || eaten.get(r.id) > 14), () => ({ icon: 'star', text: 'お気に入りを久しぶりに' })]);
    slots.push([r => seasonInfo(r).reason !== null && seasonInfo(r).factor > 1, r => ({ icon: /暑い/.test(seasonInfo(r).reason) ? 'sun' : /寒い/.test(seasonInfo(r).reason) ? 'flame' : 'leaf', text: seasonInfo(r).reason })]);
    slots.push([r => r.pop >= 2 && !eaten.has(r.id), () => ({ icon: 'sparkle', text: 'まだ記録にない料理に挑戦' })]);
    slots.push([r => r.pop === 1 && (!eaten.has(r.id) || eaten.get(r.id) > 14), () => ({ icon: 'home', text: '定番だけど最近食べていない' })]);
    slots.push([r => r.diff === 1, () => ({ icon: 'clock', text: 'かんたんに作れる' })]);

    for (const [cond, reasonFn] of slots) {
        if (picks.length >= 3) break;
        pick(cond, reasonFn);
    }
    while (picks.length < 3 && pick(() => true, () => ({ icon: 'bulb', text: 'こんなのはどう？' }))) { /* 足りない分を埋める */ }

    inspireResult.innerHTML = '';
    const notice = exclusionNotice(counts);
    if (notice) {
        const p = document.createElement('p');
        p.className = 'filter-notice';
        p.textContent = notice;
        inspireResult.appendChild(p);
    }
    const grid = document.createElement('div');
    grid.className = 'recipe-cards';
    picks.forEach(({ r, reason }) => grid.appendChild(createRecipeCard(r, { reason })));
    inspireResult.appendChild(grid);
    document.getElementById('start-inspire').innerHTML = `${icon('refresh')}別の案を見る`;
}

document.getElementById('start-inspire').addEventListener('click', generateInspiration);

// ---------------------------------------------------------------------
// 献立セット（主菜 + 副菜 + 汁物）
// ---------------------------------------------------------------------
const setDialog = document.getElementById('set-dialog');
const setBody = document.getElementById('set-body');
let setBaseRecipe = null;

// 主菜と相性のいい汁物・副菜のジャンル
const GENRE_AFFINITY = {
    '和食': ['和食'], '洋食': ['洋食'], '中華': ['中華', '和食'], '韓国': ['韓国', '和食', '中華'], 'エスニック': ['エスニック', '洋食', '中華'],
};

function pickSide(main, role, already, avoid = new Set()) {
    const { ok } = applyFilters(RECIPES.filter(r => r.role === role && !already.some(a => a.id === r.id) && !avoid.has(r.id)));
    if (ok.length === 0) return null;
    const have = { ...main.nutrients };
    already.forEach(a => NUTRIENTS.forEach(n => { have[n.key] += a.nutrients[n.key]; }));
    const affinity = GENRE_AFFINITY[main.genre] || [main.genre];
    return weightedPick(ok, r => {
        let w = baseWeight(r) * seasonInfo(r).factor;
        // 主菜に足りない栄養を補えるものを優先
        ['veg', 'fiber', 'calcium', 'iron'].forEach(k => { if (have[k] < 2) w *= 1 + 0.7 * r.nutrients[k]; });
        if (r.main === main.main && r.main !== 'veg') w *= 0.4; // 同じ主材料が重ならないように
        const idx = affinity.indexOf(r.genre);
        w *= idx === 0 ? 3 : idx > 0 ? 1.5 : 0.3;
        return w;
    });
}

function buildSet(main, avoid = new Set()) {
    const items = [main];
    const sideRoles = main.role === 'K' ? ['F', 'S'] : main.role === 'N' ? ['F'] : ['F', 'S'];
    sideRoles.forEach(role => {
        const side = pickSide(main, role, items, avoid);
        if (side) items.push(side);
    });
    return items;
}

function renderSet() {
    const items = buildSet(setBaseRecipe);
    const withRice = setBaseRecipe.role === 'K' || setBaseRecipe.role === 'N';
    const totalKcal = items.reduce((s, r) => s + r.kcal, 0) + (withRice ? 250 : 0);
    const sum = {};
    NUTRIENTS.forEach(n => { sum[n.key] = items.reduce((s, r) => s + r.nutrients[n.key], 0) + (withRice && n.key === 'carb' ? 2 : 0); });

    setBody.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'set-list';
    items.forEach(r => list.appendChild(createRecipeCard(r, { compact: true, noSet: true })));
    if (withRice) {
        const rice = document.createElement('div');
        rice.className = 'recipe-card compact rice';
        rice.innerHTML = '<h3>ご飯</h3><p class="recipe-kcal">約 <strong>250</strong> kcal<span class="muted">（茶碗1杯）</span></p>';
        list.appendChild(rice);
    }
    setBody.appendChild(list);

    const summary = document.createElement('div');
    summary.className = 'set-summary';
    const servings = state.settings.servings;
    // PFC はセットの全部の料理に目安があるときだけ合計を出す（ご飯茶碗1杯 = P4・F1・C55 として足す）
    let pfcLine = '';
    if (items.every(r => r.pfc)) {
        const t = items.reduce((a, r) => ({ p: a.p + r.pfc.p, f: a.f + r.pfc.f, c: a.c + r.pfc.c }), withRice ? { p: 4, f: 1, c: 55 } : { p: 0, f: 0, c: 0 });
        pfcLine = `<p class="pfc">${pfcText(t)}</p>`;
    }
    summary.innerHTML = `
        <p>1人あたり 約 <strong>${totalKcal}</strong> kcal${servings > 1 ? `<span class="muted small">（${servings}人分で 約${totalKcal * servings}kcal）</span>` : ''}</p>
        ${pfcLine}
        <div class="nutri-row">${NUTRIENTS.map(n => `<span class="nutri-chip lv${Math.min(2, sum[n.key])}">${icon(n.icon)}${n.short}${sum[n.key] >= 2 ? '◎' : sum[n.key] === 0 ? '×' : ''}</span>`).join('')}</div>
    `;
    const eatAll = document.createElement('button');
    eatAll.className = 'primary-btn small';
    eatAll.innerHTML = `${icon('utensils')}セットをまとめて記録`;
    eatAll.addEventListener('click', () => {
        const today = dateStr();
        items.forEach(r => { if (!isEatenToday(r.id)) addHistory(r.id, today); });
        showToast('献立セットを今日の記録に追加しました');
        setDialog.close();
    });
    const shopAll = document.createElement('button');
    shopAll.className = 'secondary-btn small';
    shopAll.innerHTML = `${icon('cart')}材料を買い物リストへ`;
    shopAll.addEventListener('click', () => addToShopping(items));
    const shareBtn = document.createElement('button');
    shareBtn.className = 'secondary-btn small';
    shareBtn.innerHTML = `${icon('share')}共有`;
    shareBtn.addEventListener('click', () => shareText(setShareText(items, totalKcal, withRice), '今日の献立'));
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.append(eatAll, shopAll, shareBtn);
    summary.appendChild(row);
    setBody.appendChild(summary);
}

function openSetDialog(recipe) {
    setBaseRecipe = recipe;
    document.getElementById('set-title').textContent = `「${recipe.name}」の献立セット`;
    renderSet();
    setDialog.showModal();
}

document.getElementById('set-reroll').addEventListener('click', renderSet);
document.getElementById('set-close').addEventListener('click', () => setDialog.close());

// ---------------------------------------------------------------------
// 5. 記録
// ---------------------------------------------------------------------
function addHistory(id, date) {
    state.history.push({ id, date });
    // 記録は直近90日分だけ残す
    state.history = state.history.filter(h => daysSince(h.date) <= 90);
    saveState();
    renderInspireSummary();
}

function removeHistory(index) {
    state.history.splice(index, 1);
    saveState();
    renderHistory();
    renderInspireSummary();
}

const historyList = document.getElementById('history-list');
const balanceArea = document.getElementById('balance-area');

function renderBalance() {
    const balance = recentBalance();
    balanceArea.innerHTML = '';
    if (!balance) {
        balanceArea.innerHTML = '<p class="muted">料理を2つ以上記録すると、ここに最近7日間の栄養バランスが表示されます。</p>';
        return;
    }
    const bars = document.createElement('div');
    bars.className = 'balance-bars';
    NUTRIENTS.forEach(n => {
        const ratio = balance.ratios[n.key];
        const pct = Math.min(100, Math.round(ratio * 100));
        const status = ratio < 0.6 ? 'low' : ratio < 0.9 ? 'mid' : 'ok';
        const statusText = { low: '少なめ', mid: 'もう少し', ok: 'OK' }[status];
        const row = document.createElement('div');
        row.className = `balance-row ${status}`;
        row.innerHTML = `
            <span class="balance-label">${icon(n.icon)}${n.label}</span>
            <span class="balance-track"><span class="balance-fill" style="width:${pct}%"></span></span>
            <span class="balance-status">${statusText}</span>
        `;
        bars.appendChild(row);
    });
    balanceArea.appendChild(bars);

    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = `最近7日間のうち記録のある ${balance.dayCount} 日分（${balance.entryCount} 品）から見た目安です。記録していない食事は含まれません。`;
    balanceArea.appendChild(note);

    if (balance.lacking.length) {
        const key = balance.lacking[0];
        const { ok } = applyFilters(RECIPES.filter(r => r.nutrients[key] === 2 && r.role !== 'T'));
        const picks = [];
        const pool = [...ok];
        while (picks.length < 3 && pool.length) {
            const r = weightedPick(pool, baseWeight);
            if (!r) break;
            picks.push(r);
            pool.splice(pool.indexOf(r), 1);
        }
        if (picks.length) {
            const h = document.createElement('h3');
            h.className = 'sub-heading';
            h.textContent = `${nutrientLabel(key)}をとるならこんな料理`;
            balanceArea.appendChild(h);
            const grid = document.createElement('div');
            grid.className = 'recipe-cards';
            picks.forEach(r => grid.appendChild(createRecipeCard(r, { compact: true })));
            balanceArea.appendChild(grid);
        }
    }
}

function renderHistory() {
    renderBalance();
    renderPreferences();
    historyList.innerHTML = '';
    if (state.history.length === 0) {
        historyList.innerHTML = '<p class="muted">まだ記録がありません。料理カードの「食べた！」ボタンか、上のフォームから記録できます。</p>';
        return;
    }
    const indexed = state.history.map((h, index) => ({ ...h, index }))
        .filter(h => daysSince(h.date) <= 30)
        .sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index);
    const byDate = new Map();
    indexed.forEach(h => {
        if (!byDate.has(h.date)) byDate.set(h.date, []);
        byDate.get(h.date).push(h);
    });
    byDate.forEach((entries, date) => {
        const group = document.createElement('div');
        group.className = 'history-day';
        const kcal = entries.reduce((s, h) => s + RECIPE_BY_ID.get(h.id).kcal, 0);
        group.innerHTML = `<h3>${formatDate(date)} <span class="muted small">約${kcal}kcal</span></h3>`;
        const ul = document.createElement('ul');
        entries.forEach(h => {
            const r = RECIPE_BY_ID.get(h.id);
            const li = document.createElement('li');
            li.innerHTML = `<span class="history-name">${esc(r.name)} <span class="muted small">${ROLE_LABELS[r.role]}</span></span>`;
            // 食べたあとの評価（もう一度押すと取り消し）
            const rate = document.createElement('span');
            rate.className = 'rate-btns';
            [[1, 'thumb-up', 'おいしかった'], [-1, 'thumb-down', 'いまいち']].forEach(([v, iconName, label]) => {
                const b = document.createElement('button');
                b.className = 'rate-btn' + (state.ratings[r.id] === v ? ' on' : '');
                b.title = label;
                b.setAttribute('aria-pressed', String(state.ratings[r.id] === v));
                b.innerHTML = icon(iconName);
                b.setAttribute('aria-label', label);
                b.addEventListener('click', () => { setRating(r.id, v); renderHistory(); });
                rate.appendChild(b);
            });
            li.appendChild(rate);
            const del = document.createElement('button');
            del.className = 'icon-btn';
            del.title = '記録を消す';
            del.innerHTML = icon('x');
            del.setAttribute('aria-label', '記録を消す');
            del.addEventListener('click', () => removeHistory(h.index));
            li.appendChild(del);
            ul.appendChild(li);
        });
        group.appendChild(ul);
        historyList.appendChild(group);
    });
}

// 手動で記録
const historyInput = document.getElementById('history-input');
const historyDate = document.getElementById('history-date');
const recipeOptions = document.getElementById('recipe-options');
RECIPES.map(r => r.name).sort((a, b) => a.localeCompare(b, 'ja')).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    recipeOptions.appendChild(opt);
});
historyDate.value = dateStr();
historyDate.max = dateStr();

document.getElementById('history-add').addEventListener('click', () => {
    const name = historyInput.value.trim();
    const r = RECIPES.find(x => x.name === name);
    if (!r) {
        showToast('一覧にある料理名を選んでください');
        return;
    }
    addHistory(r.id, historyDate.value || dateStr());
    historyInput.value = '';
    showToast(`「${r.name}」を記録しました`);
    renderHistory();
});

document.getElementById('history-clear').addEventListener('click', () => {
    if (!confirm('食事の記録をすべて消しますか？')) return;
    state.history = [];
    saveState();
    renderHistory();
    renderInspireSummary();
});

// ---------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------
const settingsDialog = document.getElementById('settings-dialog');

function renderSettings() {
    const s = state.settings;
    const allergenBox = document.getElementById('allergen-options');
    allergenBox.innerHTML = '';
    const groups = [
        { title: '特定原材料（表示義務のある8品目）', items: ALLERGENS.filter(a => a.group === 'required') },
        { title: '表示が推奨されている品目', items: ALLERGENS.filter(a => a.group === 'recommended') },
        { title: 'その他', items: ALLERGENS.filter(a => a.group === 'other') },
    ];
    groups.forEach(g => {
        const p = document.createElement('p');
        p.className = 'muted small';
        p.textContent = g.title;
        allergenBox.appendChild(p);
        const wrap = document.createElement('div');
        wrap.className = 'chip-options';
        g.items.forEach(a => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ingredient-tag small' + (s.allergens.includes(a.key) ? ' selected danger' : '');
            b.textContent = a.label;
            b.addEventListener('click', () => {
                if (s.allergens.includes(a.key)) s.allergens = s.allergens.filter(k => k !== a.key);
                else s.allergens.push(a.key);
                settingsChanged();
            });
            wrap.appendChild(b);
        });
        allergenBox.appendChild(wrap);
    });

    const dislikeBox = document.getElementById('dislike-chips');
    dislikeBox.innerHTML = '';
    s.dislikes.forEach(w => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ingredient-tag small selected';
        b.innerHTML = `${esc(w)}${icon('x')}`;
        b.title = '外す';
        b.addEventListener('click', () => {
            s.dislikes = s.dislikes.filter(x => x !== w);
            settingsChanged();
        });
        dislikeBox.appendChild(b);
    });

    document.querySelectorAll('[data-setting]').forEach(group => {
        group.querySelectorAll('button').forEach(b => {
            b.classList.toggle('selected', String(s[group.dataset.setting]) === b.dataset.value);
        });
    });

    const active = s.allergens.length + s.dislikes.length;
    document.getElementById('settings-badge').textContent = active ? String(active) : '';

    // 折りたたんだ見出しに今の設定を表示
    const label = (key, value) => {
        const b = document.querySelector(`[data-setting="${key}"] button[data-value="${value}"]`);
        return b ? b.textContent : '';
    };
    const allergyNames = s.allergens.map(k => ALLERGEN_BY_KEY.get(k).label);
    document.getElementById('sum-allergy').textContent = allergyNames.length
        ? `${allergyNames.slice(0, 4).join('・')}${allergyNames.length > 4 ? ` ほか${allergyNames.length - 4}` : ''}`
        : 'なし';
    document.getElementById('sum-dislike').textContent = s.dislikes.length ? s.dislikes.slice(0, 3).join('・') + (s.dislikes.length > 3 ? '…' : '') : 'なし';
    document.getElementById('sum-suggest').textContent = `除外 ${label('recentDays', s.recentDays)}・マイナー ${label('minor', s.minor)}`;
    document.getElementById('sum-display').textContent = `${s.servings}人・${label('theme', s.theme)}`;
}

function settingsChanged() {
    saveState();
    renderSettings();
}

document.querySelectorAll('[data-setting]').forEach(group => {
    group.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            const key = group.dataset.setting;
            state.settings[key] = ['recentDays', 'servings'].includes(key) ? Number(b.dataset.value) : b.dataset.value;
            if (key === 'theme') applyTheme();
            settingsChanged();
        });
    });
});

const dislikeInput = document.getElementById('dislike-input');
function addDislike() {
    const words = dislikeInput.value.split(/[、,\s]+/).map(w => w.trim()).filter(Boolean);
    words.forEach(w => { if (!state.settings.dislikes.includes(w)) state.settings.dislikes.push(w); });
    dislikeInput.value = '';
    settingsChanged();
}
document.getElementById('dislike-add').addEventListener('click', addDislike);
dislikeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addDislike(); }
});

document.getElementById('open-settings').addEventListener('click', () => {
    renderSettings();
    settingsDialog.showModal();
});
document.getElementById('settings-close').addEventListener('click', () => settingsDialog.close());

// 設定を閉じたら、表示中の結果を新しい設定で作り直す
/** 設定や条件が変わったとき、表示中の結果を作り直す */
function refreshResults() {
    if (ingredientSearched) runIngredientSearch();
    if (!questionResult.classList.contains('hidden')) showQuestionResult();
    if (document.getElementById('history-tab').classList.contains('active')) renderHistory();
    renderConditionBar();
}
settingsDialog.addEventListener('close', refreshResults);

// ダイアログの外側をタップしたら閉じる
[settingsDialog, setDialog].forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
});

// ---------------------------------------------------------------------
// 買い物リスト
// ---------------------------------------------------------------------
const shoppingDialog = document.getElementById('shopping-dialog');
const shoppingBody = document.getElementById('shopping-body');

// 材料がどの売り場のものか（表示の並び用）
const SHOP_SECTIONS = [
    { label: '野菜・きのこ・果物', icon: 'carrot', items: new Set([...ingredientCategories['野菜・きのこ'], ...ingredientCategories['果物・ナッツ']]) },
    { label: '肉', icon: 'meat', items: new Set(MEAT_LIST) },
    { label: '魚介', icon: 'fish', items: new Set(SEAFOOD_LIST) },
    { label: '卵・豆腐・乳製品', icon: 'egg', items: new Set(ingredientCategories['卵・大豆・乳製品']) },
    { label: '主食・麺・粉', icon: 'rice', items: new Set(ingredientCategories['主食・粉・麺']) },
];

function updateShoppingBadge() {
    const left = state.shopping.filter(s => !s.checked && !PANTRY_SET.has(s.name)).length;
    document.getElementById('shopping-badge').textContent = left ? String(left) : '';
}

function addToShopping(recipeList) {
    let added = 0;
    recipeList.forEach(r => {
        // 「どれか1つ」の材料は「豚肉 / 牛肉 / 鶏肉（どれか）」の1行にする
        const names = [...r.ingredients, ...r.alternatives.map(g => `${g.join(' / ')}（どれか）`)];
        names.forEach(name => {
            const item = state.shopping.find(s => s.name === name);
            if (item) {
                if (!item.from.includes(r.name)) item.from.push(r.name);
                if (item.checked) { item.checked = false; added++; }
            } else {
                state.shopping.push({ name, from: [r.name], checked: false });
                added++;
            }
        });
    });
    saveState();
    updateShoppingBadge();
    const names = recipeList.map(r => r.name).join('・');
    showToast(added ? `「${names}」の材料を買い物リストに追加しました` : 'すでに買い物リストに入っています');
}

function renderShopping() {
    shoppingBody.innerHTML = '';
    const servings = state.settings.servings;
    if (state.shopping.length === 0) {
        shoppingBody.innerHTML = '<p class="muted">まだ何もありません。料理カードの「買う」や献立セットから材料を追加できます。</p>';
        return;
    }
    const head = document.createElement('p');
    head.className = 'muted small';
    head.textContent = `${servings}人分の目安で買ってください。料理によっては「豚肉・牛肉・鶏肉」のように候補が並ぶので、使わないものは × で消してください。`;
    shoppingBody.appendChild(head);

    const sections = SHOP_SECTIONS.map(sec => ({ ...sec, list: [] }));
    const other = { label: 'その他', icon: 'box', list: [] };
    const pantry = { label: '調味料（家にあるか確認）', icon: 'bottle', list: [], pantry: true };
    state.shopping.forEach((item, index) => {
        const entry = { item, index };
        if (PANTRY_SET.has(item.name)) { pantry.list.push(entry); return; }
        const key = item.name.split(' / ')[0].replace('（どれか）', '');
        const sec = sections.find(s => s.items.has(key));
        (sec || other).list.push(entry);
    });

    [...sections, other, pantry].filter(s => s.list.length).forEach(sec => {
        const box = document.createElement('div');
        box.className = 'shop-section' + (sec.pantry ? ' pantry' : '');
        box.innerHTML = `<h3>${icon(sec.icon)}${sec.label}</h3>`;
        const ul = document.createElement('ul');
        sec.list.forEach(({ item, index }) => {
            const li = document.createElement('li');
            li.className = item.checked ? 'checked' : '';
            const label = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = item.checked;
            cb.addEventListener('change', () => {
                item.checked = cb.checked;
                li.classList.toggle('checked', cb.checked);
                saveState();
                updateShoppingBadge();
            });
            const text = document.createElement('span');
            text.innerHTML = `${esc(item.name)} <span class="muted small">${esc(item.from.join('・'))}</span>`;
            label.append(cb, text);
            const del = document.createElement('button');
            del.className = 'icon-btn';
            del.title = 'リストから消す';
            del.innerHTML = icon('x');
            del.setAttribute('aria-label', 'リストから消す');
            del.addEventListener('click', () => {
                state.shopping.splice(index, 1);
                saveState();
                updateShoppingBadge();
                renderShopping();
            });
            li.append(label, del);
            ul.appendChild(li);
        });
        box.appendChild(ul);
        shoppingBody.appendChild(box);
    });
}

function shoppingText() {
    const lines = [`【買い物リスト】${state.settings.servings}人分`];
    state.shopping.filter(s => !s.checked && !PANTRY_SET.has(s.name)).forEach(s => lines.push(`・${s.name}`));
    const pantry = state.shopping.filter(s => !s.checked && PANTRY_SET.has(s.name));
    if (pantry.length) lines.push('', '（家にあるか確認）', ...pantry.map(s => `・${s.name}`));
    return lines.join('\n');
}

document.getElementById('open-shopping').addEventListener('click', () => {
    renderShopping();
    shoppingDialog.showModal();
});
document.getElementById('shopping-close').addEventListener('click', () => shoppingDialog.close());
document.getElementById('shopping-clear-checked').addEventListener('click', () => {
    state.shopping = state.shopping.filter(s => !s.checked);
    saveState();
    updateShoppingBadge();
    renderShopping();
});
document.getElementById('shopping-clear').addEventListener('click', () => {
    if (!confirm('買い物リストを空にしますか？')) return;
    state.shopping = [];
    saveState();
    updateShoppingBadge();
    renderShopping();
});
document.getElementById('shopping-share').addEventListener('click', () => shareText(shoppingText(), '買い物リスト'));
shoppingDialog.addEventListener('click', e => { if (e.target === shoppingDialog) shoppingDialog.close(); });

// ---------------------------------------------------------------------
// テーマ（ライト／ダーク）
// ---------------------------------------------------------------------
function applyTheme() {
    const t = state.settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#2a1f1b' : '#ff9800');
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------------------------------------------------------------------
// バックアップ（書き出し・読み込み）
// ---------------------------------------------------------------------
document.getElementById('backup-export').addEventListener('click', () => {
    const data = { app: 'menu-planner', version: APP_VERSION, exportedAt: new Date().toISOString(), ...state };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kondate-backup-${dateStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast('バックアップファイルを書き出しました');
});

const backupFile = document.getElementById('backup-file');
document.getElementById('backup-import').addEventListener('click', () => backupFile.click());
backupFile.addEventListener('change', async () => {
    const file = backupFile.files[0];
    backupFile.value = '';
    if (!file) return;
    try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || parsed.app !== 'menu-planner') throw new Error('not a backup');
        const next = normalizeState(parsed);
        if (!confirm(`記録 ${next.history.length} 件・買い物リスト ${next.shopping.length} 件を読み込みます。\n今の設定と記録は置き換わります。よろしいですか？`)) return;
        state.settings = next.settings;
        state.history = next.history;
        state.shopping = next.shopping;
        saveState();
        applyTheme();
        renderSettings();
        renderInspireSummary();
        updateShoppingBadge();
        showToast('バックアップを読み込みました');
    } catch (e) {
        showToast('このファイルは読み込めませんでした');
    }
});

// ---------------------------------------------------------------------
// 条件フィルター（辛くない・レンジ・節約・時短）
// ---------------------------------------------------------------------
const condBar = document.getElementById('cond-bar');

function renderConditionBar() {
    condBar.innerHTML = '<span class="cond-label">条件</span>';
    CONDITIONS.forEach(c => {
        const on = state.settings.conditions.includes(c.key);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'toggle-chip' + (on ? ' on' : '');
        b.setAttribute('aria-pressed', String(on));
        b.title = c.desc;
        b.innerHTML = `${icon(c.icon)}${c.label}`;
        b.addEventListener('click', () => {
            const list = state.settings.conditions;
            state.settings.conditions = on ? list.filter(k => k !== c.key) : [...list, c.key];
            saveState();
            refreshResults();
        });
        condBar.appendChild(b);
    });
}

// ---------------------------------------------------------------------
// お気に入り・非表示の一覧（記録タブ）
// ---------------------------------------------------------------------
function renderPreferences() {
    const favBox = document.getElementById('fav-list');
    const blockBox = document.getElementById('blocked-list');
    favBox.innerHTML = '';
    blockBox.innerHTML = '';

    if (state.favorites.length === 0) {
        favBox.innerHTML = '<p class="muted small">料理カードの星（お気に入り）を押すとここに入ります。お気に入りは提案に出やすくなります。</p>';
    }
    state.favorites.forEach(id => {
        const r = RECIPE_BY_ID.get(id);
        const chip = document.createElement('span');
        chip.className = 'pref-chip';
        chip.innerHTML = `${icon('star', 'fill')}${esc(r.name)}`;
        const x = document.createElement('button');
        x.className = 'icon-btn';
        x.title = 'お気に入りから外す';
        x.innerHTML = icon('x');
        x.setAttribute('aria-label', 'お気に入りから外す');
        x.addEventListener('click', () => { toggleFavorite(id); renderPreferences(); });
        chip.appendChild(x);
        favBox.appendChild(chip);
    });

    if (state.blocked.length === 0) {
        blockBox.innerHTML = '<p class="muted small">カードの「…」メニューから「もう出さない」を選んだ料理がここに入ります。</p>';
    }
    state.blocked.forEach(id => {
        const r = RECIPE_BY_ID.get(id);
        const chip = document.createElement('span');
        chip.className = 'pref-chip blocked';
        chip.textContent = r.name;
        const back = document.createElement('button');
        back.className = 'text-btn';
        back.textContent = '戻す';
        back.addEventListener('click', () => { unblockRecipe(id); renderPreferences(); showToast(`「${r.name}」をまた出すようにしました`); });
        chip.appendChild(back);
        blockBox.appendChild(chip);
    });
}

// ---------------------------------------------------------------------
// 1週間の献立
// ---------------------------------------------------------------------
const weekResult = document.getElementById('week-result');
const weekOptions = {
    days: state.weekPlan ? state.weekPlan.days.length : 7,
    withSides: state.weekPlan ? state.weekPlan.withSides : false,
    reuse: state.weekPlan && state.weekPlan.reuse === false ? false : true, // 食材を使い回す
};

// 使い回すと得な、日持ちしにくい材料（野菜・きのこ・豆腐・乳製品など）
const PERISHABLE = new Set([...ingredientCategories['野菜・きのこ'], '豆腐', '厚揚げ', '油揚げ', '牛乳', '生クリーム', 'もやし', '納豆']);

/** 買い物の単位になる材料（調味料・薬味は除く） */
const shopIngs = r => r.ingredients.filter(i => !PANTRY_SET.has(i) && !OPTIONAL_INGS.has(i));

function addDays(str, n) {
    const [y, m, d] = str.split('-').map(Number);
    return dateStr(new Date(y, m - 1, d + n));
}

function weekdayOf(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
}

function weekLabel(str) {
    const n = daysSince(str);
    const [, m, d] = str.split('-').map(Number);
    const wd = '日月火水木金土'[weekdayOf(str)];
    const rel = n === 0 ? '今日' : n === -1 ? '明日' : n === 1 ? '昨日' : '';
    return `${m}/${d}(${wd})${rel ? ` <span class="muted small">${rel}</span>` : ''}`;
}

/** その日の主菜の選びやすさ（前後の日とかぶらないように） */
function planWeight(r, ctx) {
    let w = baseWeight(r) * seasonInfo(r).factor;
    if (ctx.eaten.has(r.id) && ctx.eaten.get(r.id) < 14) w *= 0.5;
    const weekend = ctx.weekday === 0 || ctx.weekday === 6;
    if (!weekend) {
        if (r.diff === 3) w *= 0.25;
        if (r.time === '長め') w *= 0.5;
    } else if (r.diff >= 2) {
        w *= 1.2;
    }
    ctx.neighbors.forEach(n => {
        if (n.genre === r.genre) w *= 0.4;
        if (n.main === r.main) w *= 0.3;
    });
    w *= Math.pow(0.55, ctx.mainCount[r.main] || 0);
    w *= Math.pow(0.7, ctx.genreCount[r.genre] || 0);
    if (r.role !== 'K') w *= Math.pow(0.5, ctx.roleCount[r.role] || 0);
    if (r.role === 'K') w *= 1.3; // 主菜を中心に
    if (!ctx.hasFish && r.main === 'fish' && ctx.remaining <= 3) w *= 2.5; // 1回は魚を
    // 他の日と同じ材料を使う料理を優先（特に日持ちしない野菜など）
    // 新しく買う材料が増える料理ほど出にくく、日持ちしない材料を他の日と共有できる料理ほど出やすく
    if (weekOptions.reuse && ctx.ingUse.size) {
        let f = 1;
        shopIngs(r).forEach(i => {
            if (ctx.ingUse.has(i)) f *= PERISHABLE.has(i) ? 1.6 : 1.2;
            else f *= PERISHABLE.has(i) ? 0.6 : 0.75;
        });
        w *= Math.min(Math.max(f, 0.05), 4);
    }
    // 冷蔵庫の材料、特に早めに使いたいものは最初の3日に
    const urgent = urgentIngredients();
    const urgentHit = r.allIngs.filter(i => urgent.has(i) && !ctx.urgentDone.has(i)).length;
    if (urgentHit) w *= ctx.index < 3 ? 1 + 2 * urgentHit : 1 + 0.5 * urgentHit;
    const have = r.allIngs.filter(i => selectedIngredients.has(i) && !PANTRY_SET.has(i)).length;
    w *= 1 + 0.15 * Math.min(have, 4);
    return w;
}

function planContext(plan, index) {
    const ctx = { eaten: lastEatenDays(), mainCount: {}, genreCount: {}, roleCount: {}, hasFish: false, neighbors: [], ingUse: new Set(), urgentDone: new Set(), index };
    const urgent = urgentIngredients();
    plan.forEach((d, i) => {
        if (i === index || !d) return;
        [d.main, ...d.sides].forEach(id => RECIPE_BY_ID.get(id).allIngs.forEach(ing => {
            ctx.ingUse.add(ing);
            if (urgent.has(ing)) ctx.urgentDone.add(ing);
        }));
        const r = RECIPE_BY_ID.get(d.main);
        ctx.mainCount[r.main] = (ctx.mainCount[r.main] || 0) + 1;
        ctx.genreCount[r.genre] = (ctx.genreCount[r.genre] || 0) + 1;
        ctx.roleCount[r.role] = (ctx.roleCount[r.role] || 0) + 1;
        if (r.main === 'fish') ctx.hasFish = true;
        if (Math.abs(i - index) === 1) ctx.neighbors.push(r);
    });
    return ctx;
}

function pickPlanDay(plan, index, date, pool) {
    const ctx = planContext(plan, index);
    ctx.weekday = weekdayOf(date);
    ctx.remaining = plan.length - index;
    const used = new Set(plan.filter((d, i) => d && i !== index).map(d => d.main));
    let candidates = pool.filter(r => !used.has(r.id));
    // 最初の3日は、まだ使っていない「早めに使う」材料があればそれを使う料理から選ぶ
    if (index < 3) {
        const urgentLeft = [...urgentIngredients()].filter(i => !ctx.urgentDone.has(i));
        const usingUrgent = candidates.filter(r => r.allIngs.some(i => urgentLeft.includes(i)));
        if (usingUrgent.length) candidates = usingUrgent;
    }
    const main = weightedPick(candidates, r => planWeight(r, ctx)) || candidates[0];
    if (!main) return null;
    let sides = [];
    if (weekOptions.withSides) {
        const usedSides = new Set(plan.filter((d, i) => d && i !== index).flatMap(d => d.sides));
        sides = buildSet(main, usedSides).slice(1).map(r => r.id);
    }
    return { date, main: main.id, sides };
}

function generateWeek() {
    const { ok, counts } = applyFilters(RECIPES.filter(r => MAIN_DISH_ROLES.includes(r.role)));
    if (ok.length < weekOptions.days) {
        weekResult.innerHTML = '';
        renderRecipes([], weekResult, { notice: exclusionNotice(counts), emptyHint: emptyHint(counts) });
        return;
    }
    const start = dateStr();
    const plan = new Array(weekOptions.days).fill(null);
    for (let i = 0; i < plan.length; i++) {
        plan[i] = pickPlanDay(plan, i, addDays(start, i), ok);
    }
    state.weekPlan = { withSides: weekOptions.withSides, reuse: weekOptions.reuse, days: plan.filter(Boolean) };
    saveState();
    renderWeek();
}

function rerollDay(index) {
    const plan = state.weekPlan.days;
    const { ok } = applyFilters(RECIPES.filter(r => MAIN_DISH_ROLES.includes(r.role)));
    // 作ったときの形・使い回しの設定で選び直す
    const prev = { withSides: weekOptions.withSides, reuse: weekOptions.reuse };
    weekOptions.withSides = state.weekPlan.withSides;
    weekOptions.reuse = state.weekPlan.reuse !== false;
    const next = pickPlanDay(plan, index, plan[index].date, ok);
    Object.assign(weekOptions, prev);
    if (next) {
        plan[index] = next;
        saveState();
        renderWeek();
    }
}

function weekOptionValue(key, raw) {
    if (key === 'days') return Number(raw);
    if (key === 'withSides') return raw === 'set';
    return raw === 'on'; // reuse
}

function renderWeekOptions() {
    document.querySelectorAll('[data-week]').forEach(group => {
        group.querySelectorAll('button').forEach(b => {
            const key = group.dataset.week;
            b.classList.toggle('selected', weekOptions[key] === weekOptionValue(key, b.dataset.value));
        });
    });
}

document.querySelectorAll('[data-week]').forEach(group => {
    group.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            const key = group.dataset.week;
            weekOptions[key] = weekOptionValue(key, b.dataset.value);
            renderWeekOptions();
        });
    });
});

function renderWeek() {
    renderWeekOptions();
    weekResult.innerHTML = '';
    const plan = state.weekPlan;
    if (!plan) {
        weekResult.innerHTML = '<p class="muted small center">日数と形を選んで「献立を作る」を押してください。ジャンルや主材料が続かないように組み合わせます。</p>';
        return;
    }
    const mains = plan.days.map(d => RECIPE_BY_ID.get(d.main));
    const allItems = plan.days.flatMap(d => [d.main, ...d.sides].map(id => RECIPE_BY_ID.get(id)));
    const perDayKcal = plan.days.map(d => [d.main, ...d.sides].reduce((s, id) => s + RECIPE_BY_ID.get(id).kcal, 0));
    const avg = Math.round(perDayKcal.reduce((a, b) => a + b, 0) / plan.days.length);
    const countBy = (list, key, labelOf) => {
        const c = {};
        list.forEach(r => { const k = labelOf(r[key]); c[k] = (c[k] || 0) + 1; });
        return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="mini-chip">${k} ${v}</span>`).join('');
    };

    // 何日使うか（調味料・薬味を除く）
    const useDays = new Map();
    plan.days.forEach(d => {
        const ings = new Set([d.main, ...d.sides].flatMap(id => shopIngs(RECIPE_BY_ID.get(id))));
        ings.forEach(i => useDays.set(i, (useDays.get(i) || 0) + 1));
    });
    const shared = [...useDays].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    const urgentLeft = [...urgentIngredients()].filter(i => !plan.days.some(d =>
        [d.main, ...d.sides].some(id => RECIPE_BY_ID.get(id).allIngs.includes(i))));

    const summary = document.createElement('div');
    summary.className = 'panel week-summary';
    summary.innerHTML = `
        <p class="small">買う材料 <strong>${useDays.size}</strong> 種類${shared.length ? `・使い回す材料: ${shared.slice(0, 6).map(([i, n]) => `${esc(i)}(${n}日)`).join('、')}` : ''}</p>
        ${urgentLeft.length ? `<p class="small warn">${icon('alarm')}${urgentLeft.map(esc).join('・')} を使う日がありません（日付の横のボタンで作り直せます）</p>` : ''}
        <p><strong>${plan.days.length}日分</strong>・1日あたり 約 <strong>${avg}</strong> kcal<span class="muted small">（${plan.withSides ? '主菜＋副菜・汁物' : '主菜'}／ご飯別・1人前）</span></p>
        <div class="mini-row">${countBy(mains, 'main', k => `${icon(MAIN_CATEGORIES[k].icon)}${MAIN_CATEGORIES[k].label}`)}</div>
        <div class="mini-row">${countBy(mains, 'genre', k => k)}</div>
    `;
    const actions = document.createElement('div');
    actions.className = 'btn-row left';
    const shop = document.createElement('button');
    shop.className = 'primary-btn small';
    shop.innerHTML = `${icon('cart')}全部の材料を買い物リストへ`;
    shop.addEventListener('click', () => addToShopping(allItems));
    const clear = document.createElement('button');
    clear.className = 'text-btn danger';
    clear.textContent = 'この献立を消す';
    clear.addEventListener('click', () => {
        if (!confirm('1週間の献立を消しますか？')) return;
        state.weekPlan = null;
        saveState();
        renderWeek();
    });
    const share = document.createElement('button');
    share.className = 'secondary-btn small';
    share.innerHTML = `${icon('share')}共有`;
    share.addEventListener('click', () => shareText(weekShareText(plan), '1週間の献立'));
    actions.append(shop, share, clear);
    summary.appendChild(actions);
    weekResult.appendChild(summary);

    // 主菜だけのときは日ごとの枠を横に並べる（PC で縦に長くならないように）
    const daysBox = document.createElement('div');
    daysBox.className = 'week-days' + (plan.withSides ? '' : ' grid');
    weekResult.appendChild(daysBox);
    plan.days.forEach((d, index) => {
        const day = document.createElement('section');
        day.className = 'week-day' + (d.date === dateStr() ? ' today' : '');
        const head = document.createElement('div');
        head.className = 'week-day-head';
        head.innerHTML = `<h3>${weekLabel(d.date)}</h3><span class="muted small">約${perDayKcal[index]}kcal</span>`;
        const reroll = document.createElement('button');
        reroll.className = 'icon-btn';
        reroll.title = 'この日だけ作り直す';
        reroll.innerHTML = icon('refresh');
        reroll.setAttribute('aria-label', 'この日だけ作り直す');
        reroll.addEventListener('click', () => rerollDay(index));
        head.appendChild(reroll);
        day.appendChild(head);
        const grid = document.createElement('div');
        grid.className = 'week-cards';
        grid.appendChild(createRecipeCard(RECIPE_BY_ID.get(d.main), { compact: true }));
        d.sides.forEach(id => grid.appendChild(createRecipeCard(RECIPE_BY_ID.get(id), { compact: true, noSet: true })));
        day.appendChild(grid);
        daysBox.appendChild(day);
    });
}

document.getElementById('start-week').addEventListener('click', generateWeek);

// ---------------------------------------------------------------------
// 共有（LINE などに送る）
// ---------------------------------------------------------------------
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');

/** スマホでは共有メニュー、PC ではクリップボードにコピー */
async function shareText(text, label) {
    try {
        if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
            await navigator.share({ text });
            return;
        }
        await navigator.clipboard.writeText(text);
        showToast(`${label}をコピーしました。LINE などに貼り付けて送れます`);
    } catch (e) {
        if (e && e.name === 'AbortError') return; // 共有をキャンセルした
        showToast('コピーできませんでした');
    }
}

function weekShareText(plan) {
    const md = str => { const [, m, d] = str.split('-').map(Number); return `${m}/${d}`; };
    const first = plan.days[0].date;
    const last = plan.days[plan.days.length - 1].date;
    const lines = [`【献立】${md(first)}〜${md(last)}`];
    plan.days.forEach(d => {
        const wd = '日月火水木金土'[weekdayOf(d.date)];
        const main = RECIPE_BY_ID.get(d.main).name;
        const sides = d.sides.map(id => RECIPE_BY_ID.get(id).name);
        lines.push(`${md(d.date)}(${wd}) ${main}${sides.length ? ` ＋ ${sides.join('・')}` : ''}`);
    });
    lines.push('', `— 今日の献立メーカー ${APP_URL}`);
    return lines.join('\n');
}

function setShareText(items, totalKcal, withRice) {
    const lines = ['【今日の献立】'];
    items.forEach(r => lines.push(`${ROLE_LABELS[r.role]}: ${r.name}`));
    if (withRice) lines.push('主食: ご飯');
    lines.push(`（1人あたり 約${totalKcal}kcal）`, '', `— 今日の献立メーカー ${APP_URL}`);
    return lines.join('\n');
}

// ---------------------------------------------------------------------
// 更新のお知らせ・更新履歴
// ---------------------------------------------------------------------
const CHANGELOG = [
    { version: '2.5.0', items: ['絵文字をやめて、どの端末・テーマでも同じに見えるアイコンに'] },
    { version: '2.4.0', items: ['冷蔵庫の材料を覚えるように（「早めに使う」印も付けられる）', '1週間の献立で食材を使い回せるように', '献立・1週間の献立を LINE などに共有', '新しいバージョンのお知らせ'] },
    { version: '2.3.0', items: ['「あと○○があれば作れる」表示', '1週間の献立', 'お気に入り・評価・もう出さない', '辛くない・レンジ・節約・時短の条件', '定番料理に PFC の目安'] },
    { version: '2.2.0', items: ['画面を見やすく作り直し（スマホは下にメニュー）', 'ダークテーマの見やすさを改善'] },
    { version: '2.1.0', items: ['料理628品・材料346種類に', 'アレルギー34項目・調味料の扱いを選べるように', '買い物リスト・バックアップ・ダークモード'] },
    { version: '2.0.0', items: ['アレルギー・栄養表示・食事の記録・ひらめき提案'] },
];
const SEEN_KEY = 'menuPlanner.seenVersion';
const changelogDialog = document.getElementById('changelog-dialog');

function openChangelog(onlyLatest) {
    const list = onlyLatest ? CHANGELOG.slice(0, 1) : CHANGELOG;
    document.getElementById('changelog-title').innerHTML = onlyLatest ? `${icon('sparkle')}v${APP_VERSION} で新しくなりました` : `${icon('notebook')}更新履歴`;
    document.getElementById('changelog-body').innerHTML = list.map(c => `
        <section class="changelog-item">
            <h3>v${c.version}</h3>
            <ul>${c.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        </section>`).join('');
    changelogDialog.showModal();
}

function checkWhatsNew() {
    let seen = null;
    try {
        seen = localStorage.getItem(SEEN_KEY);
        localStorage.setItem(SEEN_KEY, APP_VERSION);
    } catch (e) { return; }
    // 初めて使う人には出さない（前のバージョンを使っていた人だけ）
    const usedBefore = seen !== null || state.history.length > 0 || state.shopping.length > 0;
    if (seen !== APP_VERSION && usedBefore) openChangelog(true);
}

document.getElementById('changelog-close').addEventListener('click', () => changelogDialog.close());
changelogDialog.addEventListener('click', e => { if (e.target === changelogDialog) changelogDialog.close(); });
document.getElementById('app-version').addEventListener('click', () => openChangelog(false));

/** 新しい版が届いたときに画面上部に出すお知らせ（index.html の Service Worker 登録から呼ぶ） */
window.showUpdateBanner = () => {
    document.getElementById('update-banner').hidden = false;
};
document.getElementById('update-reload').addEventListener('click', () => location.reload());
document.getElementById('update-dismiss').addEventListener('click', () => { document.getElementById('update-banner').hidden = true; });

// ---------------------------------------------------------------------
// 初期表示
// ---------------------------------------------------------------------
document.getElementById('app-version').textContent =
    `v${APP_VERSION}（${APP_UPDATED.replace(/-/g, '/')} 更新）・料理 ${RECIPES.length} 品・材料 ${ALL_INGREDIENTS.length} 種類`;
document.body.dataset.tab = 'ingredient-tab';
applyTheme();
renderSettings();
renderConditionBar();
renderInspireSummary();
updateShoppingBadge();
checkWhatsNew();
