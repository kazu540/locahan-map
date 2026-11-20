// 天気の取得（Open-Meteo：無料・登録不要）
// 送る情報は「緯度・経度・日付」だけです。写真やメモは送りません。
// https://open-meteo.com/

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const VARS = 'weather_code,temperature_2m,cloud_cover';
const DAY = 86400000;

// 天気の種類（WMOの天気コード → 日本語とアイコン）
export const KINDS = {
  clear: { label: '晴れ', code: 0 },
  partly: { label: '晴れ時々くもり', code: 2 },
  cloudy: { label: 'くもり', code: 3 },
  fog: { label: '霧', code: 45 },
  rain: { label: '雨', code: 61 },
  snow: { label: '雪', code: 71 },
  thunder: { label: '雷雨', code: 95 },
};
export const MANUAL_KINDS = ['clear', 'partly', 'cloudy', 'rain', 'snow', 'fog'];

export function kindFromCode(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

function detailLabel(code) {
  const map = {
    0: '快晴', 1: '晴れ', 2: '晴れ時々くもり', 3: 'くもり', 45: '霧', 48: '霧',
    51: '弱い霧雨', 53: '霧雨', 55: '強い霧雨', 56: '着氷性の霧雨', 57: '着氷性の霧雨',
    61: '小雨', 63: '雨', 65: '強い雨', 66: '着氷性の雨', 67: '着氷性の雨',
    71: '小雪', 73: '雪', 75: '大雪', 77: '霧雪',
    80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨', 85: 'にわか雪', 86: '強いにわか雪',
    95: '雷雨', 96: 'ひょうを伴う雷雨', 99: 'ひょうを伴う雷雨',
  };
  return map[code] || KINDS[kindFromCode(code)].label;
}

export function manualWeather(kind) {
  return { status: 'ok', source: 'manual', kind, label: KINDS[kind].label, code: KINDS[kind].code, temp: null, cloud: null };
}

function jstDateStr(date) {
  return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
function jstHourKey(date) {
  // 一番近い「時」に丸めた "2026-11-20T15:00"
  const r = new Date(Math.round(date.getTime() / 3600000) * 3600000 + 9 * 3600000);
  return `${r.toISOString().slice(0, 13)}:00`;
}

async function getJSON(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function result(code, temp, cloud) {
  if (code === null || code === undefined) throw new Error('天気のデータがありません');
  return {
    status: 'ok', source: 'auto', kind: kindFromCode(code), label: detailLabel(code), code,
    temp: temp == null ? null : Math.round(temp * 10) / 10,
    cloud: cloud == null ? null : Math.round(cloud),
    fetchedAt: new Date().toISOString(),
  };
}

// 指定した場所・日時の天気を取得する
export async function fetchWeather(lat, lng, date) {
  if (!navigator.onLine) throw new Error('offline');
  const la = lat.toFixed(4);
  const lo = lng.toFixed(4);
  const age = Date.now() - date.getTime();

  // いま（前後1時間以内）→ 現在の天気
  if (Math.abs(age) < 3600000) {
    const j = await getJSON(`${FORECAST}?latitude=${la}&longitude=${lo}&current=${VARS}&timezone=Asia%2FTokyo`);
    const c = j.current || {};
    return result(c.weather_code, c.temperature_2m, c.cloud_cover);
  }

  // 過去・未来 → 1時間ごとのデータから一番近い時刻を使う
  const day = jstDateStr(date);
  const base = age > 80 * DAY ? ARCHIVE : FORECAST; // 古い日付は過去データ用の窓口
  const j = await getJSON(`${base}?latitude=${la}&longitude=${lo}&hourly=${VARS}&timezone=Asia%2FTokyo&start_date=${day}&end_date=${day}`);
  const h = j.hourly || {};
  const i = (h.time || []).indexOf(jstHourKey(date));
  if (i < 0) throw new Error('その時刻の天気がありません');
  return result(h.weather_code[i], h.temperature_2m[i], h.cloud_cover[i]);
}

// 一覧などに出す短い文
export function weatherText(w) {
  if (!w || w.status !== 'ok') return '';
  const parts = [w.label];
  if (w.temp != null) parts.push(`${Math.round(w.temp)}℃`);
  if (w.cloud != null) parts.push(`雲 ${w.cloud}%`);
  return parts.join('・');
}

// 天気のアイコン（SVG）
export function weatherIcon(kind, size = 22) {
  const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>';
  const cloud = '<path d="M7 18h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.8 11 3.5 3.5 0 0 0 7 18z"/>';
  const icons = {
    clear: sun,
    partly: '<circle cx="9" cy="9" r="3"/><path d="M9 3v1.5M3 9h1.5M4.8 4.8l1 1M13.2 4.8l-1 1"/><path d="M9 19h8a3.5 3.5 0 0 0 .3-7A4.6 4.6 0 0 0 8.7 13 3 3 0 0 0 9 19z"/>',
    cloudy: cloud,
    fog: '<path d="M7 13h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.8 6 3.5 3.5 0 0 0 7 13z"/><path d="M4 17h16M6 20.5h12"/>',
    rain: '<path d="M7 15h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.8 8 3.5 3.5 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
    snow: '<path d="M7 15h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.8 8 3.5 3.5 0 0 0 7 15z"/><path d="M8 19h.01M12 21h.01M16 19h.01M10 21.5h.01M14 21.5h.01" stroke-width="3"/>',
    thunder: '<path d="M7 15h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.8 8 3.5 3.5 0 0 0 7 15z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind] || cloud}</svg>`;
}
