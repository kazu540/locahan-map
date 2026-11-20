// 地図（Leaflet + OpenStreetMap）
// 地図の絵柄（タイル）はインターネットから読み込みます。圏外では表示されないことがあります。

const L = window.L;
const TOKYO = [35.681, 139.767];

let map = null;
let markerLayer = null;
let meMarker = null;
let selectedId = null;
const markers = new Map(); // id -> marker
let handlers = { onSelect: () => {}, onDeselect: () => {}, onMove: () => {} };

export function initMap(h) {
  handlers = { ...handlers, ...h };
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    tap: false,
    worldCopyJump: true,
  }).setView(TOKYO, 12);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  L.control.attribution({ position: 'topleft', prefix: false }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
  map.on('click', () => { if (selectedId) { select(null); } });
  map.on('moveend', () => handlers.onMove(map.getCenter()));
  return map;
}

export function refreshSize() {
  if (map) map.invalidateSize();
}

export function getCenter() {
  return map ? map.getCenter() : { lat: TOKYO[0], lng: TOKYO[1] };
}

function pinIcon(thumbUrl, selected) {
  const cls = `pin${selected ? ' selected' : ''}${thumbUrl ? '' : ' no-photo'}`;
  const style = thumbUrl ? ` style="background-image:url('${thumbUrl}')"` : '';
  return L.divIcon({
    className: 'pin-wrap',
    html: `<span class="${cls}"${style}></span>`,
    iconSize: [52, 52],
    iconAnchor: [26, 26],
  });
}

// spots: [{ id, lat, lng, title, thumbUrl }]
export function setSpots(spots, { fit = false } = {}) {
  if (!map) return;
  markerLayer.clearLayers();
  markers.clear();
  for (const s of spots) {
    const m = L.marker([s.lat, s.lng], {
      icon: pinIcon(s.thumbUrl, s.id === selectedId),
      title: s.title || 'ロケ地',
      alt: s.title || 'ロケ地',
      riseOnHover: true,
      keyboard: true,
    });
    m._spot = s;
    m.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      select(s.id);
    });
    m.addTo(markerLayer);
    markers.set(s.id, m);
  }
  if (selectedId && !markers.has(selectedId)) select(null);
  if (fit) fitAll();
}

export function fitAll() {
  if (!map) return;
  const pts = [...markers.values()].map((m) => m.getLatLng());
  if (!pts.length) return;
  if (pts.length === 1) panAbovePanel(pts[0], 16);
  else map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [50, 90], paddingBottomRight: [70, 330], maxZoom: 16 });
}

// 下のパネルに隠れないよう、地点を画面の上から3割くらいの位置に表示
function panAbovePanel(latlng, zoom) {
  const size = map.getSize();
  const target = map.project(latlng, zoom).add([0, size.y * 0.2]);
  map.setView(map.unproject(target, zoom), zoom, { animate: true });
}

export function select(id) {
  const prev = selectedId;
  selectedId = id;
  if (prev && markers.has(prev)) {
    const m = markers.get(prev);
    m.setIcon(pinIcon(m._spot.thumbUrl, false));
    m.setZIndexOffset(0);
  }
  if (id && markers.has(id)) {
    const m = markers.get(id);
    m.setIcon(pinIcon(m._spot.thumbUrl, true));
    m.setZIndexOffset(1000);
    // パネルに隠れないよう、ピンを少し上寄りに
    panAbovePanel(m.getLatLng(), map.getZoom());
    handlers.onSelect(id);
  } else {
    handlers.onDeselect();
  }
}

export function showMe(lat, lng, accuracy) {
  if (!map) return;
  if (!meMarker) {
    meMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: 'me-wrap', html: '<span class="me-dot"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
  } else {
    meMarker.setLatLng([lat, lng]);
  }
  map.setView([lat, lng], Math.max(map.getZoom(), 15));
}
