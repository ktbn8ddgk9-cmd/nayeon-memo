'use strict';
/* =============================================================
   나의 메모 — 채팅형 메모 (PWA)
   - IndexedDB에 글/사진 영구 저장
   - 폴더, 검색, 캘린더, 백업/복원, (선택) PIN 잠금
   ============================================================= */

const ALL = 'all';
const DEFAULT_FOLDER = 'f_daily';
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const APP_VERSION = '1.0.0';

const DEFAULT_FOLDERS = [
  { id: 'f_daily',   name: '일상',       emoji: '☕', order: 1 },
  { id: 'f_wish',    name: '쇼핑·위시',  emoji: '🛍️', order: 2 },
  { id: 'f_todo',    name: '할 일',      emoji: '✅', order: 3 },
  { id: 'f_receipt', name: '사진·영수증', emoji: '🧾', order: 4 }
];
const ALL_FOLDER = { id: ALL, name: '전체 메모', emoji: '📚' };
const FOLDER_EMOJIS = ['📁','🌿','💡','🎵','🍳','💊','✈️','🐶','💌','💰','📖','🧸','🏃','🎁','🍰','🧺'];

/* ---------------------------- helpers ---------------------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const pad2 = n => String(n).padStart(2, '0');
const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function h(tag, attrs) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (let i = 2; i < arguments.length; i++) {
    const kid = arguments[i];
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) {
      kid.forEach(k2 => { if (k2 !== null && k2 !== undefined && k2 !== false) node.append(k2.nodeType ? k2 : document.createTextNode(String(k2))); });
    } else {
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
  }
  return node;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
};

/* ---------------------------- dates ---------------------------- */
function dateKeyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function dateFromKey(k) { const p = String(k).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); }
function dateLabel(d) { return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEK[d.getDay()] + ')'; }
function timeLabel(ts) {
  const d = new Date(ts);
  const ap = d.getHours() < 12 ? '오전' : '오후';
  const hh = d.getHours() % 12 || 12;
  return ap + ' ' + hh + ':' + pad2(d.getMinutes());
}
function fmtBytes(n) {
  if (!n || n < 0) return '0 MB';
  const mb = n / (1024 * 1024);
  if (mb < 1) return Math.max(1, Math.round(n / 1024)) + ' KB';
  if (mb < 1024) return mb.toFixed(1) + ' MB';
  return (mb / 1024).toFixed(2) + ' GB';
}

/* ---------------------------- IndexedDB ---------------------------- */
let _dbp = null;
function openDB() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open('na-memo', 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('memos')) {
        const s = d.createObjectStore('memos', { keyPath: 'id' });
        s.createIndex('byDate', 'dateKey');
        s.createIndex('byFolder', 'folderId');
        s.createIndex('byCreated', 'createdAt');
      }
      if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('db blocked'));
  });
  return _dbp;
}
function dbAll(storeName) {
  return openDB().then(d => new Promise((res, rej) => {
    const t = d.transaction(storeName, 'readonly');
    const rq = t.objectStore(storeName).getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = () => rej(rq.error);
  }));
}
function dbGet(storeName, key) {
  return openDB().then(d => new Promise((res, rej) => {
    const t = d.transaction(storeName, 'readonly');
    const rq = t.objectStore(storeName).get(key);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error);
  }));
}
function dbPut(storeName, val) {
  return openDB().then(d => new Promise((res, rej) => {
    const t = d.transaction(storeName, 'readwrite');
    t.objectStore(storeName).put(val);
    t.oncomplete = () => res(val);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
function dbDel(storeName, key) {
  return openDB().then(d => new Promise((res, rej) => {
    const t = d.transaction(storeName, 'readwrite');
    t.objectStore(storeName).delete(key);
    t.oncomplete = () => res(true);
    t.onerror = () => rej(t.error);
  }));
}
function dbClear(storeName) {
  return openDB().then(d => new Promise((res, rej) => {
    const t = d.transaction(storeName, 'readwrite');
    t.objectStore(storeName).clear();
    t.oncomplete = () => res(true);
    t.onerror = () => rej(t.error);
  }));
}

/* ---------------------------- state ---------------------------- */
const state = {
  tab: 'memo',
  lastTab: null,
  folderId: store.get('na-memo.folder', ALL),
  composeFolder: null,
  memos: [],
  folders: [],
  query: '',
  tagFilter: null,
  searchOpen: false,
  focusSearch: false,
  editingId: null,
  pendingImages: [],
  calCursor: new Date(),
  calDate: dateKeyOf(new Date()),
  lock: null,
  scrollBottom: true,
  viewer: { list: [], index: 0 }
};

/* ---------------------------- derived data ---------------------------- */
function folderById(id) {
  if (id === ALL) return ALL_FOLDER;
  return state.folders.find(f => f.id === id) || state.folders[0] || ALL_FOLDER;
}
function composeFolderId() {
  if (state.folderId !== ALL && state.folders.some(f => f.id === state.folderId)) return state.folderId;
  if (state.composeFolder && state.folders.some(f => f.id === state.composeFolder)) return state.composeFolder;
  return state.folders[0] ? state.folders[0].id : DEFAULT_FOLDER;
}
function tagsOf(m) {
  const set = new Set();
  (m.tags || []).forEach(t => {
    const v = String(t).replace(/^#+/, '').trim();
    if (v) set.add(v);
  });
  const text = (m.title || '') + ' ' + (m.body || '');
  const re = /#([^\s#.,!?()[\]{}'"“”]+)/g;
  let mm;
  while ((mm = re.exec(text))) set.add(mm[1]);
  return Array.from(set);
}
function chipTags(m) {
  const text = (m.title || '') + ' ' + (m.body || '');
  return (m.tags || [])
    .map(t => String(t).replace(/^#+/, '').trim())
    .filter(Boolean)
    .filter(t => text.indexOf('#' + t) === -1);
}
function tagsIn(text) {
  const out = [];
  const re = /#([^\s#.,!?()[\]{}'"“”]+)/g;
  let m;
  while ((m = re.exec(text || ''))) out.push(m[1]);
  return out;
}
function folderCount(id) {
  if (id === ALL) return state.memos.length;
  return state.memos.filter(m => m.folderId === id).length;
}
function visibleMemos() {
  let list = state.memos.slice();
  if (state.folderId !== ALL) list = list.filter(m => m.folderId === state.folderId);
  const q = state.query.trim().toLowerCase();
  if (q) {
    list = list.filter(m => {
      const hay = [(m.title || ''), (m.body || ''), tagsOf(m).join(' '), dateLabel(dateFromKey(m.dateKey))].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  if (state.tagFilter) list = list.filter(m => tagsOf(m).indexOf(state.tagFilter) !== -1);
  return list.sort((a, b) => a.createdAt - b.createdAt);
}
function allTags() {
  const counts = new Map();
  const pool = state.folderId === ALL ? state.memos : state.memos.filter(m => m.folderId === state.folderId);
  pool.forEach(m => tagsOf(m).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]);
}
function countsByDate() {
  const map = new Map();
  state.memos.forEach(m => map.set(m.dateKey, (map.get(m.dateKey) || 0) + 1));
  return map;
}

/* ---------------------------- rich text ---------------------------- */
function richText(text) {
  const frag = document.createDocumentFragment();
  const re = /#([^\s#.,!?()[\]{}'"“”]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
    frag.append(h('span', { class: 'tag-inline' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
  return frag;
}

/* ---------------------------- toast ---------------------------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2100);
}

/* =============================================================
   boot
   ============================================================= */
document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  try {
    const existing = await dbAll('folders');
    if (!existing.length) {
      for (const f of DEFAULT_FOLDERS) await dbPut('folders', Object.assign({}, f));
    }
    state.folders = (await dbAll('folders')).sort((a, b) => (a.order || 0) - (b.order || 0));
    state.memos = (await dbAll('memos')).sort((a, b) => a.createdAt - b.createdAt);
    state.lock = await dbGet('meta', 'lock');
  } catch (err) {
    console.error('DB init failed', err);
    state.folders = DEFAULT_FOLDERS.map(f => Object.assign({}, f));
    toast('저장 공간을 열 수 없어요');
  }

  if (state.folderId !== ALL && !state.folders.some(f => f.id === state.folderId)) state.folderId = ALL;
  if (!state.folders.some(f => f.id === DEFAULT_FOLDER) && state.folders.length) state.composeFolder = state.folders[0].id;

  bindEvents();
  setupViewport();
  renderAll();

  if (state.lock && !isUnlocked()) showLock();
  registerSW();
}

/* ---------------------------- viewport (iOS keyboard) ---------------------------- */
function setupViewport() {
  const setH = () => {
    const vv = window.visualViewport;
    const hgt = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', Math.round(hgt) + 'px');
  };
  setH();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      setH();
      if (document.activeElement === $('#compose-text')) scrollToBottom();
    });
    window.visualViewport.addEventListener('scroll', setH);
  }
  window.addEventListener('orientationchange', () => setTimeout(setH, 260));
  window.addEventListener('resize', setH);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is optional */ });
  });
}

/* =============================================================
   events
   ============================================================= */
let eventsBound = false;
function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  $('#tabbar').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  const text = $('#compose-text');
  text.addEventListener('input', () => { autoGrow(); updateSendState(); });
  text.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitMemo(); }
  });
  text.addEventListener('focus', () => { setTimeout(scrollToBottom, 120); });
  $('#compose-title').addEventListener('input', updateSendState);
  $('#compose-title').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#compose-tags').focus(); } });
  $('#compose-tags').addEventListener('input', updateSendState);
  $('#compose-tags').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); text.focus(); } });

  $('#btn-send').addEventListener('click', submitMemo);
  $('#btn-photo').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', async e => {
    const files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    if (files.length) await addImages(files);
  });
  $('#btn-extra').addEventListener('click', () => {
    const next = $('#compose-extra').hidden;
    showExtra(next);
    if (next) setTimeout(() => $('#compose-title').focus(), 80);
  });
  $('#btn-compose-folder').addEventListener('click', () => openFolderSheet('compose'));
  $('#btn-cancel-edit').addEventListener('click', resetComposer);

  $('#import-input').addEventListener('change', async e => {
    const file = (e.target.files || [])[0];
    e.target.value = '';
    if (file) await handleImportFile(file);
  });

  // image viewer
  $('#viewer-close').addEventListener('click', closeViewer);
  $('#viewer-prev').addEventListener('click', () => stepViewer(-1));
  $('#viewer-next').addEventListener('click', () => stepViewer(1));
  $('#viewer').addEventListener('click', e => { if (e.target.id === 'viewer') closeViewer(); });
  $('#viewer-img').addEventListener('click', e => {
    if (state.viewer.list.length > 1) { e.stopPropagation(); stepViewer(1); }
  });

  // lock
  $('#lock-btn').addEventListener('click', tryUnlock);
  $('#lock-input').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('#viewer').hidden) { closeViewer(); return; }
      if (sheetEls) { closeSheet(); return; }
      if (state.searchOpen) closeSearch();
    }
    if (!$('#viewer').hidden && state.viewer.list.length > 1) {
      if (e.key === 'ArrowLeft') stepViewer(-1);
      if (e.key === 'ArrowRight') stepViewer(1);
    }
  });

  // keep scroll anchor sane
  $('#main').addEventListener('scroll', () => {
    const m = $('#main');
    if (m.scrollHeight - m.scrollTop - m.clientHeight > 120) state.scrollBottom = false;
  });
}

function switchTab(tab) {
  if (!tab || tab === state.tab) return;
  state.tab = tab;
  state.searchOpen = false;
  state.query = '';
  state.tagFilter = null;
  if (tab === 'calendar') state.calDate = state.calDate || dateKeyOf(new Date());
  renderAll();
}

/* =============================================================
   render
   ============================================================= */
function renderAll() {
  renderHeader();
  renderView();
  renderComposer();
  renderTabbar();
}

function renderTabbar() {
  Array.prototype.forEach.call(document.querySelectorAll('#tabbar .tab'), b => {
    b.classList.toggle('active', b.dataset.tab === state.tab);
  });
}

/* ---------------- header ---------------- */
function renderHeader() {
  const bar = $('#appbar');
  clear(bar);
  if (state.tab === 'memo') {
    bar.append(state.searchOpen ? searchHeader() : memoHeader());
  } else if (state.tab === 'calendar') {
    bar.append(calendarHeader());
  } else {
    bar.append(h('div', { class: 'appbar-row' }, [
      h('div', { class: 'appbar-title' }, h('span', { class: 'title-lg' }, '설정')),
      h('div', { class: 'appbar-actions' })
    ]));
  }
}

function memoHeader() {
  const f = folderById(state.folderId);
  const searchBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': '검색', html:
    '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6" stroke="currentColor" stroke-width="1.9"/><path d="M15.7 15.7L20 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>'
  });
  searchBtn.addEventListener('click', openSearch);

  const moreBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': '더보기' }, '⋯');
  moreBtn.addEventListener('click', openMoreMenu);

  return h('div', { class: 'memo-head' }, [
    h('button', { class: 'folder-btn', type: 'button', onclick: () => openFolderSheet('view') }, [
      h('span', null, f.emoji),
      h('span', { class: 'folder-name' }, f.name),
      h('span', { class: 'caret' }, '▾')
    ]),
    h('span', { class: 'memo-count' }, '메모 ' + folderCount(state.folderId)),
    h('div', { class: 'appbar-actions' }, [searchBtn, moreBtn])
  ]);
}

function searchHeader() {
  const input = h('input', {
    class: 'search-input', type: 'search', placeholder: '메모 검색 (내용 · #태그)',
    value: state.query, autocomplete: 'off', enterkeyhint: 'search'
  });
  input.addEventListener('input', () => {
    state.query = input.value;
    state.scrollBottom = false;
    renderMemoView();
    $('#main').scrollTop = 0;
    updateSearchCount();
  });

  const row = h('div', { class: 'appbar-row' }, [
    h('div', { class: 'search-box' }, [
      h('span', { class: 'search-ico', html:
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6" stroke="currentColor" stroke-width="1.9"/><path d="M15.7 15.7L20 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>'
      }),
      input
    ]),
    h('button', { class: 'text-btn', type: 'button', onclick: closeSearch }, '취소')
  ]);

  const chips = h('div', { class: 'chips-row' }, h('span', { class: 'search-count', id: 'search-count' }, ''));
  const f = folderById(state.folderId);
  chips.append(h('button', {
    class: 'chip small', type: 'button', onclick: () => openFolderSheet('view')
  }, f.emoji + ' ' + f.name + ' ▾'));

  allTags().slice(0, 30).forEach(t => {
    chips.append(h('button', {
      class: 'chip small' + (state.tagFilter === t ? ' on' : ''), type: 'button',
      onclick: () => { state.tagFilter = state.tagFilter === t ? null : t; renderAll(); }
    }, '#' + t));
  });

  const wrap = h('div', { class: 'search-head' }, [row, chips]);
  setTimeout(() => {
    if (state.focusSearch) {
      state.focusSearch = false;
      input.focus();
      const n = input.value.length;
      try { input.setSelectionRange(n, n); } catch (e) { /* ignore */ }
    }
    updateSearchCount();
  }, 40);
  return wrap;
}

function updateSearchCount() {
  const el = $('#search-count');
  if (!el) return;
  const n = visibleMemos().length;
  el.textContent = n + '개';
}

function openSearch() {
  state.searchOpen = true;
  state.focusSearch = true;
  state.query = '';
  state.tagFilter = null;
  state.scrollBottom = false;
  renderAll();
}
function closeSearch() {
  state.searchOpen = false;
  state.query = '';
  state.tagFilter = null;
  state.scrollBottom = true;
  renderAll();
}

function calendarHeader() {
  const cur = state.calCursor;
  return h('div', { class: 'appbar-row cal-bar' }, [
    h('button', { class: 'nav-btn', type: 'button', 'aria-label': '이전 달', onclick: () => shiftMonth(-1) }, '‹'),
    h('div', { class: 'cal-month' }, cur.getFullYear() + '년 ' + (cur.getMonth() + 1) + '월'),
    h('button', { class: 'nav-btn', type: 'button', 'aria-label': '다음 달', onclick: () => shiftMonth(1) }, '›'),
    h('button', { class: 'today-btn', type: 'button', onclick: goToday }, '오늘')
  ]);
}

function openMoreMenu() {
  openSheet({
    title: '더보기',
    content: menuList([
      { icon: '🗂', label: '폴더 관리', onClick: () => { closeSheet(); setTimeout(openFolderManager, 160); } },
      { icon: '＋', label: '새 폴더 만들기', onClick: () => { closeSheet(); setTimeout(() => openNewFolder({ applyToView: true }), 160); } },
      { icon: '⚙️', label: '설정 · 백업', onClick: () => { closeSheet(); switchTab('settings'); } }
    ])
  });
}

/* ---------------- main view ---------------- */
function renderView() {
  const main = $('#main');
  const prevTop = main.scrollTop;
  const tabChanged = state.lastTab !== state.tab;
  state.lastTab = state.tab;

  const isMemo = state.tab === 'memo';
  $('#view-memo').hidden = !isMemo;
  $('#view-calendar').hidden = state.tab !== 'calendar';
  $('#view-settings').hidden = state.tab !== 'settings';

  if (isMemo) renderMemoView();
  else if (state.tab === 'calendar') renderCalendarView();
  else renderSettingsView();

  if (isMemo) {
    if (state.scrollBottom) { scrollToBottom(); state.scrollBottom = false; }
    else if (tabChanged) main.scrollTop = 0;
    else main.scrollTop = prevTop;
  } else {
    main.scrollTop = tabChanged ? 0 : prevTop;
  }
}

function renderMemoView() {
  const view = $('#view-memo');
  clear(view);
  const list = visibleMemos();

  if (!list.length) {
    const empty = emptyState();
    if (empty) view.append(empty);
    return;
  }

  let lastKey = null;
  list.forEach(m => {
    if (m.dateKey !== lastKey) {
      lastKey = m.dateKey;
      view.append(h('div', { class: 'date-divider' }, h('span', null, dateLabel(dateFromKey(m.dateKey)))));
    }
    view.append(bubbleFor(m));
  });
}

function emptyState() {
  const searching = state.searchOpen && (state.query.trim() || state.tagFilter);
  if (searching) {
    return h('div', { class: 'empty' }, [
      h('div', { class: 'empty-ico' }, '🔍'),
      h('div', { class: 'empty-title' }, '검색 결과가 없어요'),
      h('div', { class: 'empty-sub' }, '다른 키워드나 태그로 찾아보세요')
    ]);
  }
  const f = folderById(state.folderId);
  const hasAny = state.folderId === ALL ? state.memos.length : state.memos.some(m => m.folderId === state.folderId);
  if (hasAny) return null;
  const first = state.memos.length === 0;
  return h('div', { class: 'empty' }, [
    h('div', { class: 'empty-ico' }, f.emoji),
    h('div', { class: 'empty-title' }, first ? '아직 남긴 메모가 없어요' : f.name + '에 남긴 메모가 없어요'),
    h('div', { class: 'empty-sub' }, first ? '아래 입력창에 첫 메모를 남겨보세요 ✍️' : '아래 입력창에서 바로 남길 수 있어요')
  ]);
}

function bubbleFor(m) {
  const bubble = h('div', { class: 'bubble' });
  if (m.title) bubble.append(h('div', { class: 'bubble-title' }, m.title));
  if (m.images && m.images.length) bubble.append(imageGrid(m));
  if (m.body) {
    const p = h('div', { class: 'bubble-text' });
    p.append(richText(m.body));
    bubble.append(p);
  }
  const explicit = chipTags(m);
  if (explicit.length) {
    const row = h('div', { class: 'bubble-tags' });
    explicit.forEach(t => row.append(h('span', { class: 'tag-chip' }, '#' + t)));
    bubble.append(row);
  }

  const meta = h('div', { class: 'msg-meta' }, [
    h('span', { class: 'msg-time' }, timeLabel(m.createdAt)),
    (m.edited || (m.updatedAt && m.updatedAt - m.createdAt > 1000)) ? h('span', { class: 'msg-edited' }, '수정됨') : null,
    h('button', {
      class: 'msg-more', type: 'button', 'aria-label': '메모 메뉴',
      onclick: e => { e.stopPropagation(); openMemoMenu(m); }
    }, '⋯')
  ]);

  const node = h('div', { class: 'msg', dataset: { id: m.id } }, [meta, h('div', { class: 'msg-body' }, bubble)]);
  bindLongPress(bubble, m);
  return node;
}

function imageGrid(m) {
  const n = m.images.length;
  const cls = n === 1 ? 'one' : (n === 2 ? 'two' : 'many');
  const grid = h('div', { class: 'bubble-images ' + cls });
  m.images.forEach((src, i) => {
    const img = h('img', { class: 'bubble-img', src: src, alt: '사진 ' + (i + 1), loading: 'lazy' });
    img.addEventListener('click', e => { e.stopPropagation(); openViewer(m.images, i); });
    img.addEventListener('load', () => {
      const main = $('#main');
      if (main.scrollHeight - main.scrollTop - main.clientHeight < 320) main.scrollTop = main.scrollHeight;
    });
    grid.append(img);
  });
  return grid;
}

function bindLongPress(node, m) {
  let timer = null, sx = 0, sy = 0, moved = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  node.addEventListener('pointerdown', e => {
    if (e.button && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; moved = false;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      if (!moved) {
        try { if (navigator.vibrate) navigator.vibrate(10); } catch (err) { /* ignore */ }
        openMemoMenu(m);
      }
    }, 480);
  });
  node.addEventListener('pointermove', e => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { moved = true; cancel(); }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => node.addEventListener(ev, cancel));
  node.addEventListener('contextmenu', e => e.preventDefault());
}

/* =============================================================
   composer
   ============================================================= */
function renderComposer() {
  const composer = $('#composer');
  composer.hidden = state.tab !== 'memo';
  const f = folderById(composeFolderId());
  const chip = $('#btn-compose-folder');
  chip.textContent = f.emoji + ' ' + f.name;
  chip.classList.toggle('on', state.folderId === ALL && !!state.composeFolder);
  $('#editing-bar').hidden = !state.editingId;
  $('#btn-extra').classList.toggle('on', !$('#compose-extra').hidden);
  $('#btn-extra').setAttribute('aria-pressed', String(!$('#compose-extra').hidden));
  renderPending();
  updateSendState();
}

function renderPending() {
  const wrap = $('#pending-images');
  clear(wrap);
  wrap.hidden = state.pendingImages.length === 0;
  state.pendingImages.forEach((src, i) => {
    const item = h('div', { class: 'pending-item' }, [
      h('img', { src: src, alt: '첨부 사진 ' + (i + 1) }),
      h('button', {
        class: 'pending-x', type: 'button', 'aria-label': '사진 빼기',
        onclick: () => { state.pendingImages.splice(i, 1); renderPending(); updateSendState(); }
      }, '✕')
    ]);
    wrap.append(item);
  });
}

function showExtra(open) {
  $('#compose-extra').hidden = !open;
  renderComposer();
}

function autoGrow() {
  const t = $('#compose-text');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 132) + 'px';
}

function updateSendState() {
  const hasText = $('#compose-text').value.trim() !== '';
  const hasTitle = $('#compose-title').value.trim() !== '';
  const hasImages = state.pendingImages.length > 0;
  $('#btn-send').disabled = !(hasText || hasTitle || hasImages);
}

function resetComposer() {
  state.editingId = null;
  state.pendingImages = [];
  $('#compose-text').value = '';
  $('#compose-title').value = '';
  $('#compose-tags').value = '';
  autoGrow();
  renderComposer();
}

async function submitMemo() {
  const body = $('#compose-text').value.trim();
  const title = $('#compose-title').value.trim();
  const tags = $('#compose-tags').value.split(/[\s,]+/).map(t => t.replace(/^#+/, '').trim()).filter(Boolean);
  const extraTags = tagsIn(title + ' ' + body);
  extraTags.forEach(t => { if (tags.indexOf(t) === -1) tags.push(t); });

  if (!body && !title && !state.pendingImages.length) {
    toast('메모 내용을 입력해 주세요');
    $('#compose-text').focus();
    return;
  }

  const now = Date.now();
  let memo;
  try {
    if (state.editingId) {
      memo = state.memos.find(m => m.id === state.editingId);
      if (!memo) { resetComposer(); return; }
      memo.title = title;
      memo.body = body;
      memo.tags = tags;
      memo.images = state.pendingImages.slice();
      memo.updatedAt = now;
      memo.edited = true;
      await dbPut('memos', memo);
    } else {
      memo = {
        id: uid('m'),
        folderId: composeFolderId(),
        title: title,
        body: body,
        tags: tags,
        images: state.pendingImages.slice(),
        createdAt: now,
        updatedAt: now,
        dateKey: dateKeyOf(new Date(now))
      };
      state.memos.push(memo);
      await dbPut('memos', memo);
    }
  } catch (err) {
    console.error(err);
    toast('저장하지 못했어요. 저장 공간을 확인해 주세요');
    return;
  }

  const wasEdit = !!state.editingId;
  resetComposer();
  state.searchOpen = false;
  state.query = '';
  state.tagFilter = null;
  if (state.folderId !== ALL && memo.folderId !== state.folderId) state.folderId = memo.folderId;
  state.scrollBottom = true;
  renderAll();
  setTimeout(() => { const t = $('#compose-text'); if (t) t.focus(); }, 60);
  if (wasEdit) toast('메모를 수정했어요');
}

function startEdit(m) {
  state.editingId = m.id;
  state.pendingImages = (m.images || []).slice();
  $('#compose-text').value = m.body || '';
  $('#compose-title').value = m.title || '';
  $('#compose-tags').value = (m.tags || []).map(t => '#' + String(t).replace(/^#+/, '')).join(' ');
  if (m.title || (m.tags && m.tags.length)) showExtra(true);
  autoGrow();
  renderComposer();
  const node = document.querySelector('.msg[data-id="' + m.id + '"]');
  if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => { const t = $('#compose-text'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, 140);
}

/* ---------------- images ---------------- */
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image decode failed'));
    img.src = src;
  });
}

async function compressImage(file, maxDim, quality) {
  maxDim = maxDim || 1500;
  quality = quality || 0.82;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let w = img.naturalWidth || img.width;
    let hgt = img.naturalHeight || img.height;
    if (!w || !hgt) throw new Error('empty image');
    const scale = Math.min(1, maxDim / Math.max(w, hgt));
    w = Math.max(1, Math.round(w * scale));
    hgt = Math.max(1, Math.round(hgt * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(img, 0, 0, w, hgt);
    let out = canvas.toDataURL('image/jpeg', quality);
    if (out.length > 900000) out = canvas.toDataURL('image/jpeg', 0.6);
    if (out.length > 1400000) {
      const c2 = document.createElement('canvas');
      c2.width = Math.round(w * 0.7); c2.height = Math.round(hgt * 0.7);
      c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
      out = c2.toDataURL('image/jpeg', 0.6);
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addImages(files) {
  const list = files.slice(0, 12);
  let failed = 0;
  const btn = $('#btn-photo');
  btn.style.opacity = '0.5';
  try {
    for (const f of list) {
      if (!f.type || f.type.indexOf('image/') !== 0) { failed++; continue; }
      try {
        const src = await compressImage(f);
        state.pendingImages.push(src);
        renderPending();
        updateSendState();
      } catch (err) { failed++; }
    }
  } finally {
    btn.style.opacity = '';
  }
  if (failed) toast('사진 ' + failed + '장을 불러오지 못했어요');
}

/* =============================================================
   memo menu
   ============================================================= */
function openMemoMenu(m) {
  const closeThen = fn => () => { closeSheet(); setTimeout(fn, 160); };
  openSheet({
    title: m.title || (m.body ? m.body.slice(0, 24) : '사진 메모'),
    subtitle: dateLabel(dateFromKey(m.dateKey)) + ' · ' + timeLabel(m.createdAt),
    content: menuList([
      { icon: '✏️', label: '수정', onClick: closeThen(() => startEdit(m)) },
      { icon: '📋', label: '복사', onClick: closeThen(() => copyMemo(m)) },
      { icon: '📁', label: '폴더 이동', onClick: closeThen(() => openMoveSheet(m)) },
      { icon: '🗑', label: '삭제', danger: true, onClick: closeThen(() => deleteMemo(m)) }
    ])
  });
}

function copyMemo(m) {
  const parts = [];
  if (m.title) parts.push(m.title);
  if (m.body) parts.push(m.body);
  if (!m.title && !m.body) parts.push('사진 ' + (m.images ? m.images.length : 0) + '장');
  const text = parts.join('\n');
  const done = () => toast('메모를 복사했어요');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('복사하지 못했어요'); }
  ta.remove();
}

async function deleteMemo(m) {
  const ok = await askConfirm({
    title: '이 메모를 삭제할까요?',
    message: m.body ? m.body.slice(0, 50) : ('사진 ' + (m.images ? m.images.length : 0) + '장'),
    okLabel: '삭제',
    danger: true
  });
  if (!ok) return;
  try { await dbDel('memos', m.id); } catch (err) { toast('삭제하지 못했어요'); return; }
  state.memos = state.memos.filter(x => x.id !== m.id);
  if (state.editingId === m.id) resetComposer();
  renderAll();
  toast('메모를 삭제했어요');
}

/* =============================================================
   folders
   ============================================================= */
function openFolderSheet(target) {
  target = target || 'view';
  const list = h('div', { class: 'sheet-list' });
  const items = [ALL_FOLDER].concat(state.folders);
  items.forEach(f => {
    if (target === 'compose' && f.id === ALL) return;
    const active = target === 'compose' ? composeFolderId() === f.id : state.folderId === f.id;
    list.append(h('button', {
      class: 'folder-row' + (active ? ' active' : ''),
      type: 'button',
      onclick: () => {
        if (target === 'compose') state.composeFolder = f.id;
        else {
          state.folderId = f.id;
          store.set('na-memo.folder', f.id);
          state.scrollBottom = true;
        }
        closeSheet();
        renderAll();
      }
    }, [
      h('span', { class: 'folder-row-emoji' }, f.emoji),
      h('span', { class: 'folder-row-name' }, f.name),
      h('span', { class: 'folder-row-count' }, String(folderCount(f.id))),
      h('span', { class: 'check' }, active ? '✓' : '')
    ]));
  });

  const actions = target === 'compose' ? [] : [
    { label: '＋ 새 폴더', onClick: () => setTimeout(() => openNewFolder({ applyToView: true }), 170) },
    { label: '폴더 관리', onClick: () => setTimeout(openFolderManager, 170) }
  ];

  openSheet({
    title: target === 'compose' ? '어느 폴더에 담을까요?' : '폴더',
    subtitle: target === 'compose' ? '메모를 담을 폴더를 골라 주세요' : '폴더를 눌러 이동하세요',
    content: list,
    actions: actions
  });
}

function openNewFolder(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let emoji = FOLDER_EMOJIS.find(e => !state.folders.some(f => f.emoji === e)) || '📁';
    const input = h('input', { class: 'field', type: 'text', placeholder: '폴더 이름 (예: 여행 준비)', maxlength: 20, autocomplete: 'off' });
    const emojiWrap = h('div', { class: 'emoji-grid' });
    FOLDER_EMOJIS.forEach(e => {
      const b = h('button', { class: 'chip small' + (e === emoji ? ' on' : ''), type: 'button' }, e);
      b.addEventListener('click', () => {
        emoji = e;
        Array.prototype.forEach.call(emojiWrap.children, c => c.classList.toggle('on', c === b));
      });
      emojiWrap.append(b);
    });

    let done = false;
    let busy = false;
    const finish = created => {
      if (done) return;
      done = true;
      closeSheet();
      resolve(created);
    };

    openSheet({
      title: '새 폴더',
      subtitle: '이름과 이모지를 골라 주세요',
      content: h('div', { class: 'sheet-form' }, [input, h('p', { class: 'sheet-msg' }, '이모지'), emojiWrap]),
      actions: [
        { label: '취소', onClick: () => finish(null) },
        {
          label: '만들기',
          primary: true,
          onClick: () => {
            if (busy) return false;
            const name = input.value.trim();
            if (!name) { input.focus(); toast('폴더 이름을 입력해 주세요'); return false; }
            if (state.folders.some(f => f.name === name)) { toast('같은 이름의 폴더가 있어요'); return false; }
            busy = true;
            const nf = {
              id: uid('f'),
              name: name,
              emoji: emoji,
              order: state.folders.reduce((mx, f) => Math.max(mx, f.order || 0), 0) + 1
            };
            state.folders.push(nf);
            dbPut('folders', nf).then(() => {
              if (opts.applyToView !== false) {
                state.folderId = nf.id;
                store.set('na-memo.folder', nf.id);
                state.scrollBottom = true;
              } else {
                state.composeFolder = nf.id;
              }
              renderAll();
              toast('‘' + name + '’ 폴더를 만들었어요');
              finish(nf);
            }).catch(() => { busy = false; toast('폴더를 저장하지 못했어요'); });
            return false;
          }
        }
      ],
      onClose: () => { if (!done) { done = true; resolve(null); } }
    });
    setTimeout(() => input.focus(), 140);
  });
}

function openFolderManager() {
  const list = h('div', { class: 'sheet-list' });
  if (!state.folders.length) list.append(h('p', { class: 'sheet-msg' }, '폴더가 없어요.'));
  state.folders.forEach(f => {
    list.append(h('div', { class: 'folder-row' }, [
      h('span', { class: 'folder-row-emoji' }, f.emoji),
      h('span', { class: 'folder-row-name' }, f.name + '  ' ),
      h('span', { class: 'folder-row-count' }, String(folderCount(f.id))),
      h('button', { class: 'mini-btn', type: 'button', onclick: () => renameFolder(f) }, '이름'),
      h('button', { class: 'mini-btn danger', type: 'button', onclick: () => deleteFolder(f) }, '삭제')
    ]));
  });
  openSheet({
    title: '폴더 관리',
    subtitle: '메모는 폴더를 지워도 사라지지 않아요',
    content: list,
    actions: [{ label: '＋ 새 폴더', primary: true, onClick: () => setTimeout(() => openNewFolder({ applyToView: false }), 170) }]
  });
}

async function renameFolder(f) {
  const name = await askText({
    title: '폴더 이름 변경',
    value: f.name,
    placeholder: '새 이름',
    maxlength: 20,
    okLabel: '저장'
  });
  if (!name || name === f.name) { if (name === f.name) setTimeout(openFolderManager, 180); return; }
  if (state.folders.some(x => x.id !== f.id && x.name === name)) { toast('같은 이름의 폴더가 있어요'); setTimeout(openFolderManager, 180); return; }
  f.name = name;
  try { await dbPut('folders', f); } catch (e) { toast('저장하지 못했어요'); }
  renderAll();
  toast('폴더 이름을 바꿨어요');
  setTimeout(openFolderManager, 200);
}

async function deleteFolder(f) {
  const target = state.folders.find(x => x.id !== f.id);
  if (!target) { toast('폴더는 하나 이상 있어야 해요'); return; }
  const count = folderCount(f.id);
  const ok = await askConfirm({
    title: '‘' + f.name + '’ 폴더를 삭제할까요?',
    message: count ? ('메모 ' + count + '개는 ‘' + target.name + '’ 폴더로 옮겨져요.') : '비어 있는 폴더예요.',
    okLabel: '삭제',
    danger: true
  });
  if (!ok) { setTimeout(openFolderManager, 180); return; }
  const affected = state.memos.filter(m => m.folderId === f.id);
  for (const m of affected) {
    m.folderId = target.id;
    try { await dbPut('memos', m); } catch (e) { /* keep going */ }
  }
  try { await dbDel('folders', f.id); } catch (e) { /* ignore */ }
  state.folders = state.folders.filter(x => x.id !== f.id);
  if (state.folderId === f.id) { state.folderId = ALL; store.set('na-memo.folder', ALL); }
  if (state.composeFolder === f.id) state.composeFolder = null;
  renderAll();
  toast('폴더를 삭제했어요');
  setTimeout(openFolderManager, 200);
}

function openMoveSheet(m) {
  const list = h('div', { class: 'sheet-list' });
  state.folders.forEach(f => {
    list.append(h('button', {
      class: 'folder-row' + (m.folderId === f.id ? ' active' : ''),
      type: 'button',
      onclick: async () => {
        closeSheet();
        if (m.folderId === f.id) return;
        m.folderId = f.id;
        try { await dbPut('memos', m); } catch (e) { toast('옮기지 못했어요'); return; }
        renderAll();
        toast('‘' + f.name + '’ 폴더로 옮겼어요');
      }
    }, [
      h('span', { class: 'folder-row-emoji' }, f.emoji),
      h('span', { class: 'folder-row-name' }, f.name),
      h('span', { class: 'check' }, m.folderId === f.id ? '✓' : '')
    ]));
  });
  openSheet({ title: '폴더 이동', subtitle: '이 메모를 담을 폴더를 골라 주세요', content: list });
}

/* =============================================================
   calendar
   ============================================================= */
function shiftMonth(n) {
  const c = state.calCursor;
  state.calCursor = new Date(c.getFullYear(), c.getMonth() + n, 1);
  renderAll();
}
function goToday() {
  const now = new Date();
  state.calCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  state.calDate = dateKeyOf(now);
  renderAll();
}

function renderCalendarView() {
  const view = $('#view-calendar');
  clear(view);
  const cur = state.calCursor;
  const y = cur.getFullYear(), mo = cur.getMonth();
  const counts = countsByDate();
  const todayKey = dateKeyOf(new Date());

  const grid = h('div', { class: 'cal-grid' });
  WEEK.forEach((w, i) => grid.append(h('div', { class: 'cal-dow ' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') }, w)));

  const firstDow = new Date(y, mo, 1).getDay();
  const dim = new Date(y, mo + 1, 0).getDate();
  for (let i = 0; i < firstDow; i++) grid.append(h('div', { class: 'cal-cell blank' }));
  for (let d = 1; d <= dim; d++) {
    const key = y + '-' + pad2(mo + 1) + '-' + pad2(d);
    const dow = new Date(y, mo, d).getDay();
    const cls = ['cal-cell'];
    if (dow === 0) cls.push('sun');
    if (dow === 6) cls.push('sat');
    if (key === todayKey) cls.push('today');
    if (key === state.calDate) cls.push('selected');
    const cell = h('button', { class: cls.join(' '), type: 'button', onclick: () => { state.calDate = key; renderAll(); } },
      h('span', { class: 'cal-num' }, String(d)));
    if (counts.get(key)) cell.append(h('span', { class: 'cal-dot' }));
    grid.append(cell);
  }

  view.append(h('div', { class: 'cal-wrap' }, grid));

  const sel = state.memos.filter(m => m.dateKey === state.calDate).sort((a, b) => a.createdAt - b.createdAt);
  view.append(h('div', { class: 'cal-day-head' }, [
    h('div', { class: 'cal-day-title' }, dateLabel(dateFromKey(state.calDate))),
    h('div', { class: 'cal-day-count' }, sel.length ? sel.length + '개' : '')
  ]));

  if (!sel.length) {
    view.append(h('div', { class: 'cal-empty' }, '이 날은 남긴 메모가 없어요'));
  } else {
    const list = h('div', { class: 'cal-list' });
    sel.forEach(m => list.append(calItem(m)));
    view.append(list);
  }
  view.append(h('div', { class: 'cal-bottom-space' }));
}

function calItem(m) {
  const tags = chipTags(m);
  return h('button', { class: 'cal-item', type: 'button', onclick: () => jumpToMemo(m) }, [
    h('div', { class: 'cal-item-top' }, [
      h('span', null, timeLabel(m.createdAt)),
      (m.images && m.images.length) ? h('span', { class: 'cal-item-badge' }, '📷 ' + m.images.length) : null,
      h('span', { class: 'cal-item-folder' }, folderById(m.folderId).emoji + ' ' + folderById(m.folderId).name)
    ]),
    m.title ? h('div', { class: 'cal-item-title' }, m.title) : null,
    m.body ? h('div', { class: 'cal-item-body' }, m.body) : null,
    tags.length ? h('div', { class: 'bubble-tags' }, tags.slice(0, 6).map(t => h('span', { class: 'tag-chip' }, '#' + t))) : null
  ]);
}

function jumpToMemo(m) {
  state.tab = 'memo';
  state.searchOpen = false;
  state.query = '';
  state.tagFilter = null;
  state.folderId = ALL;
  state.scrollBottom = false;
  renderAll();
  setTimeout(() => {
    const node = document.querySelector('.msg[data-id="' + m.id + '"]');
    if (node) {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node.classList.add('flash');
      setTimeout(() => node.classList.remove('flash'), 1700);
    }
  }, 90);
}

/* =============================================================
   settings
   ============================================================= */
function setSection(title, rows) {
  return h('section', { class: 'set-section' }, [
    h('h2', { class: 'set-section-title' }, title),
    h('div', { class: 'set-group' }, rows)
  ]);
}
function setRow(opts) {
  return h('button', {
    class: 'set-row' + (opts.danger ? ' danger' : ''),
    type: 'button',
    onclick: opts.onClick || null
  }, [
    h('span', { class: 'set-ico' }, opts.icon || ''),
    h('span', { class: 'set-row-main' }, [
      h('span', { class: 'set-row-title' }, opts.title),
      opts.sub ? h('span', { class: 'set-row-sub' }, opts.sub) : null
    ]),
    h('span', { class: 'set-chev' }, opts.onClick ? '›' : '')
  ]);
}

function renderSettingsView() {
  const view = $('#view-settings');
  clear(view);
  const photoCount = state.memos.reduce((n, m) => n + (m.images ? m.images.length : 0), 0);

  const wrap = h('div', { class: 'settings' }, [
    h('div', { class: 'set-hero' }, [
      h('div', { class: 'set-stat' }, [h('b', null, String(state.memos.length)), h('span', null, '메모')]),
      h('div', { class: 'set-stat' }, [h('b', null, String(state.folders.length)), h('span', null, '폴더')]),
      h('div', { class: 'set-stat' }, [h('b', null, String(photoCount)), h('span', null, '사진')])
    ])
  ]);

  wrap.append(setSection('백업 · 복원', [
    setRow({ icon: '📤', title: '메모 내보내기', sub: '모든 글과 사진을 JSON 파일로 저장', onClick: exportJSON }),
    setRow({ icon: '📥', title: '백업 불러오기', sub: 'JSON 파일에서 메모 복원', onClick: () => $('#import-input').click() })
  ]));
  wrap.append(h('p', { class: 'set-note' }, '메모는 이 기기의 브라우저(IndexedDB)에만 저장돼요. 폰을 바꾸거나 앱을 지우기 전에 꼭 백업해 주세요.'));

  wrap.append(setSection('폴더', [
    setRow({ icon: '🗂', title: '폴더 관리', sub: '추가 · 이름 변경 · 삭제', onClick: openFolderManager })
  ]));

  const lockRows = [];
  if (state.lock) {
    lockRows.push(setRow({ icon: '🔓', title: 'PIN 변경', sub: '잠금 번호를 새로 정해요', onClick: openSetPin }));
    lockRows.push(setRow({ icon: '🔒', title: '잠금 끄기', sub: '앱을 열 때 PIN을 묻지 않아요', onClick: turnOffLock }));
  } else {
    lockRows.push(setRow({ icon: '🔒', title: '앱 잠금 켜기', sub: '4~8자리 PIN으로 앱을 잠가요', onClick: openSetPin }));
  }
  wrap.append(setSection('잠금 (선택)', lockRows));
  wrap.append(h('p', { class: 'set-note' }, state.lock
    ? '⚠️ PIN을 잊으면 앱을 열 수 없어요. 잠그기 전에 백업 파일을 만들어 두세요.'
    : 'PIN은 이 기기에만 저장되고 어디로도 전송되지 않아요. PIN을 잊으면 되돌릴 수 없으니 백업 후 켜 주세요.'));

  const usage = h('div', { class: 'set-note in-group' }, '확인 중…');
  wrap.append(setSection('저장 공간', [
    setRow({ icon: '📌', title: '저장 공간 보호 요청', sub: '브라우저가 데이터를 임의로 지우지 않도록', onClick: requestPersist }),
    usage
  ]));
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(est => {
      usage.textContent = '사용 중 ' + fmtBytes(est.usage || 0) + ' · 브라우저 한도 ' + fmtBytes(est.quota || 0);
    }).catch(() => { usage.textContent = '저장 공간 정보를 가져올 수 없어요'; });
  } else {
    usage.textContent = '이 브라우저는 저장 공간 정보를 제공하지 않아요';
  }

  wrap.append(setSection('앱처럼 쓰기', [
    h('div', { class: 'set-row' }, [
      h('span', { class: 'set-ico' }, '📱'),
      h('span', { class: 'set-row-main' }, [
        h('span', { class: 'set-row-title' }, '홈 화면에 추가'),
        h('span', { class: 'set-row-sub' }, 'Safari 하단 공유 버튼 → 홈 화면에 추가 → ‘나의 메모’')
      ])
    ])
  ]));

  wrap.append(h('div', { class: 'set-foot' }, '나의 메모 v' + APP_VERSION + '\n오프라인에서도 열려요'));
  view.append(wrap);
}

async function requestPersist() {
  if (!navigator.storage || !navigator.storage.persist) { toast('이 브라우저는 지원하지 않아요'); return; }
  try {
    const ok = await navigator.storage.persist();
    toast(ok ? '저장 공간이 보호됩니다' : '브라우저가 요청을 거절했어요');
  } catch (e) { toast('요청하지 못했어요'); }
}

/* ---------------- backup ---------------- */
async function exportJSON() {
  try {
    const data = {
      app: 'na-memo',
      version: 1,
      exportedAt: new Date().toISOString(),
      folders: state.folders,
      memos: state.memos
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: '나의메모-백업-' + dateKeyOf(new Date()) + '.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    toast('백업 파일을 저장했어요');
  } catch (e) {
    console.error(e);
    toast('내보내지 못했어요');
  }
}

async function handleImportFile(file) {
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch (e) {
    toast('JSON 파일을 읽지 못했어요');
    return;
  }
  if (!data || !Array.isArray(data.memos)) { toast('백업 파일 형식이 아니에요'); return; }
  const folders = Array.isArray(data.folders) ? data.folders.length : 0;
  openSheet({
    title: '백업 불러오기',
    subtitle: '메모 ' + data.memos.length + '개 · 폴더 ' + folders + '개',
    content: h('p', { class: 'sheet-msg' }, '지금 있는 메모에 더할지, 전부 지우고 복원할지 골라 주세요.'),
    actions: [
      { label: '지금 메모에 추가', onClick: () => importData(data, 'merge') },
      {
        label: '전부 지우고 복원',
        primary: true,
        danger: true,
        onClick: () => {
          setTimeout(async () => {
            const ok = await askConfirm({
              title: '전부 지우고 복원할까요?',
              message: '지금 이 기기의 메모 ' + state.memos.length + '개가 모두 지워지고 백업 파일로 바뀝니다.',
              okLabel: '복원',
              danger: true
            });
            if (ok) await importData(data, 'replace');
          }, 180);
        }
      }
    ]
  });
}

async function importData(data, mode) {
  try {
    const incomingFolders = (data.folders || []).filter(f => f && f.id && f.name);
    const incomingMemos = (data.memos || []).filter(m => m && (m.body || m.title || (Array.isArray(m.images) && m.images.length)));

    if (mode === 'replace') {
      await dbClear('memos');
      await dbClear('folders');
      state.memos = [];
      state.folders = [];
      state.folderId = ALL;
    }

    const idMap = new Map();
    for (const f of incomingFolders) {
      const byId = state.folders.find(x => x.id === f.id);
      const byName = state.folders.find(x => x.name === f.name);
      if (byId) { idMap.set(f.id, byId.id); continue; }
      if (byName) { idMap.set(f.id, byName.id); continue; }
      const nf = { id: f.id, name: f.name, emoji: f.emoji || '📁', order: state.folders.length + 1 };
      state.folders.push(nf);
      idMap.set(f.id, nf.id);
      await dbPut('folders', nf);
    }
    if (!state.folders.length) {
      const df = Object.assign({}, DEFAULT_FOLDERS[0]);
      state.folders.push(df);
      await dbPut('folders', df);
    }
    const fallback = state.folders[0].id;

    let added = 0;
    const existingIds = new Set(state.memos.map(m => m.id));
    for (const raw of incomingMemos) {
      let id = raw.id || uid('m');
      if (existingIds.has(id)) id = uid('m');
      const createdAt = Number(raw.createdAt) || Date.now();
      const memo = {
        id: id,
        folderId: idMap.get(raw.folderId) || (state.folders.some(f => f.id === raw.folderId) ? raw.folderId : fallback),
        title: raw.title || '',
        body: raw.body || '',
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        images: Array.isArray(raw.images) ? raw.images.filter(s => typeof s === 'string') : [],
        createdAt: createdAt,
        updatedAt: Number(raw.updatedAt) || createdAt,
        edited: !!raw.edited,
        dateKey: raw.dateKey || dateKeyOf(new Date(createdAt))
      };
      state.memos.push(memo);
      existingIds.add(id);
      await dbPut('memos', memo);
      added++;
    }
    state.memos.sort((a, b) => a.createdAt - b.createdAt);
    state.folders.sort((a, b) => (a.order || 0) - (b.order || 0));
    state.scrollBottom = true;
    renderAll();
    toast('메모 ' + added + '개를 불러왔어요');
  } catch (e) {
    console.error(e);
    toast('불러오지 못했어요');
  }
}

/* =============================================================
   images viewer
   ============================================================= */
function openViewer(list, index) {
  if (!list || !list.length) return;
  state.viewer.list = list;
  state.viewer.index = index || 0;
  $('#viewer').hidden = false;
  drawViewer();
}
function drawViewer() {
  const v = state.viewer;
  const img = $('#viewer-img');
  img.src = v.list[v.index];
  img.alt = '사진 ' + (v.index + 1);
  const multi = v.list.length > 1;
  $('#viewer-prev').hidden = !multi;
  $('#viewer-next').hidden = !multi;
  $('#viewer-count').textContent = multi ? (v.index + 1) + ' / ' + v.list.length : '';
}
function stepViewer(dir) {
  const v = state.viewer;
  if (v.list.length < 2) return;
  v.index = (v.index + dir + v.list.length) % v.list.length;
  drawViewer();
}
function closeViewer() {
  $('#viewer').hidden = true;
  $('#viewer-img').src = '';
  state.viewer = { list: [], index: 0 };
}

/* =============================================================
   lock
   ============================================================= */
function isUnlocked() {
  try { return sessionStorage.getItem('na-memo.unlocked') === '1'; } catch (e) { return true; }
}
function setUnlocked(flag) {
  try { flag ? sessionStorage.setItem('na-memo.unlocked', '1') : sessionStorage.removeItem('na-memo.unlocked'); } catch (e) { /* ignore */ }
}
async function hashPin(pin, salt) {
  const s = salt + ':' + pin;
  if (window.crypto && window.crypto.subtle && window.TextEncoder) {
    try {
      const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return Array.prototype.map.call(new Uint8Array(buf), b => ('00' + b.toString(16)).slice(-2)).join('');
    } catch (e) { /* fall through */ }
  }
  let hv = 5381;
  for (let i = 0; i < s.length; i++) hv = ((hv * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'fb' + hv.toString(16);
}
function showLock() {
  $('#lock-screen').hidden = false;
  $('#lock-msg').textContent = '';
  $('#lock-input').value = '';
  setTimeout(() => $('#lock-input').focus(), 120);
}
async function tryUnlock() {
  const pin = $('#lock-input').value.trim();
  if (!pin) return;
  const lock = state.lock;
  if (!lock) { $('#lock-screen').hidden = true; return; }
  const hv = await hashPin(pin, lock.salt);
  if (hv === lock.hash) {
    setUnlocked(true);
    $('#lock-screen').hidden = true;
    renderAll();
  } else {
    $('#lock-msg').textContent = 'PIN이 맞지 않아요';
    $('#lock-input').value = '';
    $('#lock-input').focus();
  }
}
async function openSetPin() {
  const pin1 = await askText({
    title: '앱 잠금 PIN',
    message: '4~8자리 숫자를 입력해 주세요.',
    placeholder: '예: 1234',
    inputmode: 'numeric',
    type: 'password',
    maxlength: 8,
    okLabel: '다음'
  });
  if (!pin1) return;
  if (!/^\d{4,8}$/.test(pin1)) { toast('숫자 4~8자리로 정해 주세요'); return; }
  const pin2 = await askText({
    title: 'PIN 확인',
    message: '같은 번호를 한 번 더 입력해 주세요.',
    inputmode: 'numeric',
    type: 'password',
    maxlength: 8,
    okLabel: state.lock ? 'PIN 변경' : '잠금 켜기'
  });
  if (!pin2) return;
  if (pin1 !== pin2) { toast('PIN이 서로 달라요'); return; }
  const salt = uid('s');
  const rec = { key: 'lock', salt: salt, hash: await hashPin(pin1, salt), at: Date.now() };
  try {
    await dbPut('meta', rec);
    state.lock = rec;
    setUnlocked(true);
    renderAll();
    toast(state.lock ? 'PIN을 설정했어요' : '앱 잠금을 켰어요');
  } catch (e) {
    toast('잠금을 저장하지 못했어요');
  }
}
async function turnOffLock() {
  const pin = await askText({
    title: '잠금 끄기',
    message: '지금 쓰는 PIN을 입력해 주세요.',
    inputmode: 'numeric',
    type: 'password',
    maxlength: 8,
    okLabel: '잠금 끄기'
  });
  if (!pin) return;
  if (!state.lock) return;
  const hv = await hashPin(pin, state.lock.salt);
  if (hv !== state.lock.hash) { toast('PIN이 맞지 않아요'); return; }
  try {
    await dbDel('meta', 'lock');
    state.lock = null;
    setUnlocked(false);
    renderAll();
    toast('앱 잠금을 껐어요');
  } catch (e) {
    toast('잠금을 끄지 못했어요');
  }
}

/* =============================================================
   sheet / dialog primitives
   ============================================================= */
let sheetEls = null;
let sheetOnClose = null;

function menuList(items) {
  const wrap = h('div', { class: 'sheet-list' });
  items.forEach(it => {
    wrap.append(h('button', {
      class: 'menu-item' + (it.danger ? ' danger' : ''),
      type: 'button',
      onclick: it.onClick
    }, [
      h('span', { class: 'menu-ico' }, it.icon || ''),
      h('span', { class: 'menu-label' }, it.label)
    ]));
  });
  return wrap;
}

function closeSheet() {
  if (!sheetEls) return;
  const els = sheetEls;
  sheetEls = null;
  const cb = sheetOnClose;
  sheetOnClose = null;
  els.panel.classList.remove('in');
  els.backdrop.classList.remove('in');
  setTimeout(() => { els.panel.remove(); els.backdrop.remove(); }, 220);
  if (cb) cb();
}

function openSheet(opts) {
  opts = opts || {};
  closeSheet();

  const backdrop = h('div', { class: 'sheet-backdrop' });
  backdrop.addEventListener('click', closeSheet);

  const panel = h('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' });
  panel.append(h('div', { class: 'sheet-grab' }));
  if (opts.title) panel.append(h('div', { class: 'sheet-title' }, opts.title));
  if (opts.subtitle) panel.append(h('div', { class: 'sheet-sub' }, opts.subtitle));
  if (opts.content) panel.append(opts.content);

  if (opts.actions && opts.actions.length) {
    const bar = h('div', { class: 'sheet-actions' });
    opts.actions.forEach(a => {
      const btn = h('button', {
        class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
        type: 'button'
      }, a.label);
      btn.addEventListener('click', () => {
        const mine = sheetEls;
        const fn = a.onClick;
        let r;
        try { r = fn ? fn() : undefined; } catch (e) { console.error(e); }
        if (r === false) return;
        if (sheetEls === mine) closeSheet();
      });
      bar.append(btn);
    });
    panel.append(bar);
  }

  $('#sheet-root').append(backdrop, panel);
  sheetEls = { backdrop: backdrop, panel: panel };
  sheetOnClose = opts.onClose || null;
  requestAnimationFrame(() => {
    backdrop.classList.add('in');
    panel.classList.add('in');
  });
}

function askText(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const input = h('input', {
      class: 'field',
      type: opts.type || 'text',
      value: opts.value || '',
      placeholder: opts.placeholder || '',
      maxlength: opts.maxlength || 40,
      inputmode: opts.inputmode || 'text',
      autocomplete: 'off'
    });
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      closeSheet();
      resolve(v);
    };
    openSheet({
      title: opts.title || '',
      content: h('div', { class: 'sheet-form' }, [
        opts.message ? h('p', { class: 'sheet-msg' }, opts.message) : null,
        input
      ]),
      actions: [
        { label: '취소', onClick: () => finish(null) },
        {
          label: opts.okLabel || '저장',
          primary: true,
          onClick: () => {
            const v = input.value.trim();
            if (!v) { input.focus(); return false; }
            finish(v);
            return false;
          }
        }
      ],
      onClose: () => { if (!done) { done = true; resolve(null); } }
    });
    setTimeout(() => input.focus(), 140);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); if (v) finish(v); }
    });
  });
}

function askConfirm(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      closeSheet();
      resolve(v);
    };
    openSheet({
      title: opts.title || '',
      subtitle: opts.message || '',
      content: opts.danger ? h('div', { class: 'warn' }, '⚠️ 되돌릴 수 없는 작업이에요') : null,
      actions: [
        { label: opts.cancelLabel || '취소', onClick: () => finish(false) },
        {
          label: opts.okLabel || '확인',
          primary: !opts.danger,
          danger: !!opts.danger,
          onClick: () => { finish(true); return false; }
        }
      ],
      onClose: () => { if (!done) { done = true; resolve(false); } }
    });
  });
}

/* =============================================================
   misc
   ============================================================= */
function scrollToBottom() {
  const main = $('#main');
  requestAnimationFrame(() => { main.scrollTop = main.scrollHeight; });
}
