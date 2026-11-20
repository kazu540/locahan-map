// ロケハン地図 — 画面の動き
import {
  getAllSpots, getSpot, putSpot, deleteSpotWithPhotos, newId, requestPersist,
  putPhoto, getPhoto, deletePhoto, getMeta, setMeta,
} from './db.js';
import { formatFull, formatShort, formatTime, toInputValue, fromInputValue } from './time.js';
import { processPhoto } from './photos.js';
import { renderLightPanel } from './lightpanel.js';
import {
  lightSnapshot, sunPosition, dayTimes, dirName, altitudeWord, compassSVG, altitudeSVG, timelineEl,
  dayChartSVG, hourlyTable, lightType, riseSetAzimuth,
} from './light.js';
import * as mapView from './map.js';
import { startCompass, stopCompass } from './compass.js';
import { exportBackup, importBackup } from './backup.js';
import { fetchWeather, manualWeather, weatherText, weatherIcon, MANUAL_KINDS, KINDS } from './weather.js';

const APP_VERSION = '1.0.1';
const DEFAULT_TAGS = ['歩道橋', '坂', '人が少ない', '階段', '路地', '川沿い', '夜景向き'];

const $ = (id) => document.getElementById(id);

const ICONS = {
  ok: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>',
  pin: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  camera: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  x: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* ---------- 画像のURL管理（使い終わったらメモリを返す） ---------- */
function makeUrlBag() {
  let urls = [];
  return {
    add(blob) { const u = URL.createObjectURL(blob); urls.push(u); return u; },
    clear() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; },
  };
}
const listUrls = makeUrlBag();
const detailUrls = makeUrlBag();
const recUrls = makeUrlBag();
const panelUrls = makeUrlBag();

/* ---------- お知らせ ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

/* ---------- 画面の切り替え ---------- */
function showView(name) {
  for (const v of ['map', 'list', 'settings']) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.view === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  currentView = name;
  if (name === 'map') requestAnimationFrame(() => mapView.refreshSize());
  if (name === 'settings') renderSettings();
}
let currentView = 'map';
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => showView(t.dataset.view));
});

/* ---------- シートの出し入れ ---------- */
let openSheetEl = null;
function openSheet(sheet) {
  if (openSheetEl && openSheetEl !== sheet) {
    openSheetEl.classList.remove('open');
    const prev = openSheetEl;
    setTimeout(() => { if (openSheetEl !== prev) prev.hidden = true; }, 420);
  }
  openSheetEl = sheet;
  const bd = $('backdrop');
  bd.hidden = false;
  sheet.hidden = false;
  sheet.querySelector('.sheet-body').scrollTop = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bd.classList.add('open');
    sheet.classList.add('open');
  }));
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  stopCompass();
  const sheet = openSheetEl;
  if (!sheet) return;
  openSheetEl = null;
  const bd = $('backdrop');
  sheet.classList.remove('open');
  bd.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => {
    if (openSheetEl !== sheet) sheet.hidden = true;
    if (!openSheetEl) bd.hidden = true;
  }, 420);
}
$('backdrop').addEventListener('click', () => { if (openSheetEl !== $('record-sheet')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ---------- タグ ---------- */
let allTags = [...DEFAULT_TAGS];
async function loadTags() {
  try { allTags = await getMeta('tags', [...DEFAULT_TAGS]); } catch (e) { allTags = [...DEFAULT_TAGS]; }
}

/* ---------- 記録（新規・編集） ---------- */
const rec = {
  mode: 'new', editId: null,
  lat: null, lng: null, accuracy: null, source: null, time: new Date(),
  busy: false, processing: 0,
  photos: [],          // { id, existing, url, blob?, thumb?, width?, height? }
  removedPhotoIds: [],
  tags: new Set(),
};
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
  const s = String(v).trim()
    .replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[，、]/g, '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function currentLocation() {
  if (!$('manual-loc').hidden) {
    const lat = parseCoord($('manual-lat').value, -90, 90);
    const lng = parseCoord($('manual-lng').value, -180, 180);
    return { lat, lng, accuracy: null, source: 'manual' };
  }
  return { lat: rec.lat, lng: rec.lng, accuracy: rec.accuracy, source: rec.source };
}

/* 撮る向き（コンパス） */
const DIR8 = [['北', 0], ['北東', 45], ['東', 90], ['南東', 135], ['南', 180], ['南西', 225], ['西', 270], ['北西', 315]];
let liveHeading = null;
let liveFrame = 0;
let liveAcc = null;

function showDir(state) {
  $('dir-none').hidden = state !== 'none';
  $('dir-live').hidden = state !== 'live';
  $('dir-set').hidden = state !== 'set';
  $('dir-manual').hidden = state !== 'manual';
  if (state === 'set') {
    $('dir-set-title').textContent = `向き ${Math.round(rec.heading)}° ${dirName(rec.heading)}`;
    $('dir-set-sub').textContent = rec.headingSource === 'manual' ? '手で選択' : 'コンパスで測定';
  }
}

function sunForRec() {
  const loc = currentLocation();
  if (loc.lat === null || loc.lng === null) return null;
  const pos = sunPosition(rec.time, loc.lat, loc.lng);
  return { pos, arc: riseSetAzimuth(dayTimes(rec.time, loc.lat, loc.lng), loc.lat, loc.lng) };
}

function drawLive() {
  liveFrame = 0;
  if (liveHeading === null) return;
  const sun = sunForRec();
  const box = $('dir-live-compass');
  box.textContent = '';
  box.append(sun ? compassSVG(sun.pos.azimuth, sun.pos.altitude, liveHeading, sun.arc) : compassSVG(0, -90, liveHeading));
  $('dir-live-num').textContent = `${Math.round(liveHeading)}° ${dirName(liveHeading)}`;
  const lt = sun ? lightType(liveHeading, sun.pos.azimuth, sun.pos.altitude) : null;
  $('dir-live-type').textContent = lt ? `この向きだと「${lt.label}」` : '';
  $('dir-live-hint').textContent = liveAcc != null && liveAcc > 25
    ? `向きの精度が低めです（±${Math.round(liveAcc)}°）。iPhoneを大きく8の字に動かすと良くなります。`
    : '撮影するときのようにiPhoneを構えて、カメラを撮りたい方向へ向けてください。';
  $('dir-live-ok').disabled = false;
}

$('dir-measure').addEventListener('click', measureDirection);
$('dir-remeasure').addEventListener('click', measureDirection);
function measureDirection() {
  liveHeading = null;
  liveAcc = null;
  $('dir-live-ok').disabled = true;
  $('dir-live-num').textContent = '—';
  $('dir-live-type').textContent = '';
  $('dir-live-compass').textContent = '';
  $('dir-live-hint').textContent = 'コンパスを準備しています…';
  showDir('live');
  startCompass((h, acc) => {
    liveHeading = h;
    liveAcc = acc;
    if (!liveFrame) liveFrame = requestAnimationFrame(drawLive);
  }, (reason) => {
    toast(reason === 'denied'
      ? 'コンパスの利用が許可されませんでした。手で選べます'
      : 'この端末ではコンパスが使えません。手で選べます');
    openDirManual();
  });
}
$('dir-live-ok').addEventListener('click', () => {
  if (liveHeading === null) return;
  stopCompass();
  rec.heading = Math.round(liveHeading);
  rec.headingSource = 'compass';
  showDir('set');
  updateRecLight();
});
$('dir-live-cancel').addEventListener('click', () => {
  stopCompass();
  showDir(rec.heading != null ? 'set' : 'none');
});

function setDirSlider(deg) {
  $('dir-slider').value = String(deg);
  $('dir-slider-out').textContent = `${deg}° ${dirName(deg)}`;
  document.querySelectorAll('#dir-chips .qchip').forEach((b) => {
    b.setAttribute('aria-pressed', Number(b.dataset.deg) === deg ? 'true' : 'false');
  });
}
function openDirManual() {
  stopCompass();
  const box = $('dir-chips');
  if (!box.children.length) {
    for (const [name, deg] of DIR8) {
      const b = el('button', 'qchip', name);
      b.type = 'button';
      b.dataset.deg = String(deg);
      b.addEventListener('click', () => setDirSlider(deg));
      box.append(b);
    }
  }
  setDirSlider(rec.heading != null ? Math.round(rec.heading / 5) * 5 % 360 : 0);
  showDir('manual');
}
$('dir-manual-btn').addEventListener('click', openDirManual);
$('dir-manual-btn2').addEventListener('click', openDirManual);
$('dir-slider').addEventListener('input', () => setDirSlider(Number($('dir-slider').value)));
$('dir-manual-ok').addEventListener('click', () => {
  rec.heading = Number($('dir-slider').value);
  rec.headingSource = 'manual';
  showDir('set');
  updateRecLight();
});
$('dir-clear').addEventListener('click', () => {
  rec.heading = null;
  rec.headingSource = null;
  showDir('none');
  updateRecLight();
});

/* 天気 */
let weatherReqNo = 0;
let weatherTimer;
function setWeatherUI(state, w, msg) {
  const icon = $('wx-icon');
  icon.className = `badge-icon ${state === 'loading' ? 'loading' : 'neutral'}`;
  icon.innerHTML = state === 'ok' ? weatherIcon(w.kind, 20) : state === 'loading' ? '' : weatherIcon('cloudy', 20);
  if (state === 'ok') {
    $('wx-title').textContent = w.label + (w.source === 'manual' ? '（手で選択）' : '');
    $('wx-sub').textContent = [w.temp != null ? `気温 ${Math.round(w.temp)}℃` : '', w.cloud != null ? `雲の量 ${w.cloud}%` : ''].filter(Boolean).join('・');
  } else if (state === 'loading') {
    $('wx-title').textContent = '天気を取得しています…';
    $('wx-sub').textContent = '';
  } else {
    $('wx-title').textContent = '天気';
    $('wx-sub').textContent = msg || '';
  }
}

function requestRecWeather({ force = false } = {}) {
  clearTimeout(weatherTimer);
  if (rec.weather && rec.weather.source === 'manual' && !force) return;
  const loc = currentLocation();
  if (loc.lat === null || loc.lng === null) {
    rec.weather = null;
    setWeatherUI('none', null, '場所が決まると自動で取得します');
    return;
  }
  const myNo = ++weatherReqNo;
  setWeatherUI('loading');
  weatherTimer = setTimeout(async () => {
    try {
      const w = await fetchWeather(loc.lat, loc.lng, rec.time);
      if (myNo !== weatherReqNo) return;
      rec.weather = w;
      setWeatherUI('ok', w);
    } catch (e) {
      if (myNo !== weatherReqNo) return;
      rec.weather = null;
      setWeatherUI('none', null, navigator.onLine
        ? '取得できませんでした。保存後に自動で取り直します'
        : '電波がないため、電波が戻ったら自動で取得します');
    }
  }, 400);
}

function renderWeatherManual() {
  const box = $('wx-manual');
  box.textContent = '';
  for (const k of MANUAL_KINDS) {
    const b = el('button', 'qchip wx-chip');
    b.type = 'button';
    b.innerHTML = weatherIcon(k, 18);
    b.append(document.createTextNode(KINDS[k].label));
    b.setAttribute('aria-pressed', rec.weather && rec.weather.source === 'manual' && rec.weather.kind === k ? 'true' : 'false');
    b.addEventListener('click', () => {
      weatherReqNo++;
      rec.weather = manualWeather(k);
      setWeatherUI('ok', rec.weather);
      box.hidden = true;
      $('wx-edit').textContent = '変更';
    });
    box.append(b);
  }
  const auto = el('button', 'qchip', '自動で取得し直す');
  auto.type = 'button';
  auto.addEventListener('click', () => {
    rec.weather = null;
    box.hidden = true;
    $('wx-edit').textContent = '変更';
    requestRecWeather({ force: true });
  });
  box.append(auto);
}
$('wx-edit').addEventListener('click', () => {
  const box = $('wx-manual');
  if (box.hidden) renderWeatherManual();
  box.hidden = !box.hidden;
  $('wx-edit').textContent = box.hidden ? '変更' : '閉じる';
});

function updateRecLight() {
  const loc = currentLocation();
  renderLightPanel($('rec-light'), { date: rec.time, lat: loc.lat, lng: loc.lng, heading: rec.heading });
}

function updateSaveButton() {
  const loc = currentLocation();
  const ok = loc.lat !== null && loc.lng !== null && !rec.busy && rec.processing === 0;
  $('record-save').disabled = !ok;
  $('record-save-bottom').disabled = !ok;
  $('record-save-bottom').textContent = rec.processing > 0 ? '写真を準備しています…' : '保存する';
}

function showManual(show) {
  $('manual-loc').hidden = !show;
  updateSaveButton();
}

function getLocation() {
  const myNo = ++geoRequestNo;
  rec.lat = rec.lng = rec.accuracy = null;
  showManual(false);
  updateRecLight();
  setLocStatus('loading', '現在地を取得しています…', '数秒かかることがあります');

  if (!window.isSecureContext || !('geolocation' in navigator)) {
    setLocStatus('warn', '現在地を使えません', '',
      'この接続では位置情報が使えません（https:// で始まるアドレスで開く必要があります）。下に緯度・経度を入力して記録できます。');
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
    updateRecLight();
    requestRecWeather();
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
    updateRecLight();
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

function setRecordTime(date) {
  rec.time = date;
  $('time-text').textContent = formatFull(date);
  $('time-input').value = toInputValue(date);
}

/* 写真の並び */
function renderPhotoStrip() {
  const strip = $('photo-strip');
  strip.querySelectorAll('.photo-tile').forEach((t) => t.remove());
  const addTile = strip.querySelector('.photo-add');
  rec.photos.forEach((p, i) => {
    const tile = el('div', 'photo-tile');
    if (!p.url) {
      tile.classList.add('busy');
    } else {
      const img = el('img');
      img.src = p.url;
      img.alt = `写真 ${i + 1}`;
      tile.append(img);
      const rm = el('button', 'photo-remove');
      rm.type = 'button';
      rm.setAttribute('aria-label', `写真 ${i + 1} を外す`);
      const dot = el('span');
      dot.innerHTML = ICONS.x;
      rm.append(dot);
      rm.addEventListener('click', () => {
        if (p.existing) rec.removedPhotoIds.push(p.id);
        rec.photos = rec.photos.filter((x) => x !== p);
        renderPhotoStrip();
      });
      tile.append(rm);
    }
    strip.insertBefore(tile, addTile);
  });
}

$('photo-input').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  let failed = 0;
  const slots = files.map(() => ({ id: newId(), existing: false, url: null }));
  rec.photos.push(...slots);
  rec.processing += files.length;
  renderPhotoStrip();
  updateSaveButton();
  // 1枚ずつ順番に処理（iPhoneのメモリ不足を防ぐため）
  for (let i = 0; i < files.length; i++) {
    const slot = slots[i];
    try {
      const r = await processPhoto(files[i]);
      Object.assign(slot, r, { url: recUrls.add(r.thumb) });
    } catch (err) {
      failed++;
      rec.photos = rec.photos.filter((x) => x !== slot);
    }
    rec.processing--;
    renderPhotoStrip();
    updateSaveButton();
  }
  if (failed) toast(`${failed}枚の写真を読み込めませんでした`);
});

/* タグの選択 */
function renderTagPicker() {
  const wrap = $('tag-picker');
  wrap.textContent = '';
  for (const tag of allTags) {
    const b = el('button', 'tag-chip', tag);
    b.type = 'button';
    b.setAttribute('aria-pressed', rec.tags.has(tag) ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (rec.tags.has(tag)) rec.tags.delete(tag); else rec.tags.add(tag);
      b.setAttribute('aria-pressed', rec.tags.has(tag) ? 'true' : 'false');
    });
    wrap.append(b);
  }
  const add = el('button', 'tag-chip add', '＋ タグを追加');
  add.type = 'button';
  add.addEventListener('click', () => {
    $('tag-add-row').hidden = false;
    $('tag-new').value = '';
    $('tag-new').focus();
  });
  wrap.append(add);
}

async function addNewTag() {
  const name = $('tag-new').value.trim().replace(/\s+/g, ' ');
  if (!name) { $('tag-add-row').hidden = true; return; }
  if (!allTags.includes(name)) {
    allTags = [...allTags, name];
    try { await setMeta('tags', allTags); } catch (e) { toast('タグを保存できませんでした'); }
  }
  rec.tags.add(name);
  $('tag-add-row').hidden = true;
  renderTagPicker();
}
$('tag-new-ok').addEventListener('click', addNewTag);
$('tag-new').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addNewTag(); }
});

function resetForm() {
  recUrls.clear();
  rec.busy = false;
  rec.processing = 0;
  rec.photos = [];
  rec.removedPhotoIds = [];
  rec.tags = new Set();
  rec.source = null;
  rec.heading = null;
  rec.headingSource = null;
  stopCompass();
  showDir('none');
  rec.weather = null;
  weatherReqNo++;
  $('wx-manual').hidden = true;
  $('wx-edit').textContent = '変更';
  setWeatherUI('none', null, '場所が決まると自動で取得します');
  $('manual-lat').value = '';
  $('manual-lng').value = '';
  $('f-title').value = '';
  $('f-memo').value = '';
  $('f-route').value = '';
  $('time-field').hidden = true;
  $('time-edit').textContent = '変更';
  $('tag-add-row').hidden = true;
  $('photo-status').hidden = true;
}

function openRecord() {
  resetForm();
  rec.mode = 'new';
  rec.editId = null;
  $('record-title').textContent = 'ここを記録';
  setRecordTime(new Date());
  renderPhotoStrip();
  renderTagPicker();
  openSheet($('record-sheet'));
  getLocation();
}

async function openEdit(id) {
  const s = await getSpot(id);
  if (!s) return;
  resetForm();
  geoRequestNo++;
  rec.mode = 'edit';
  rec.editId = id;
  $('record-title').textContent = '記録を編集';
  rec.lat = s.lat; rec.lng = s.lng; rec.accuracy = s.accuracy; rec.source = s.locationSource;
  rec.heading = s.heading ?? null;
  rec.headingSource = s.headingSource || (rec.heading != null ? 'compass' : null);
  showDir(rec.heading != null ? 'set' : 'none');
  if (s.weather && s.weather.status === 'ok') {
    rec.weather = s.weather;
    setWeatherUI('ok', s.weather);
  } else {
    requestRecWeather();
  }
  showManual(false);
  setLocStatus('ok', '記録した位置', `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`);
  $('loc-retry').hidden = true;
  setRecordTime(new Date(s.createdAt));
  $('f-title').value = s.title || '';
  $('f-memo').value = s.memo || '';
  $('f-route').value = s.route || '';
  rec.tags = new Set(s.tags || []);
  for (const t of rec.tags) if (!allTags.includes(t)) allTags.push(t);
  for (const pid of s.photoIds || []) {
    const ph = await getPhoto(pid);
    if (ph) rec.photos.push({ id: pid, existing: true, url: recUrls.add(ph.thumb || ph.blob) });
  }
  renderPhotoStrip();
  renderTagPicker();
  updateSaveButton();
  updateRecLight();
  openSheet($('record-sheet'));
}

async function saveRecord() {
  if (rec.busy || rec.processing > 0) return;
  const loc = currentLocation();
  if (loc.lat === null || loc.lng === null) return;
  rec.busy = true;
  updateSaveButton();
  try {
    const now = new Date().toISOString();
    const base = rec.mode === 'edit' ? await getSpot(rec.editId) : null;
    const spotId = base ? base.id : newId();

    // 新しい写真を保存
    for (const p of rec.photos) {
      if (p.existing) continue;
      await putPhoto({
        id: p.id, spotId, blob: p.blob, thumb: p.thumb,
        width: p.width, height: p.height, createdAt: now,
      });
      p.existing = true;
    }
    // 外した写真を削除
    for (const pid of rec.removedPhotoIds) await deletePhoto(pid);

    const tagsInOrder = allTags.filter((t) => rec.tags.has(t));
    const spot = {
      ...(base || {}),
      id: spotId,
      createdAt: rec.time.toISOString(),
      lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, locationSource: loc.source,
      title: $('f-title').value.trim(),
      memo: $('f-memo').value.trim(),
      route: $('f-route').value.trim(),
      tags: tagsInOrder,
      heading: rec.heading,
      headingSource: rec.headingSource,
      weather: rec.weather && rec.weather.status === 'ok' ? rec.weather : { status: 'pending', tries: 0 },
      light: lightSnapshot(rec.time, loc.lat, loc.lng),
      photoIds: rec.photos.map((p) => p.id),
      updatedAt: now,
    };
    await putSpot(spot);
    requestPersist();
    if (spot.weather.status === 'pending') setTimeout(fillPendingWeather, 1500);
    const wasEdit = rec.mode === 'edit';
    closeSheet();
    toast(wasEdit ? '変更を保存しました' : '保存しました');
    await renderList();
    if (wasEdit) setTimeout(() => openDetail(spotId), 300);
    else if (currentView === 'map') mapView.select(spotId);
  } catch (e) {
    toast('保存できませんでした。iPhoneの空き容量を確認してください');
  } finally {
    rec.busy = false;
    updateSaveButton();
  }
}

$('record-btn').addEventListener('click', openRecord);
$('record-cancel').addEventListener('click', () => { geoRequestNo++; closeSheet(); });
$('record-save').addEventListener('click', saveRecord);
$('record-save-bottom').addEventListener('click', saveRecord);
$('loc-retry').addEventListener('click', getLocation);
function onManualInput() {
  updateSaveButton();
  updateRecLight();
  clearTimeout(weatherTimer);
  weatherTimer = setTimeout(() => requestRecWeather(), 800);
}
$('manual-lat').addEventListener('input', onManualInput);
$('manual-lng').addEventListener('input', onManualInput);
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
    updateRecLight();
    requestRecWeather();
  }
});

/* ---------- 一覧と地図のピン ---------- */
let spotsCache = [];          // すべての記録
const filterTags = new Set(); // 絞り込みに使うタグ（すべて含むものだけ表示）

async function renderList({ fit = false } = {}) {
  let spots = [];
  try { spots = await getAllSpots(); } catch (e) { toast('データを読み込めませんでした'); }
  listUrls.clear();
  // 一覧と地図で同じ小さい写真を使う
  await Promise.all(spots.map(async (s) => {
    s.thumbUrl = null;
    if (s.photoIds && s.photoIds.length) {
      try {
        const ph = await getPhoto(s.photoIds[0]);
        if (ph) s.thumbUrl = listUrls.add(ph.thumb || ph.blob);
      } catch (e) { /* 写真が読めなくても続ける */ }
    }
  }));
  spotsCache = spots;
  $('settings-count').textContent = `${spots.length}件`;
  updateBackupInfo();
  // 使われなくなったタグは絞り込みから外す
  const used = new Set(spots.flatMap((s) => s.tags || []));
  for (const t of [...filterTags]) if (!used.has(t)) filterTags.delete(t);
  applyFilter({ fit });
}

function filteredSpots() {
  if (!filterTags.size) return spotsCache;
  return spotsCache.filter((s) => [...filterTags].every((t) => (s.tags || []).includes(t)));
}

function renderFilters() {
  const used = new Set(spotsCache.flatMap((s) => s.tags || []));
  const tags = allTags.filter((t) => used.has(t) || filterTags.has(t));
  for (const t of used) if (!tags.includes(t)) tags.push(t);
  for (const box of [$('map-filter'), $('list-filter')]) {
    box.textContent = '';
    box.hidden = tags.length === 0;
    const all = el('button', 'fchip', 'すべて');
    all.type = 'button';
    all.setAttribute('aria-pressed', filterTags.size ? 'false' : 'true');
    all.addEventListener('click', () => { filterTags.clear(); applyFilter(); });
    box.append(all);
    for (const t of tags) {
      const b = el('button', 'fchip', t);
      b.type = 'button';
      b.setAttribute('aria-pressed', filterTags.has(t) ? 'true' : 'false');
      b.addEventListener('click', () => {
        if (filterTags.has(t)) filterTags.delete(t); else filterTags.add(t);
        applyFilter();
      });
      box.append(b);
    }
  }
}

function applyFilter({ fit = false } = {}) {
  const spots = filteredSpots();
  const total = spotsCache.length;
  renderFilters();

  const list = $('spot-list');
  list.textContent = '';
  $('list-empty').hidden = total > 0;
  $('filter-empty').hidden = !(total > 0 && spots.length === 0);
  $('list-count').textContent = !total ? ''
    : filterTags.size ? `全${total}件のうち ${spots.length}件（${[...filterTags].join('＋')}）`
      : `${total}件の記録`;

  for (const s of spots) {
    const card = el('button', 'spot-card');
    card.type = 'button';
    const thumb = el('div', 'spot-thumb');
    if (s.thumbUrl) {
      const img = el('img');
      img.alt = '';
      img.src = s.thumbUrl;
      thumb.append(img);
    } else {
      thumb.innerHTML = ICONS.pin;
    }
    const meta = el('div', 'spot-meta');
    const date = formatShort(new Date(s.createdAt));
    if (s.title) meta.append(el('span', 'spot-title', s.title));
    meta.append(el('span', s.title ? 'spot-sub num' : 'spot-date num', date));
    if (s.tags && s.tags.length) meta.append(el('span', 'spot-sub', s.tags.join('・')));
    card.append(thumb, meta);
    card.setAttribute('aria-label', `${s.title || formatFull(new Date(s.createdAt))} の記録を開く`);
    card.addEventListener('click', () => openDetail(s.id));
    list.append(card);
  }

  mapView.setSpots(spots, { fit });
  if (filterTags.size && currentView === 'map' && spots.length) mapView.fitAll();
  if (filterTags.size && !spots.length && currentView === 'map') toast('条件に合う記録がありません');
}

/* ---------- 地図の下のパネル ---------- */
function todayStatus(now, t) {
  const n = now.getTime();
  const left = (d) => {
    const m = Math.max(1, Math.round((d.getTime() - n) / 60000));
    return m >= 60 ? `あと${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}` : `あと${m}分`;
  };
  if (!t.sunrise || !t.sunset) return { title: 'この日は日の出・日没がありません', sub: '' };
  if (n < t.sunrise.getTime()) return { title: '朝のゴールデンアワー', sub: `${formatTime(t.sunrise)}–${formatTime(t.goldenMorningEnd)}（${left(t.sunrise)}で始まります）` };
  if (t.goldenMorningEnd && n < t.goldenMorningEnd.getTime()) return { title: '朝のゴールデンアワー中', sub: `${formatTime(t.goldenMorningEnd)}まで`, now: true };
  if (t.goldenEveningStart && n < t.goldenEveningStart.getTime()) return { title: '夕方のゴールデンアワー', sub: `${formatTime(t.goldenEveningStart)}–${formatTime(t.sunset)}（${left(t.goldenEveningStart)}で始まります）` };
  if (n < t.sunset.getTime()) return { title: '夕方のゴールデンアワー中', sub: `日没 ${formatTime(t.sunset)}（${left(t.sunset)}）`, now: true };
  if (t.blueEveningEnd && n < t.blueEveningEnd.getTime()) return { title: 'ブルーアワーの時間です', sub: `${formatTime(t.blueEveningEnd)}ごろまで`, now: true };
  return { title: '今日の日没は終わりました', sub: `日没は ${formatTime(t.sunset)} でした` };
}

const SUN_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="14" r="4"/><path d="M12 4v3M4.9 7.9l2 2M19.1 7.9l-2 2M2 18h20"/></svg>';

function renderToday() {
  const c = mapView.getCenter();
  const now = new Date();
  const t = dayTimes(now, c.lat, c.lng);
  $('today-sub').textContent = `${formatShort(now).replace(/\s?\d+:\d+$/, '')}・地図の中心`;
  const tl = $('today-timeline');
  tl.textContent = '';
  tl.append(timelineEl(t, now, formatTime));
  $('today-times').innerHTML = '';
  for (const [label, d] of [['日の出', t.sunrise], ['いま', now], ['日没', t.sunset]]) {
    $('today-times').append(el('span', '', `${label} ${formatTime(d)}`));
  }
  const st = todayStatus(now, t);
  const box = $('today-status');
  box.textContent = '';
  box.classList.toggle('active', !!st.now);
  const icon = el('span', 'today-icon');
  icon.innerHTML = SUN_ICON;
  const txt = el('div', 'today-text');
  txt.append(el('span', 'today-title', st.title), el('span', 'today-sub num', st.sub));
  box.append(icon, txt);
}

let panelSpotId = null;
function showSpotPanel(id) {
  const s = spotsCache.find((x) => x.id === id);
  if (!s) return;
  panelSpotId = id;
  panelUrls.clear();
  const ph = $('ps-photo');
  ph.textContent = '';
  ph.classList.toggle('empty', !s.thumbUrl);
  if (s.thumbUrl) {
    const img = el('img');
    img.alt = '';
    img.src = s.thumbUrl;
    ph.append(img);
    // 大きい写真に差し替え
    getPhoto(s.photoIds[0]).then((p) => {
      if (p && panelSpotId === id) img.src = panelUrls.add(p.blob);
    }).catch(() => {});
  } else {
    ph.innerHTML = ICONS.camera;
  }
  $('ps-name').textContent = s.title || formatShort(new Date(s.createdAt));
  $('ps-time').textContent = `${formatFull(new Date(s.createdAt))} に記録` +
    (s.weather && s.weather.status === 'ok' ? `・${weatherText(s.weather)}` : '');
  const tags = $('ps-tags');
  tags.textContent = '';
  for (const t of s.tags || []) tags.append(el('span', 'tag-label', t));
  tags.hidden = !(s.tags && s.tags.length);

  const date = new Date(s.createdAt);
  const pos = sunPosition(date, s.lat, s.lng);
  const box = $('ps-light');
  box.textContent = '';
  const a = el('div', 'ps-viz');
  a.append(compassSVG(pos.azimuth, pos.altitude, s.heading ?? null),
    el('span', 'ps-viz-text num', `${Math.round(pos.azimuth)}° ${dirName(pos.azimuth)}`));
  const b = el('div', 'ps-viz');
  b.append(altitudeSVG(pos.altitude), el('span', 'ps-viz-text', altitudeWord(pos.altitude)));
  box.append(a, b);

  $('panel-today').hidden = true;
  $('panel-spot').hidden = false;
  const panel = $('map-panel');
  panel.classList.remove('pop');
  void panel.offsetWidth;
  panel.classList.add('pop');
}
function showTodayPanel() {
  panelSpotId = null;
  $('panel-spot').hidden = true;
  $('panel-today').hidden = false;
  renderToday();
}

let moveTimer;
mapView.initMap({
  onSelect: showSpotPanel,
  onDeselect: showTodayPanel,
  onMove: () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { if (!panelSpotId) renderToday(); }, 250);
  },
});
$('ps-close').addEventListener('click', () => mapView.select(null));
$('ps-open').addEventListener('click', () => { if (panelSpotId) openDetail(panelSpotId); });
$('map-fit').addEventListener('click', () => {
  if (!spotsCache.length) { toast('まだ記録がありません'); return; }
  mapView.fitAll();
});
$('map-locate').addEventListener('click', () => {
  if (!('geolocation' in navigator)) { toast('この端末では現在地を使えません'); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => mapView.showMe(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
    (err) => toast(err.code === 1 ? '位置情報が許可されていません（設定アプリで変更できます）' : '現在地を取得できませんでした'),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
  );
});
setInterval(() => { if (!panelSpotId && currentView === 'map') renderToday(); }, 60000);

/* ---------- 詳細 ---------- */
let currentDetailId = null;
async function openDetail(id) {
  const s = await getSpot(id);
  if (!s) return;
  currentDetailId = id;
  detailUrls.clear();

  const car = $('detail-photos');
  car.textContent = '';
  const ids = s.photoIds || [];
  if (!ids.length) {
    const none = el('div', 'no-photo');
    none.innerHTML = ICONS.camera;
    car.append(none);
  }
  for (const [i, pid] of ids.entries()) {
    const ph = await getPhoto(pid);
    if (!ph) continue;
    const img = el('img');
    img.alt = `写真 ${i + 1}`;
    img.src = detailUrls.add(ph.blob);
    car.append(img);
  }
  const count = $('detail-photo-count');
  const n = car.querySelectorAll('img').length;
  count.hidden = n < 2;
  count.textContent = `1 / ${n}`;
  car.scrollLeft = 0;

  $('detail-name').textContent = s.title || formatShort(new Date(s.createdAt));
  $('detail-time').textContent = `${formatFull(new Date(s.createdAt))} に記録`;

  const dw = $('detail-weather');
  dw.textContent = '';
  if (s.weather && s.weather.status === 'ok') {
    dw.innerHTML = weatherIcon(s.weather.kind, 20);
    dw.append(el('span', 'num', weatherText(s.weather)));
    dw.hidden = false;
  } else if (s.weather && s.weather.status === 'pending') {
    dw.innerHTML = weatherIcon('cloudy', 20);
    dw.append(el('span', '', '天気は電波があるときに自動で取得します'));
    dw.classList.add('muted');
    dw.hidden = false;
  } else {
    dw.hidden = true;
  }
  if (s.weather && s.weather.status === 'ok') dw.classList.remove('muted');

  const tags = $('detail-tags');
  tags.textContent = '';
  for (const t of s.tags || []) tags.append(el('span', 'tag-label', t));
  tags.hidden = !(s.tags && s.tags.length);

  $('detail-memo').textContent = s.memo || '';
  $('detail-memo-card').hidden = !s.memo;
  $('detail-route').textContent = s.route || '';
  $('detail-route-card').hidden = !s.route;

  startSim(s);

  $('detail-coords').textContent = `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`;
  $('detail-acc').textContent = s.locationSource === 'manual'
    ? '手入力した位置'
    : (s.accuracy ? `GPS・誤差 約${Math.round(s.accuracy)}m` : 'GPS');
  $('detail-maps').href = `https://maps.apple.com/?ll=${s.lat},${s.lng}&q=${encodeURIComponent(s.title || 'ロケ地')}`;
  $('detail-delete').hidden = false;
  $('delete-confirm').hidden = true;
  openSheet($('detail-sheet'));
}
/* ---------- 光のシミュレーション（日時を変えて再計算） ---------- */
let simSpot = null;
let simDate = null;
const JST = 9 * 3600000;
function jstMinutes(d) { const j = new Date(d.getTime() + JST); return j.getUTCHours() * 60 + j.getUTCMinutes(); }
function jstDateStr(d) { return toInputValue(d).slice(0, 10); }
function makeJst(dateStr, minutes) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const d = new Date(`${dateStr}T${hh}:${mm}:00+09:00`);
  return isNaN(d.getTime()) ? null : d;
}

function startSim(s) {
  simSpot = s;
  setSim(new Date(s.createdAt));
}

function setSim(date) {
  if (!simSpot || !date) return;
  simDate = date;
  const { lat, lng } = simSpot;
  const isRecorded = Math.abs(date.getTime() - new Date(simSpot.createdAt).getTime()) < 60000;
  $('sim-badge').textContent = isRecorded ? '記録したとき' : 'シミュレーション中';
  $('sim-badge').classList.toggle('active', !isRecorded);
  $('sim-date').value = jstDateStr(date);
  $('sim-time').value = String(Math.round(jstMinutes(date) / 5) * 5);
  $('sim-time-out').textContent = formatTime(date);

  renderLightPanel($('detail-light'), { date, lat, lng, heading: simSpot.heading ?? null });

  const times = dayTimes(date, lat, lng);
  const chart = $('day-chart');
  chart.textContent = '';
  chart.append(dayChartSVG(times, lat, lng, date, formatTime, (d) => setSim(roundTo5(d))));

  const body = $('hourly-body');
  body.textContent = '';
  for (const r of hourlyTable(times, lat, lng)) {
    const tr = el('tr');
    tr.append(el('td', 'num', formatTime(r.date)),
      el('td', 'num', `${Math.round(r.altitude)}°`),
      el('td', 'num', `${Math.round(r.azimuth)}° ${dirName(r.azimuth)}`));
    body.append(tr);
  }

  const quick = $('sim-quick');
  quick.textContent = '';
  const items = [
    ['記録時', new Date(simSpot.createdAt)],
    ['日の出', times.sunrise],
    ['朝ゴールデン', times.sunrise && times.goldenMorningEnd ? new Date((times.sunrise.getTime() + times.goldenMorningEnd.getTime()) / 2) : null],
    ['正午', times.solarNoon],
    ['夕ゴールデン', times.goldenEveningStart && times.sunset ? new Date((times.goldenEveningStart.getTime() + times.sunset.getTime()) / 2) : null],
    ['日没', times.sunset],
  ];
  for (const [label, d] of items) {
    if (!d) continue;
    const b = el('button', 'qchip', label);
    b.type = 'button';
    b.setAttribute('aria-label', `${label}（${formatTime(d)}）にする`);
    b.addEventListener('click', () => setSim(label === '記録時' ? d : roundTo5(d)));
    quick.append(b);
  }
}
function roundTo5(d) { return new Date(Math.round(d.getTime() / 300000) * 300000); }

$('sim-time').addEventListener('input', () => {
  const d = makeJst($('sim-date').value || jstDateStr(simDate), Number($('sim-time').value));
  if (d) setSim(d);
});
$('sim-date').addEventListener('change', () => {
  if (!$('sim-date').value) return;
  const d = makeJst($('sim-date').value, jstMinutes(simDate));
  if (d) setSim(d);
});

$('detail-photos').addEventListener('scroll', () => {
  const car = $('detail-photos');
  const n = car.querySelectorAll('img').length;
  if (n < 2) return;
  const i = Math.round(car.scrollLeft / (car.clientWidth + 10)) + 1;
  $('detail-photo-count').textContent = `${Math.min(n, Math.max(1, i))} / ${n}`;
}, { passive: true });
$('detail-close').addEventListener('click', closeSheet);
$('detail-edit').addEventListener('click', () => { if (currentDetailId) openEdit(currentDetailId); });
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
    await deleteSpotWithPhotos(currentDetailId);
    closeSheet();
    toast('削除しました');
    await renderList();
  } catch (e) {
    toast('削除できませんでした');
  }
});

/* ---------- 起動 ---------- */
$('app-version').textContent = APP_VERSION;
/* ---------- 設定：ホーム画面・バックアップ・タグ・情報 ---------- */
const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

function ls(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (e) { return null; }
  return null;
}

async function updateBackupInfo() {
  let last = null;
  try { last = await getMeta('lastBackupAt', null); } catch (e) { /* なし */ }
  const total = spotsCache.length;
  $('backup-last').textContent = last ? `最後の書き出し：${formatFull(new Date(last))}` : 'まだ書き出していません';
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  const need = total > 0 && (days === null || days >= 14);
  const alert = $('backup-alert');
  alert.hidden = !need;
  alert.textContent = days === null
    ? `${total}件の記録があります。まだ一度もバックアップしていません。`
    : `前回のバックアップから${days}日たっています。`;
  $('settings-dot').hidden = !need;
}

async function renderSettings() {
  $('home-ok').hidden = !isStandalone;
  $('home-steps').hidden = isStandalone;
  updateBackupInfo();
  renderTagManager();
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const mb = (est.usage || 0) / 1048576;
      $('storage-used').textContent = mb < 1 ? '1MB未満' : `約${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
    }
    if (navigator.storage && navigator.storage.persisted) {
      const p = await navigator.storage.persisted();
      $('storage-persist').textContent = p ? '保護されています' : (isStandalone ? '通常' : '通常（ホーム画面に追加がおすすめ）');
    }
  } catch (e) { /* 表示しないだけ */ }
}

/* バックアップの書き出し：①ファイルを作る → ②保存する（iPhoneはボタンを押した直後しか共有画面を出せないため2段階） */
let pendingBackup = null;
function setProgress(on) { $('backup-progress').hidden = !on; }
$('backup-export').addEventListener('click', async () => {
  const btn = $('backup-export');
  if (pendingBackup) { saveBackupFile(); return; }
  btn.disabled = true;
  btn.textContent = 'ファイルを作っています…';
  setProgress(true);
  try {
    const r = await exportBackup(DEFAULT_TAGS);
    pendingBackup = r;
    const mb = r.blob.size / 1048576;
    btn.textContent = `ファイルに保存する（${mb < 1 ? '1MB未満' : `${mb.toFixed(1)}MB`}）`;
    toast(`記録${r.spots}件・写真${r.photos}枚をまとめました`);
  } catch (e) {
    btn.textContent = 'バックアップを書き出す';
    toast('書き出しに失敗しました。もう一度お試しください');
  } finally {
    btn.disabled = false;
    setProgress(false);
  }
});

async function saveBackupFile() {
  const r = pendingBackup;
  const file = new File([r.blob], r.filename, { type: 'application/zip' });
  let done = false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'ロケハン地図のバックアップ' });
      done = true;
    } else {
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      done = true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') toast('保存をやめました');
    else toast('保存できませんでした。もう一度お試しください');
  }
  if (done) {
    try { await setMeta('lastBackupAt', new Date().toISOString()); } catch (e) { /* 記録できなくても続ける */ }
    pendingBackup = null;
    $('backup-export').textContent = 'バックアップを書き出す';
    toast('バックアップを保存しました');
    updateBackupInfo();
  }
}

$('backup-file').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  setProgress(true);
  try {
    const r = await importBackup(f);
    await loadTags();
    await renderList({ fit: true });
    renderSettings();
    toast(`読み込みました（追加${r.added}件・更新${r.updated}件・写真${r.photos}枚）`);
  } catch (err) {
    toast(err && err.message ? err.message : '読み込めませんでした');
  } finally {
    setProgress(false);
  }
});

/* タグの管理 */
let tagEditing = null;  // 名前を変えているタグ
let tagDeleting = null; // 削除の確認中のタグ
function renderTagManager() {
  const box = $('tag-manage');
  box.textContent = '';
  const counts = new Map();
  for (const sp of spotsCache) for (const t of sp.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  for (const t of allTags) {
    const row = el('div', 'row tag-row');
    if (tagEditing === t) {
      const input = el('input', 'text-input flat');
      input.type = 'text';
      input.value = t;
      input.maxLength = 20;
      input.setAttribute('aria-label', `「${t}」の新しい名前`);
      const ok = el('button', 'pill-btn accent', '決定');
      ok.type = 'button';
      const cancel = el('button', 'pill-btn', 'やめる');
      cancel.type = 'button';
      ok.addEventListener('click', () => renameTag(t, input.value));
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) renameTag(t, input.value); });
      cancel.addEventListener('click', () => { tagEditing = null; renderTagManager(); });
      row.append(input, ok, cancel);
      setTimeout(() => input.focus(), 50);
    } else if (tagDeleting === t) {
      const n = counts.get(t) || 0;
      row.append(el('span', 'tag-row-name', n ? `「${t}」を削除して、${n}件の記録から外しますか？` : `「${t}」を削除しますか？`));
      const yes = el('button', 'pill-btn danger-fill', '削除');
      yes.type = 'button';
      const no = el('button', 'pill-btn', 'やめる');
      no.type = 'button';
      yes.addEventListener('click', () => deleteTag(t));
      no.addEventListener('click', () => { tagDeleting = null; renderTagManager(); });
      row.append(yes, no);
    } else {
      const name = el('span', 'tag-row-name', t);
      const cnt = el('span', 'subtle small num', `${counts.get(t) || 0}件`);
      const ed = el('button', 'text-btn', '名前を変更');
      ed.type = 'button';
      ed.setAttribute('aria-label', `「${t}」の名前を変更`);
      const del = el('button', 'text-btn danger-text', '削除');
      del.type = 'button';
      del.setAttribute('aria-label', `「${t}」を削除`);
      ed.addEventListener('click', () => { tagEditing = t; tagDeleting = null; renderTagManager(); });
      del.addEventListener('click', () => { tagDeleting = t; tagEditing = null; renderTagManager(); });
      row.append(name, cnt, ed, del);
    }
    box.append(row);
  }
}

async function updateSpotsTags(fn) {
  const spots = await getAllSpots();
  for (const sp of spots) {
    const before = JSON.stringify(sp.tags || []);
    const after = fn(sp.tags || []);
    if (JSON.stringify(after) !== before) {
      sp.tags = after;
      await putSpot(sp);
    }
  }
}

async function renameTag(oldName, raw) {
  const name = String(raw).trim().replace(/\s+/g, ' ');
  tagEditing = null;
  if (!name || name === oldName) { renderTagManager(); return; }
  try {
    const merged = allTags.includes(name);
    allTags = merged ? allTags.filter((x) => x !== oldName) : allTags.map((x) => (x === oldName ? name : x));
    await setMeta('tags', allTags);
    await updateSpotsTags((tags) => [...new Set(tags.map((x) => (x === oldName ? name : x)))]);
    if (filterTags.delete(oldName)) filterTags.add(name);
    await renderList();
    renderTagManager();
    toast(merged ? `「${oldName}」を「${name}」にまとめました` : `「${name}」に変更しました`);
  } catch (e) {
    toast('変更できませんでした');
  }
}

async function deleteTag(name) {
  tagDeleting = null;
  try {
    allTags = allTags.filter((x) => x !== name);
    await setMeta('tags', allTags);
    await updateSpotsTags((tags) => tags.filter((x) => x !== name));
    filterTags.delete(name);
    await renderList();
    renderTagManager();
    toast(`「${name}」を削除しました`);
  } catch (e) {
    toast('削除できませんでした');
  }
}

async function addTagFromSettings() {
  const name = $('tm-new').value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  if (!allTags.includes(name)) {
    allTags = [...allTags, name];
    try { await setMeta('tags', allTags); } catch (e) { toast('追加できませんでした'); return; }
  }
  $('tm-new').value = '';
  renderTagManager();
  toast(`「${name}」を追加しました`);
}
$('tm-add').addEventListener('click', addTagFromSettings);
$('tm-new').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) addTagFromSettings(); });

/* はじめての案内（Safariで開いたときに1回だけ） */
$('install-close').addEventListener('click', closeSheet);
if (!isStandalone && !ls('locahan-install-hint')) {
  ls('locahan-install-hint', '1');
  setTimeout(() => { if (!openSheetEl) openSheet($('install-sheet')); }, 1200);
}

/* 天気がまだの記録を、電波があるときに取得する */
let filling = false;
async function fillPendingWeather() {
  if (filling || !navigator.onLine) return;
  filling = true;
  let changed = false;
  try {
    const spots = await getAllSpots();
    const todo = spots.filter((s) => !s.weather || s.weather.status === 'pending').slice(0, 20);
    for (const s of todo) {
      const tries = (s.weather && s.weather.tries) || 0;
      try {
        s.weather = await fetchWeather(s.lat, s.lng, new Date(s.createdAt));
      } catch (e) {
        if (!navigator.onLine) break;
        s.weather = tries >= 2 ? { status: 'none' } : { status: 'pending', tries: tries + 1 };
      }
      delete s.thumbUrl;
      await putSpot(s);
      changed = true;
    }
  } catch (e) { /* 次の機会に */ }
  filling = false;
  if (changed) await renderList();
}
window.addEventListener('online', () => setTimeout(fillPendingWeather, 2000));

renderToday();
// 起動時は地図を現在地に合わせる（取得できないときは記録全体を表示）
function locateOnStartup() {
  const fallback = () => { if (spotsCache.length) mapView.fitAll(); };
  if (!window.isSecureContext || !('geolocation' in navigator)) { fallback(); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => mapView.showMe(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
    fallback,
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}
loadTags().then(() => renderList()).then(locateOnStartup).then(() => setTimeout(fillPendingWeather, 3000));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
