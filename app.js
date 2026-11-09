// =====================================================================
// 今日の献立メーカー  メインスクリプト
// 依存: data.js → meta.js → enrich.js の順で読み込まれていること
// =====================================================================

// ---------------------------------------------------------------------
// 保存データ（設定と食事の記録）
// ---------------------------------------------------------------------
const STORE_KEY = 'menuPlanner.v2';
const DEFAULT_SETTINGS = {
    allergens: [],      // ALLERGENS の key
    dislikes: [],       // 苦手な食材（部分一致）
    recentDays: 3,      // この日数以内に食べた料理は出さない（0 = 除外しない）
    minor: 'rare',      // マイナーな料理: never / rare / normal
    hard: 'rare',       // 手間のかかる料理: never / rare / normal
};

function loadState() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
                history: Array.isArray(parsed.history) ? parsed.history.filter(h => RECIPE_BY_ID.has(h.id)) : [],
            };
        }
    } catch (e) { /* 読めなければ初期状態で動かす */ }
    return { settings: { ...DEFAULT_SETTINGS }, history: [] };
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

function baseWeight(r) {
    let w = POP_WEIGHT[state.settings.minor][r.pop - 1] * DIFF_WEIGHT[state.settings.hard][r.diff - 1];
    if (r.role === 'T') w *= 0.3; // おつまみ・軽食は控えめに
    return w;
}

function lastEatenDays() {
    const map = new Map();
    state.history.forEach(h => {
        const n = daysSince(h.date);
        if (!map.has(h.id) || map.get(h.id) > n) map.set(h.id, n);
    });
    return map;
}

function matchesDislike(r) {
    return state.settings.dislikes.some(w => r.name.includes(w) || r.ingredients.some(i => i.includes(w)));
}

/** 設定に引っかかる理由を返す（問題なければ null） */
function exclusionReason(r, eaten) {
    if (r.allergens.some(a => state.settings.allergens.includes(a))) return 'allergy';
    if (matchesDislike(r)) return 'dislike';
    const days = state.settings.recentDays;
    if (days > 0 && eaten.has(r.id) && eaten.get(r.id) < days) return 'recent';
    if (baseWeight(r) === 0) return 'setting';
    return null;
}

/** 設定で除外される料理を取り除き、除外件数も返す */
function applyFilters(list) {
    const eaten = lastEatenDays();
    const counts = { allergy: 0, dislike: 0, recent: 0, setting: 0 };
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
    if (counts.allergy) parts.push(`アレルギー ${counts.allergy}品`);
    if (counts.dislike) parts.push(`苦手な食材 ${counts.dislike}品`);
    if (counts.recent) parts.push(`最近食べた料理 ${counts.recent}品`);
    if (counts.setting) parts.push(`マイナー・手間のかかる料理 ${counts.setting}品`);
    return parts.length ? `設定により ${parts.join('、')} を除外しています` : '';
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
    const seasonal = r.ingredients.find(i => season.ings.includes(i) && i !== 'ねぎ' && i !== 'キャベツ');
    if (COLD_MONTHS.includes(month)) {
        if (WARM_DISH.test(r.name) || r.role === 'N') return { factor: 1.5, reason: '寒い日にあったまる' };
        if (/冷やし|冷奴|ざる|冷しゃぶ|冷製/.test(r.name)) return { factor: 0.4, reason: null };
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
        .map(n => `<span class="nutri-chip lv${r.nutrients[n.key]}" title="${n.label}${r.nutrients[n.key] === 2 ? '（多め）' : ''}">${n.icon}${n.short}${r.nutrients[n.key] === 2 ? '◎' : ''}</span>`)
        .join('');
}

function allergenLine(r) {
    if (r.allergens.length === 0) return '';
    const mine = state.settings.allergens;
    const items = r.allergens.map(k => {
        const label = ALLERGEN_BY_KEY.get(k).label;
        return mine.includes(k) ? `<strong>${label}</strong>` : label;
    });
    return `<p class="recipe-allergens">⚠️ ${items.join('・')}</p>`;
}

function difficultyStars(diff) {
    return '★'.repeat(diff) + '☆'.repeat(3 - diff);
}

function isEatenToday(id) {
    const today = dateStr();
    return state.history.some(h => h.id === id && h.date === today);
}

function createRecipeCard(recipe, opts = {}) {
    const card = document.createElement('div');
    card.className = 'recipe-card' + (opts.compact ? ' compact' : '');
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(recipe.name + ' レシピ')}`;
    const eaten = isEatenToday(recipe.id);
    const canMakeSet = ['K', 'M', 'N'].includes(recipe.role) && !opts.noSet;

    card.innerHTML = `
        ${opts.reason ? `<div class="reason-chip">${esc(opts.reason)}</div>` : ''}
        <h3>${esc(recipe.name)}</h3>
        <div class="recipe-tags">
            <span class="badge">${recipe.genre}</span>
            <span class="badge role-${recipe.role}">${ROLE_LABELS[recipe.role]}</span>
            <span class="badge">⏱ ${recipe.time}</span>
            <span class="badge" title="手間">手間 ${difficultyStars(recipe.diff)}</span>
            ${recipe.pop === 3 ? '<span class="badge minor">レア</span>' : ''}
        </div>
        <p class="recipe-kcal">約 <strong>${recipe.kcal}</strong> kcal<span class="muted">（1人前の目安${recipe.role === 'K' ? '・ご飯別' : ''}）</span></p>
        <div class="nutri-row">${nutrientChips(recipe)}</div>
        ${allergenLine(recipe)}
        ${opts.compact ? '' : `<p class="recipe-ingredients"><strong>材料:</strong> ${recipe.ingredients.map(esc).join(', ')}</p>`}
        ${opts.matchInfo ? `<p class="match-info">${esc(opts.matchInfo)}</p>` : ''}
        <div class="card-actions">
            <a href="${searchUrl}" target="_blank" rel="noopener noreferrer" class="search-recipe-btn">レシピ検索 🔍</a>
            <button class="eat-btn" ${eaten ? 'disabled' : ''}>${eaten ? '✓ 記録済み' : '食べた！🍽️'}</button>
            ${canMakeSet ? '<button class="set-btn">🍱 献立セット</button>' : ''}
        </div>
    `;

    const eatBtn = card.querySelector('.eat-btn');
    eatBtn.addEventListener('click', () => {
        addHistory(recipe.id, dateStr());
        eatBtn.disabled = true;
        eatBtn.textContent = '✓ 記録済み';
        showToast(`「${recipe.name}」を今日の記録に追加しました`);
    });
    if (canMakeSet) {
        card.querySelector('.set-btn').addEventListener('click', () => openSetDialog(recipe));
    }
    return card;
}

const PAGE_SIZE = 24;

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

    if (recipesArray.length === 0) {
        const p = document.createElement('p');
        p.className = 'empty-msg';
        p.textContent = '当てはまる料理が見つかりませんでした😢';
        container.appendChild(p);
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
        if (btn.dataset.target === 'history-tab') renderHistory();
        if (btn.dataset.target === 'inspire-tab') renderInspireSummary();
    });
});

// ---------------------------------------------------------------------
// 1. 材料から探す
// ---------------------------------------------------------------------
const ingredientCategories = {
    '🍖 肉類': ['豚肉', '牛肉', '鶏肉', 'ひき肉', '豚バラ', '手羽先', '手羽元', '手羽中', 'レバー', 'ラム肉', '馬肉', '牛もつ', '豚もつ', '牛すじ', 'チャーシュー', 'ベーコン', 'ウインナー', 'ソーセージ', 'ハム', '生ハム', 'チョリソー', 'サラミ'],
    '🐟 魚介類': ['鮭', 'サーモン', 'サバ', 'アジ', 'マグロ', '白身魚', 'ぶり', '鯛', 'カツオ', 'カレイ', '金目鯛', '赤魚', 'サワラ', '銀だら', '舌平目', 'ホッケ', 'にしん', 'さんま', 'あゆ', 'うなぎ', 'ししゃも', 'イワシ', 'えんがわ', 'ふぐ', 'あんこう', 'タラ', 'ハマチ', 'エビ', 'イカ', 'タコ', 'アサリ', 'はまぐり', 'しじみ', 'カキ', 'ホタテ', 'カニ', 'しらす', '明太子', 'たらこ', 'ツナ', 'ちくわ', 'スモークサーモン', 'クラゲ', 'サメ軟骨', 'タラの胃袋'],
    '🥕 野菜・きのこ': ['キャベツ', '白菜', 'レタス', 'サニーレタス', 'ベビーリーフ', 'トマト', 'ピーマン', 'パプリカ', 'ナス', '大根', 'にんじん', '玉ねぎ', 'じゃがいも', 'さつまいも', '里芋', '長芋', 'かぼちゃ', 'ほうれん草', '小松菜', 'チンゲン菜', 'もやし', 'ブロッコリー', 'アスパラ', 'ゴーヤ', 'ズッキーニ', 'アボカド', 'ごぼう', 'れんこん', 'たけのこ', 'ニラ', 'ねぎ', '生姜', 'にんにく', 'セロリ', 'きゅうり', '水菜', 'せり', '三つ葉', '大葉', 'パクチー', 'バジル', 'グリーンピース', 'コーン', '枝豆', 'そら豆', 'オリーブ', '切り干し大根', '山菜', 'きのこ類', 'しいたけ', '干ししいたけ', 'えのき', 'なめこ', 'まいたけ', 'マッシュルーム', '松茸', 'きくらげ', 'レモン'],
    '🥚 卵・大豆・乳製品': ['卵', '豆腐', '厚揚げ', '油揚げ', 'おから', '豆乳', '大豆', '納豆', 'チーズ', 'モッツァレラチーズ', 'ゴルゴンゾーラチーズ', 'パルメザンチーズ', 'カマンベール', 'ブルーチーズ', 'チェダーチーズ', 'クリームチーズ', 'バター', '牛乳', '生クリーム', 'ヨーグルト'],
    '🍚 主食・粉': ['ご飯', '米', '餅', '小麦粉', 'ホットケーキミックス', 'パン粉', '食パン', 'フランスパン', 'コッペパン', 'バンズ', 'ピザ生地', 'うどん', 'そば', '茶そば', '中華麺', 'ちゃんぽん麺', 'パスタ', 'マカロニ', '米麺', 'ビーフン', '春雨', '餃子の皮', 'シュウマイの皮', '春巻きの皮', 'ライスペーパー', 'そば粉'],
    '🍶 その他': [],
};

const allIngredients = [...new Set(RECIPES.flatMap(r => r.ingredients))];
const ingredientContainer = document.getElementById('ingredient-list');
const selectedIngredients = new Set();
const categorized = new Set(Object.values(ingredientCategories).flat());

function makeIngredientTag(ing) {
    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'ingredient-tag';
    tag.textContent = ing;
    tag.addEventListener('click', () => {
        tag.classList.toggle('selected');
        if (tag.classList.contains('selected')) selectedIngredients.add(ing);
        else selectedIngredients.delete(ing);
        updateSelectedCount();
    });
    return tag;
}

Object.entries(ingredientCategories).forEach(([catName, list]) => {
    const items = catName === '🍶 その他'
        ? allIngredients.filter(i => !categorized.has(i))
        : list.filter(i => allIngredients.includes(i));
    if (items.length === 0) return;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'ingredient-group';
    const groupTitle = document.createElement('h3');
    groupTitle.className = 'ingredient-group-title';
    groupTitle.textContent = catName;
    const groupTagsDiv = document.createElement('div');
    groupTagsDiv.className = 'ingredient-group-tags';
    // 「その他」は量が多いので最初は閉じておく
    if (catName === '🍶 その他') {
        groupTagsDiv.classList.add('collapsed');
        groupTitle.classList.add('collapsed');
    }
    groupTitle.addEventListener('click', () => {
        groupTagsDiv.classList.toggle('collapsed');
        groupTitle.classList.toggle('collapsed');
    });
    items.forEach(ing => groupTagsDiv.appendChild(makeIngredientTag(ing)));
    groupDiv.appendChild(groupTitle);
    groupDiv.appendChild(groupTagsDiv);
    ingredientContainer.appendChild(groupDiv);
});

const searchIngBtn = document.getElementById('search-by-ingredient');
function updateSelectedCount() {
    searchIngBtn.textContent = selectedIngredients.size
        ? `この材料（${selectedIngredients.size}つ）で作れる料理を探す`
        : 'この材料で作れる料理を探す';
}

let ingredientSearched = false;
function runIngredientSearch() {
    ingredientSearched = true;
    const base = selectedIngredients.size === 0
        ? RECIPES
        : RECIPES.filter(r => r.ingredients.some(i => selectedIngredients.has(i)));
    const { ok, counts } = applyFilters(base);
    const matchCount = r => r.ingredients.filter(i => selectedIngredients.has(i)).length;
    ok.sort((a, b) => (matchCount(b) - matchCount(a)) || (baseWeight(b) - baseWeight(a)));
    renderRecipes(ok, 'ingredient-result', {
        notice: exclusionNotice(counts),
        matchInfo: selectedIngredients.size ? r => `選んだ材料のうち ${matchCount(r)} つを使用` : null,
    });
}
searchIngBtn.addEventListener('click', runIngredientSearch);

document.getElementById('clear-ingredients').addEventListener('click', () => {
    selectedIngredients.clear();
    document.querySelectorAll('.ingredient-tag.selected').forEach(t => t.classList.remove('selected'));
    updateSelectedCount();
});

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
            const finalRecipe = weightedPick(ok, baseWeight);
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
            { label: 'がっつり食べたい！🥩', value: 'がっつり' },
            { label: 'ふつう！🥢', value: '普通' },
            { label: 'あっさりでいいかな🥗', value: 'あっさり' },
            { label: 'どれでもいい', value: null },
        ],
    },
    {
        text: 'どのジャンルが食べたい？',
        key: 'genre',
        options: [
            { label: '和食 🍚', value: '和食' },
            { label: '洋食 🍝', value: '洋食' },
            { label: '中華 🥟', value: '中華' },
            { label: '韓国 🌶️', value: '韓国' },
            { label: 'エスニック 🍛', value: 'エスニック' },
            { label: 'なんでもいい！', value: null },
        ],
    },
    {
        text: 'メインは何がいい？',
        key: 'main',
        options: [
            { label: '肉 🍖', value: 'meat' },
            { label: '魚介 🐟', value: 'fish' },
            { label: '卵・大豆 🥚', value: 'eggsoy' },
            { label: '野菜たっぷり 🥦', value: 'veggie' },
            { label: 'なんでもいい！', value: null },
        ],
    },
    {
        text: '調理時間はどうする？',
        key: 'time',
        options: [
            { label: 'パパッと短めで！⏱️', value: '短め' },
            { label: 'じっくり長くてもOK🍳', value: null },
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
        btn.textContent = opt.label;
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
    renderRecipes(keyed.map(x => x.r), questionResult, { notice: exclusionNotice(counts) });
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
        lines.push('最近の記録はバランスよさそうです 👍');
    }
    inspireSummary.innerHTML = lines.map(l => `<p>${l}</p>`).join('');
}

function generateInspiration() {
    const { ok, counts } = applyFilters(RECIPES.filter(r => MAIN_DISH_ROLES.includes(r.role)));
    if (ok.length === 0) {
        renderRecipes([], inspireResult, { notice: exclusionNotice(counts) });
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
        let w = baseWeight(r) * novelty(r) * seasonInfo(r).factor;
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
    if (lacking.length) {
        const key = lacking[0];
        slots.push([r => r.nutrients[key] === 2, () => `🩺 不足ぎみの${nutrientLabel(key)}がとれる`]);
    }
    if (trend) {
        const avoidLabel = trend.topMain ? `${MAIN_CATEGORIES[trend.topMain].label}料理` : trend.topGenre;
        slots.push([
            r => r.main !== trend.topMain && r.genre !== trend.topGenre,
            r => `🔄 最近${avoidLabel}が多いので${trend.topMain ? MAIN_CATEGORIES[r.main].label : r.genre}で気分転換`,
        ]);
    }
    slots.push([r => seasonInfo(r).reason !== null && seasonInfo(r).factor > 1, r => `🍂 ${seasonInfo(r).reason}`]);
    slots.push([r => r.pop >= 2 && !eaten.has(r.id), () => '✨ まだ記録にない料理に挑戦']);
    slots.push([r => r.pop === 1 && (!eaten.has(r.id) || eaten.get(r.id) > 14), () => '🏠 定番だけど最近食べていない']);
    slots.push([r => r.diff === 1, () => '⏱ かんたんに作れる']);

    for (const [cond, reasonFn] of slots) {
        if (picks.length >= 3) break;
        pick(cond, reasonFn);
    }
    while (picks.length < 3 && pick(() => true, () => '💡 こんなのはどう？')) { /* 足りない分を埋める */ }

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
    document.getElementById('start-inspire').textContent = '別の案を見る 💡';
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

function pickSide(main, role, already) {
    const { ok } = applyFilters(RECIPES.filter(r => r.role === role && !already.some(a => a.id === r.id)));
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

function buildSet(main) {
    const items = [main];
    const sideRoles = main.role === 'K' ? ['F', 'S'] : main.role === 'N' ? ['F'] : ['F', 'S'];
    sideRoles.forEach(role => {
        const side = pickSide(main, role, items);
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
    summary.innerHTML = `
        <p>合計 約 <strong>${totalKcal}</strong> kcal</p>
        <div class="nutri-row">${NUTRIENTS.map(n => `<span class="nutri-chip lv${Math.min(2, sum[n.key])}">${n.icon}${n.short}${sum[n.key] >= 2 ? '◎' : sum[n.key] === 0 ? '✕' : ''}</span>`).join('')}</div>
    `;
    const eatAll = document.createElement('button');
    eatAll.className = 'primary-btn small';
    eatAll.textContent = 'セットをまとめて記録 🍽️';
    eatAll.addEventListener('click', () => {
        const today = dateStr();
        items.forEach(r => { if (!isEatenToday(r.id)) addHistory(r.id, today); });
        showToast('献立セットを今日の記録に追加しました');
        setDialog.close();
    });
    summary.appendChild(eatAll);
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
            <span class="balance-label">${n.icon} ${n.label}</span>
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
            li.innerHTML = `<span>${esc(r.name)} <span class="muted small">${ROLE_LABELS[r.role]}</span></span>`;
            const del = document.createElement('button');
            del.className = 'icon-btn';
            del.title = '記録を消す';
            del.textContent = '✕';
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
        { title: '特定原材料（表示義務のある8品目）', items: ALLERGENS.filter(a => a.required) },
        { title: 'その他', items: ALLERGENS.filter(a => !a.required) },
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
        b.textContent = `${w} ✕`;
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
}

function settingsChanged() {
    saveState();
    renderSettings();
}

document.querySelectorAll('[data-setting]').forEach(group => {
    group.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
            const key = group.dataset.setting;
            state.settings[key] = key === 'recentDays' ? Number(b.dataset.value) : b.dataset.value;
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
settingsDialog.addEventListener('close', () => {
    if (ingredientSearched) runIngredientSearch();
    if (!questionResult.classList.contains('hidden')) showQuestionResult();
    if (document.getElementById('history-tab').classList.contains('active')) renderHistory();
});

// ダイアログの外側をタップしたら閉じる
[settingsDialog, setDialog].forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
});

// ---------------------------------------------------------------------
// 初期表示
// ---------------------------------------------------------------------
renderSettings();
renderInspireSummary();
