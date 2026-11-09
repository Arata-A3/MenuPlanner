// =====================================================================
// アイコン（絵文字の代わりに使う線画の SVG）
//   絵文字は OS・ブラウザ・テーマで見た目が変わるので、自前で描いた
//   アイコンを使う。色は文字色（currentColor）に合わせて変わる。
//   使い方: icon('cart') → <svg> の文字列
//   HTML に直接書くとき: <svg class="ic"><use href="#i-cart"></use></svg>
// =====================================================================
const ICONS = {
    // --- 操作
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    cart: '<path d="M3 4.5h2.4l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h8.1a1.5 1.5 0 0 0 1.5-1.1l1.6-6.3H6.2"/><circle cx="9.8" cy="19.6" r="1.3"/><circle cx="17.2" cy="19.6" r="1.3"/>',
    sliders: '<path d="M4 7h9M17.5 7H20M4 17h3.5M12 17h8"/><circle cx="15.3" cy="7" r="2.3"/><circle cx="9.8" cy="17" r="2.3"/>',
    dots: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8z"/>',
    alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.6 1.8M4.2 6l2.6-2.2M19.8 6l-2.6-2.2"/>',
    warning: '<path d="M12 4.2l8.8 15.3H3.2z"/><path d="M12 10v4.3"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
    refresh: '<path d="M19.2 9A7.6 7.6 0 0 0 5.4 8.2M4.8 15a7.6 7.6 0 0 0 13.8.8"/><path d="M19.6 4.5v4.6H15M4.4 19.5v-4.6H9"/>',
    share: '<path d="M12 14.5V4M8.2 7.6L12 3.8l3.8 3.8"/><path d="M6 11v7.7c0 .7.6 1.3 1.3 1.3h9.4c.7 0 1.3-.6 1.3-1.3V11"/>',
    download: '<path d="M12 4v10.5M8 10.6l4 4 4-4"/><path d="M4.8 15.5v3c0 .8.7 1.5 1.5 1.5h11.4c.8 0 1.5-.7 1.5-1.5v-3"/>',
    upload: '<path d="M12 15V4.5M8 8.4l4-4 4 4"/><path d="M4.8 15.5v3c0 .8.7 1.5 1.5 1.5h11.4c.8 0 1.5-.7 1.5-1.5v-3"/>',
    ban: '<circle cx="12" cy="12" r="8.3"/><path d="M6.2 6.2l11.6 11.6"/>',
    'thumb-up': '<path d="M7.5 10.5v9.2H4.3v-9.2z"/><path d="M7.5 10.5l3.5-6c.9-.5 2.3.1 2.2 1.4l-.4 3.6h4.9a1.8 1.8 0 0 1 1.8 2.1l-1.2 6.4a2 2 0 0 1-2 1.7H7.5"/>',
    'thumb-down': '<g transform="rotate(180 12 12)"><path d="M7.5 10.5v9.2H4.3v-9.2z"/><path d="M7.5 10.5l3.5-6c.9-.5 2.3.1 2.2 1.4l-.4 3.6h4.9a1.8 1.8 0 0 1 1.8 2.1l-1.2 6.4a2 2 0 0 1-2 1.7H7.5"/></g>',
    bulb: '<path d="M9.3 17.5h5.4M10.2 20.8h3.6"/><path d="M12 3.3a5.8 5.8 0 0 0-3.5 10.4c.7.6 1 1.3 1 2.1v1.7h5v-1.7c0-.8.3-1.5 1-2.1A5.8 5.8 0 0 0 12 3.3z"/>',
    sparkle: '<path d="M11 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z"/><path d="M18.5 15v5M16 17.5h5"/>',
    home: '<path d="M4 11.2l8-6.7 8 6.7"/><path d="M6.2 9.6v9.9h11.6V9.6"/><path d="M10 19.5v-5h4v5"/>',
    clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.5V12l3 2"/>',
    utensils: '<path d="M7.2 3v7.6M4.6 3v5a2.6 2.6 0 0 0 5.2 0V3M7.2 10.6V21"/><path d="M17.4 21V3c-2 1-3.4 3.6-3.4 7.2v2.9h3.4"/>',
    tray: '<rect x="3.3" y="5" width="17.4" height="14" rx="2.5"/><path d="M12 5v14M12 12h8.7"/>',
    calendar: '<rect x="3.6" y="5" width="16.8" height="15.4" rx="2.4"/><path d="M3.6 9.8h16.8M8 3v4M16 3v4"/><path d="M7.8 13.6h2M14.2 13.6h2M7.8 16.8h2"/>',
    notebook: '<rect x="5" y="4.4" width="14" height="16.6" rx="2"/><path d="M9.2 3h5.6v3H9.2z"/><path d="M8.6 11h6.8M8.6 14.6h4.6"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.6"/><circle cx="8.6" cy="8.6" r="1.25" fill="currentColor" stroke="none"/><circle cx="15.4" cy="15.4" r="1.25" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1.25" fill="currentColor" stroke="none"/><circle cx="8.6" cy="15.4" r="1.25" fill="currentColor" stroke="none"/>',
    chat: '<path d="M5 5h14c.8 0 1.5.7 1.5 1.5v8.4c0 .8-.7 1.5-1.5 1.5h-8.6l-4.6 3.5v-3.5H5c-.8 0-1.5-.7-1.5-1.5V6.5C3.5 5.7 4.2 5 5 5z"/><path d="M8 9.4h8M8 12.4h5"/>',
    fridge: '<rect x="6" y="2.8" width="12" height="18.4" rx="2.2"/><path d="M6 9.6h12M9.2 5.4v2M9.2 12.4v3.2"/>',
    users: '<circle cx="9" cy="8.4" r="3"/><path d="M3.6 19c.6-3.2 2.8-5 5.4-5s4.8 1.8 5.4 5"/><circle cx="16.6" cy="9.4" r="2.4"/><path d="M15.6 14.2c2.6-.3 4.4 1.3 4.9 4.3"/>',
    compass: '<circle cx="12" cy="12" r="8.3"/><path d="M15.4 8.6l-1.9 4.9-4.9 1.9 1.9-4.9z"/>',
    frown: '<circle cx="12" cy="12" r="8.3"/><path d="M8.6 16c.9-1.2 2.1-1.9 3.4-1.9s2.5.7 3.4 1.9"/><circle cx="9.2" cy="10" r=".9" fill="currentColor" stroke="none"/><circle cx="14.8" cy="10" r=".9" fill="currentColor" stroke="none"/>',
    moon: '<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"/>',
    'heart-pulse': '<path d="M12 19.8s-7.4-4.3-7.4-9.8A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.4 2.6c0 5.5-7.4 9.8-7.4 9.8z"/><path d="M7.2 12.2h2.4l1.4-2.3 2 4.3 1.3-2h2.5"/>',
    leaf: '<path d="M5.2 18.8C5 11.2 9.8 5.6 19 5c.4 8.8-4.8 14.2-12.6 14"/><path d="M5.2 18.8l7.2-7.2"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
    flame: '<path d="M12 20.5c-3.6 0-6-2.4-6-5.6 0-3.3 2.4-5 3.4-8.1 1.6 1 2.3 2.6 2.3 4 1-.6 1.6-1.7 1.6-3.4 2.4 1.6 4.7 4.2 4.7 7.5 0 3.2-2.4 5.6-6 5.6z"/>',
    // --- 食べもの
    meat: '<path d="M6 7.6c2.6-3.3 8.4-4 11.9-1.2 3 2.4 3.2 7 .5 9.6-2.4 2.4-5.4 2.2-7.6 3.6-1.8 1.2-4.4 1-5.6-1-1.4-2.4.2-4 .6-5.6.4-1.6-1.3-3.5.2-5.4z"/><circle cx="14" cy="10.6" r="2.2"/>',
    fish: '<path d="M3.5 12c2.8-4 7-5.5 10.7-4.2 2 .7 3.3 2.2 4.3 4.2-1 2-2.3 3.5-4.3 4.2C10.5 17.5 6.3 16 3.5 12z"/><path d="M18.5 12l2.5-3.2v6.4z"/><circle cx="8" cy="11.2" r=".85" fill="currentColor" stroke="none"/>',
    egg: '<path d="M12 3.6c3.4 0 6.3 5.2 6.3 9.3a6.3 6.3 0 0 1-12.6 0c0-4.1 2.9-9.3 6.3-9.3z"/>',
    carrot: '<path d="M14.6 9.4c-2-2-5.4-1.5-6.4 1L4 20l9.6-4.2c2.5-1 3-4.4 1-6.4z"/><path d="M9 13.5l1.6 1.6M11.4 11l1.4 1.4"/><path d="M14.6 9.4l3-3M15.8 4.3c-.4 1.5 0 2.6 1.6 3.1 1.6.5 2.5 1.5 3 3.1M20.2 4.3l-2.6 2.1"/>',
    rice: '<path d="M3.6 11.6h16.8a8.4 8.4 0 0 1-16.8 0z"/><path d="M8.4 20.4h7.2"/><path d="M7 11.6c.5-3 2.6-4.6 5-4.6s4.5 1.6 5 4.6"/>',
    apple: '<path d="M12 7.6c-1.5-1-5-1.2-6.5 1.5-1.8 3.3.3 8.5 2.5 10.5 1.3 1.2 2.5.5 4 .5s2.7.7 4-.5c2.2-2 4.3-7.2 2.5-10.5-1.5-2.7-5-2.5-6.5-1.5z"/><path d="M12 7.6c0-2 .8-3.4 2.4-4"/>',
    bottle: '<path d="M10 3h4v3.4l1.6 2.6v10.8c0 .7-.5 1.2-1.2 1.2H9.6c-.7 0-1.2-.5-1.2-1.2V9L10 6.4z"/><path d="M8.4 12.6h7.2"/>',
    box: '<path d="M4 8l8-4 8 4v8.6l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8.6"/>',
    sprout: '<path d="M12 20.5v-8.3"/><path d="M12 12.2c0-4-2.5-6.6-7-6.6 0 4.5 2.5 6.6 7 6.6zM12 10.4c0-3 2-5.1 6.6-5.1 0 3.8-2.4 5.1-6.6 5.1z"/>',
    wheat: '<path d="M12 21V8.4"/><path d="M12 11.2c-2.2-.2-3.6-1.5-3.8-3.8 2.2.2 3.6 1.6 3.8 3.8zM12 11.2c2.2-.2 3.6-1.5 3.8-3.8-2.2.2-3.6 1.6-3.8 3.8zM12 15.6c-2.2-.2-3.6-1.5-3.8-3.8 2.2.2 3.6 1.6 3.8 3.8zM12 15.6c2.2-.2 3.6-1.5 3.8-3.8-2.2.2-3.6 1.6-3.8 3.8zM12 8.2c-1-1-1-2.7 0-4.4 1 1.7 1 3.4 0 4.4z"/>',
    dumbbell: '<rect x="5" y="6.8" width="3.4" height="10.4" rx="1.1"/><rect x="15.6" y="6.8" width="3.4" height="10.4" rx="1.1"/><path d="M8.4 12h7.2M2.8 10.2v3.6M21.2 10.2v3.6"/>',
    milk: '<path d="M8 8.2l2-4.6h4l2 4.6v12.3H8z"/><path d="M8 8.2h8M10.3 12.6h3.4"/>',
    drop: '<path d="M12 3.6c3 4 6 7 6 10.4a6 6 0 0 1-12 0c0-3.4 3-6.4 6-10.4z"/>',
    chili: '<path d="M15 8.2c-4.2 1-7.4 4.8-10.6 11.4 7.3-1.4 12.3-4.5 13.2-9.1"/><path d="M15 8.2c1.1-1.2 2.6-1.4 3.6-.7.9.7 1.1 2 .2 3"/><path d="M17.6 7c.2-1.4 1-2.4 2.4-3"/>',
    'no-chili': '<path d="M15 8.2c-4.2 1-7.4 4.8-10.6 11.4 7.3-1.4 12.3-4.5 13.2-9.1"/><path d="M15 8.2c1.1-1.2 2.6-1.4 3.6-.7.9.7 1.1 2 .2 3"/><path d="M3.5 3.5l17 17"/>',
    microwave: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><rect x="5.6" y="8.2" width="9.4" height="7.6" rx="1"/><circle cx="18" cy="9.4" r=".8" fill="currentColor" stroke="none"/><circle cx="18" cy="12.2" r=".8" fill="currentColor" stroke="none"/><path d="M17.2 15.4h1.6"/>',
    coin: '<circle cx="12" cy="12" r="8.3"/><path d="M8.9 8.3l3.1 3.8 3.1-3.8M12 12.1v5.2M9.4 13.2h5.2M9.4 15.5h5.2"/>',
};

/** アイコンの SVG 文字列。cls に 'fill' を付けると塗りつぶし */
function icon(name, cls = '') {
    return `<svg class="ic${cls ? ` ${cls}` : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

// ページに一度だけアイコンの定義（sprite）を入れる
(() => {
    const symbols = Object.entries(ICONS)
        .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
        .join('');
    document.body.insertAdjacentHTML('afterbegin',
        `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">${symbols}</svg>`);
})();
