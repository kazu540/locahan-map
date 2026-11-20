// ロケハン地図 — 画面の動き
import { getAllSpots, getSpot, putSpot, deleteSpot, newId, requestPersist } from './db.js';
import { formatFull, formatShort, toInputValue, fromInputValue } from './time.js';

const APP_VERSION = '0.2.0（段階2：最小版）';

const $ = (id) => document.getElementById(id);

const ICONS = {
  ok: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>',
  pin: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
};

/* ---------- お知らせ ---------- */
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

/* ---------- 画面の切り替え ---------- */
function showView(name) {
  for (const v of ['map', 'list', 'settings']) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.view === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => showView(t.dataset.view));
});

/* ---------- シートの出し入れ ---------- */
let openSheetEl = null;
function openSheet(el) {
  openSheetEl = el;
  const bd = $('backdrop');
  bd.hidden = false;
  el.hidden = false;
  el.querySelector('.sheet-body').scrollTop = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bd.classList.add('open');
    el.classList.add('open');
  }));
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  const el = openSheetEl;
  if (!el) return;
  openSheetEl = null;
  const bd = $('backdrop');
  el.classList.remove('open');
  bd.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => {
    if (openSheetEl !== el) { el.hidden = true; }
    if (!openSheetEl) bd.hidden = true;
  }, 420);
}
$('backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ---------- 記録 ---------- */
const rec = { lat: null, lng: null, accuracy: null, source: null, time: new Date(), busy: false };
let geoRequestNo = 0;

function setLocStatus(kind, title, sub, help) {
  const icon = $('loc-icon');
  icon.className = `badge-icon ${kind}`;
  icon.innerHTML = kind === 'ok' ? ICONS.ok : kind === 'warn' ? ICONS.warn : '';
  $('loc-title').textContent = title;
  $('loc-sub').textContent = sub || '';
  $('loc-help').textContent = help || '';
  $('loc-help').hidden = !help;
  $('loc-retry').hidden = kind !== 'warn';
}

function parseCoord(v, min, max) {
  const n = parseFloat(String(v).trim().replace(/[，、]/g, '.').replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function updateSaveButton() {
  let ok = rec.lat !== null && rec.lng !== null;
  if (!$('manual-loc').hidden) {
    ok = parseCoord($('manual-lat').value, -90, 90) !== null && parseCoord($('manual-lng').value, -180, 180) !== null;
  }
  $('record-save').disabled = !ok || rec.busy;
}

function showManual(show) {
  $('manual-loc').hidden = !show;
  updateSaveButton();
}

function getLocation() {
  const myNo = ++geoRequestNo;
  rec.lat = rec.lng = rec.accuracy = null;
  showManual(false);
  setLocStatus('loading', '現在地を取得しています…', '数秒かかることがあります');

  if (!window.isSecureContext || !('geolocation' in navigator)) {
    setLocStatus('warn', '現在地を使えません',
      '', 'この接続では位置情報が使えません（https:// で始まるアドレスで開く必要があります）。下に緯度・経度を入力して記録できます。');
    showManual(true);
    return;
  }

  navigator.geolocation.getCurrentPosition((pos) => {
    if (myNo !== geoRequestNo) return;
    rec.lat = pos.coords.latitude;
    rec.lng = pos.coords.longitude;
    rec.accuracy = pos.coords.accuracy;
    rec.source = 'gps';
    setLocStatus('ok', '現在地を取得しました',
      `${rec.lat.toFixed(5)}, ${rec.lng.toFixed(5)} ・ 誤差 約${Math.round(rec.accuracy)}m`);
    updateSaveButton();
  }, (err) => {
    if (myNo !== geoRequestNo) return;
    let help;
    if (err.code === 1) {
      help = '位置情報の利用が許可されていません。iPhoneの「設定」→「プライバシーとセキュリティ」→「位置情報サービス」→「Safari Webサイト」を「使用中のみ」にすると使えます。下に緯度・経度を入力して記録することもできます。';
    } else if (err.code === 3) {
      help = '時間内に現在地が取れませんでした。空が見える場所で「もう一度」を押すか、下に緯度・経度を入力してください。';
    } else {
      help = '現在地が取れませんでした。「もう一度」を押すか、下に緯度・経度を入力してください。';
    }
    setLocStatus('warn', '現在地を取得できませんでした', '', help);
    showManual(true);
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

function setRecordTime(date) {
  rec.time = date;
  $('time-text').textContent = formatFull(date);
  $('time-input').value = toInputValue(date);
}

function openRecord() {
  rec.busy = false;
  rec.source = null;
  $('manual-lat').value = '';
  $('manual-lng').value = '';
  $('time-field').hidden = true;
  $('time-edit').textContent = '変更';
  setRecordTime(new Date());
  openSheet($('record-sheet'));
  getLocation();
}

async function saveRecord() {
  if (rec.busy) return;
  let { lat, lng, accuracy, source } = rec;
  if (!$('manual-loc').hidden) {
    lat = parseCoord($('manual-lat').value, -90, 90);
    lng = parseCoord($('manual-lng').value, -180, 180);
    accuracy = null;
    source = 'manual';
  }
  if (lat === null || lng === null) return;
  rec.busy = true;
  updateSaveButton();
  const spot = {
    id: newId(),
    createdAt: rec.time.toISOString(),
    lat, lng, accuracy, locationSource: source,
    title: '', memo: '', route: '', tags: [], heading: null, photoIds: [],
    updatedAt: new Date().toISOString(),
  };
  try {
    await putSpot(spot);
    requestPersist();
    closeSheet();
    toast('保存しました');
    showView('list');
    await renderList();
  } catch (e) {
    toast('保存できませんでした。もう一度お試しください');
  } finally {
    rec.busy = false;
    updateSaveButton();
  }
}

$('record-btn').addEventListener('click', openRecord);
$('record-cancel').addEventListener('click', () => { geoRequestNo++; closeSheet(); });
$('record-save').addEventListener('click', saveRecord);
$('loc-retry').addEventListener('click', getLocation);
$('manual-lat').addEventListener('input', updateSaveButton);
$('manual-lng').addEventListener('input', updateSaveButton);
$('time-edit').addEventListener('click', () => {
  const f = $('time-field');
  f.hidden = !f.hidden;
  $('time-edit').textContent = f.hidden ? '変更' : '閉じる';
});
$('time-input').addEventListener('change', () => {
  const d = fromInputValue($('time-input').value);
  if (d) {
    rec.time = d;
    $('time-text').textContent = formatFull(d);
  }
});

/* ---------- 一覧 ---------- */
async function renderList() {
  let spots = [];
  try { spots = await getAllSpots(); } catch (e) { toast('データを読み込めませんでした'); }
  const list = $('spot-list');
  list.textContent = '';
  $('list-empty').hidden = spots.length > 0;
  $('list-count').textContent = spots.length ? `${spots.length}件の記録` : '';
  $('settings-count').textContent = `${spots.length}件`;

  for (const s of spots) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'spot-card';
    const thumb = document.createElement('div');
    thumb.className = 'spot-thumb';
    thumb.innerHTML = ICONS.pin;
    const meta = document.createElement('div');
    meta.className = 'spot-meta';
    const date = document.createElement('span');
    date.className = 'spot-date num';
    date.textContent = formatShort(new Date(s.createdAt));
    const sub = document.createElement('span');
    sub.className = 'spot-sub num';
    sub.textContent = `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`;
    meta.append(date, sub);
    btn.append(thumb, meta);
    btn.setAttribute('aria-label', `${formatFull(new Date(s.createdAt))}の記録を開く`);
    btn.addEventListener('click', () => openDetail(s.id));
    list.append(btn);
  }
}

/* ---------- 詳細 ---------- */
let currentDetailId = null;
async function openDetail(id) {
  const s = await getSpot(id);
  if (!s) return;
  currentDetailId = id;
  $('detail-time').textContent = formatFull(new Date(s.createdAt));
  $('detail-coords').textContent = `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`;
  $('detail-acc').textContent = s.locationSource === 'manual'
    ? '手入力した位置'
    : (s.accuracy ? `GPS・誤差 約${Math.round(s.accuracy)}m` : 'GPS');
  $('detail-maps').href = `https://maps.apple.com/?ll=${s.lat},${s.lng}&q=${encodeURIComponent('ロケ地')}`;
  $('detail-delete').hidden = false;
  $('delete-confirm').hidden = true;
  openSheet($('detail-sheet'));
}
$('detail-close').addEventListener('click', closeSheet);
$('detail-delete').addEventListener('click', () => {
  $('detail-delete').hidden = true;
  $('delete-confirm').hidden = false;
});
$('delete-no').addEventListener('click', () => {
  $('detail-delete').hidden = false;
  $('delete-confirm').hidden = true;
});
$('delete-yes').addEventListener('click', async () => {
  if (!currentDetailId) return;
  try {
    await deleteSpot(currentDetailId);
    closeSheet();
    toast('削除しました');
    await renderList();
  } catch (e) {
    toast('削除できませんでした');
  }
});

/* ---------- 起動 ---------- */
$('app-version').textContent = APP_VERSION;
renderList();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
