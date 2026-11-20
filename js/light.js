// 光の計算（SunCalc を使用）と、図（コンパス・高度の弧・時間帯のバー）の作成
// SunCalc は vendor/suncalc.js に同梱しているので、電波がなくても計算できます。

const SunCalc = window.SunCalc;
const RAD = 180 / Math.PI;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ブルーアワー（太陽が地平線の下 4〜6度）の境目を追加
SunCalc.addTime(-4, 'blueHourMorningEnd', 'blueHourEveningStart');

const DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
  '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];

export function dirName(deg) {
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// 太陽の高度・方位（北=0度、東=90度、南=180度、西=270度）
export function sunPosition(date, lat, lng) {
  const p = SunCalc.getPosition(date, lat, lng);
  return {
    altitude: p.altitude * RAD,
    azimuth: ((p.azimuth * RAD + 180) % 360 + 360) % 360,
  };
}

function valid(d) { return d instanceof Date && !isNaN(d.getTime()) ? d : null; }

// その日（日本時間）の日の出・日没・ゴールデンアワーなど
export function dayTimes(date, lat, lng) {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  const noon = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 12) - JST_OFFSET_MS);
  const t = SunCalc.getTimes(noon, lat, lng);
  return {
    sunrise: valid(t.sunrise),
    sunset: valid(t.sunset),
    goldenMorningEnd: valid(t.goldenHourEnd),
    goldenEveningStart: valid(t.goldenHour),
    blueMorningStart: valid(t.dawn),
    blueMorningEnd: valid(t.blueHourMorningEnd),
    blueEveningStart: valid(t.blueHourEveningStart),
    blueEveningEnd: valid(t.dusk),
    solarNoon: valid(t.solarNoon),
  };
}

// 保存用にまとめた光の情報
export function lightSnapshot(date, lat, lng) {
  const pos = sunPosition(date, lat, lng);
  const t = dayTimes(date, lat, lng);
  const iso = (d) => (d ? d.toISOString() : null);
  return {
    altitude: Math.round(pos.altitude * 10) / 10,
    azimuth: Math.round(pos.azimuth * 10) / 10,
    sunrise: iso(t.sunrise),
    sunset: iso(t.sunset),
    goldenMorning: [iso(t.sunrise), iso(t.goldenMorningEnd)],
    goldenEvening: [iso(t.goldenEveningStart), iso(t.sunset)],
  };
}

// 太陽の高さの言葉
export function altitudeWord(alt) {
  if (alt < -6) return '夜';
  if (alt < -0.833) return 'ブルーアワー前後';
  if (alt < 6) return 'ゴールデンアワー';
  if (alt < 20) return '低め・やわらかい';
  if (alt < 45) return '中くらい';
  return '高い・影が短い';
}

// 向き（カメラが向いている方角）と太陽から、順光・逆光・サイド光
export function lightType(heading, sunAz, sunAlt) {
  if (heading === null || heading === undefined) return null;
  if (sunAlt < -0.833) return { label: '太陽なし', text: '太陽が沈んでいる時間です' };
  const diff = ((sunAz - heading + 540) % 360) - 180; // -180〜180（＋は右側）
  const a = Math.abs(diff);
  if (a <= 45) return { label: '逆光', text: '太陽がカメラの正面側にあります。被写体の輪郭が光ります' };
  if (a >= 135) return { label: '順光', text: '太陽を背にして撮る向きです。色がはっきり出ます' };
  return { label: 'サイド光', text: `太陽がカメラの${diff > 0 ? '右' : '左'}側にあります。立体感が出ます` };
}

/* ---------- 図（SVG） ---------- */
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  return e;
}
function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

// コンパス：太陽の方位（オレンジの丸）と、カメラの向き（線）
export function compassSVG(sunAz, sunAlt, heading, dayArc = null) {
  const s = svgEl('svg', { viewBox: '0 0 100 100', width: '100', height: '100', class: 'viz' });
  const label = `太陽は${dirName(sunAz)}（${Math.round(sunAz)}度）` +
    (heading != null ? `、カメラは${dirName(heading)}（${Math.round(heading)}度）を向いている` : '');
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', label);
  s.append(svgEl('circle', { cx: 50, cy: 50, r: 38, class: 'viz-track', fill: 'none' }));
  if (dayArc && dayArc.rise != null && dayArc.set != null) {
    // この日の太陽が通る方角の範囲（日の出〜日没）
    const span = ((dayArc.set - dayArc.rise) + 360) % 360;
    const [ax, ay] = polar(50, 50, 38, dayArc.rise);
    const [bx, by] = polar(50, 50, 38, dayArc.set);
    s.append(svgEl('path', { d: `M${ax} ${ay} A38 38 0 ${span > 180 ? 1 : 0} 1 ${bx} ${by}`, class: 'viz-dayarc', fill: 'none' }));
  }
  for (let d = 0; d < 360; d += 30) {
    const [x1, y1] = polar(50, 50, 38, d);
    const [x2, y2] = polar(50, 50, d % 90 === 0 ? 32 : 35, d);
    s.append(svgEl('line', { x1, y1, x2, y2, class: 'viz-tick' }));
  }
  const n = svgEl('text', { x: 50, y: 9, 'text-anchor': 'middle', class: 'viz-north' });
  n.textContent = 'N';
  s.append(n);
  if (heading != null) {
    const [l1x, l1y] = polar(50, 50, 30, heading - 25);
    const [l2x, l2y] = polar(50, 50, 30, heading + 25);
    s.append(svgEl('path', { d: `M50 50 L${l1x} ${l1y} A30 30 0 0 1 ${l2x} ${l2y} Z`, class: 'viz-fov' }));
    const [hx, hy] = polar(50, 50, 30, heading);
    s.append(svgEl('line', { x1: 50, y1: 50, x2: hx, y2: hy, class: 'viz-heading' }));
  }
  const [sx, sy] = polar(50, 50, 38, sunAz);
  s.append(svgEl('circle', { cx: sx, cy: sy, r: 7, class: sunAlt > -0.833 ? 'viz-sun' : 'viz-sun down' }));
  s.append(svgEl('circle', { cx: 50, cy: 50, r: 3, class: 'viz-center' }));
  return s;
}

// 弧のゲージ：太陽の高さ（0〜90度）
export function altitudeSVG(alt) {
  const s = svgEl('svg', { viewBox: '0 0 120 74', width: '120', height: '74', class: 'viz' });
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', `太陽の高さ ${Math.round(alt)}度`);
  const cx = 60, cy = 64, r = 48;
  const pt = (deg) => [cx - r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)];
  s.append(svgEl('path', { d: `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`, class: 'viz-arc-track', fill: 'none' }));
  const [gx, gy] = pt(6);
  s.append(svgEl('path', { d: `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${gx} ${gy}`, class: 'viz-arc-golden', fill: 'none' }));
  const shown = Math.max(0, Math.min(90, alt));
  if (alt > 0) {
    const [ex, ey] = pt(shown);
    s.append(svgEl('path', { d: `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${ex} ${ey}`, class: 'viz-arc-value', fill: 'none' }));
  }
  const [px, py] = pt(shown);
  s.append(svgEl('circle', { cx: px, cy: py, r: 6.5, class: alt > -0.833 ? 'viz-sun ring' : 'viz-sun down ring' }));
  const t = svgEl('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', class: 'viz-big' });
  t.textContent = `${Math.round(alt)}°`;
  s.append(t);
  return s;
}

// 時間帯のバー（日の出〜日没の前後を表示）
export function timelineEl(times, now, fmtTime) {
  const wrap = document.createElement('div');
  wrap.className = 'timeline';
  if (!times.sunrise || !times.sunset) {
    wrap.textContent = 'この日は日の出・日没がありません';
    return wrap;
  }
  const start = times.sunrise.getTime() - 90 * 60000;
  const end = times.sunset.getTime() + 90 * 60000;
  const pct = (d) => `${Math.max(0, Math.min(100, ((d.getTime() - start) / (end - start)) * 100))}%`;
  const seg = (a, b, cls) => {
    if (!a || !b) return;
    const e = document.createElement('div');
    e.className = `tl-seg ${cls}`;
    e.style.left = pct(a);
    e.style.width = `calc(${pct(b)} - ${pct(a)})`;
    bar.append(e);
  };
  const bar = document.createElement('div');
  bar.className = 'tl-bar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label',
    `日の出 ${fmtTime(times.sunrise)}、日没 ${fmtTime(times.sunset)}、夕方のゴールデンアワー ${fmtTime(times.goldenEveningStart)}から`);
  seg(times.blueMorningStart, times.blueMorningEnd, 'blue');
  seg(times.sunrise, times.sunset, 'day');
  seg(times.sunrise, times.goldenMorningEnd, 'golden');
  seg(times.goldenEveningStart, times.sunset, 'golden');
  seg(times.blueEveningStart, times.blueEveningEnd, 'blue');
  if (now && now.getTime() >= start && now.getTime() <= end) {
    const m = document.createElement('div');
    m.className = 'tl-now';
    m.style.left = pct(now);
    bar.append(m);
  }
  wrap.append(bar);
  return wrap;
}

/* ---------- 1日の太陽の動き ---------- */
// 日の出・日没の方位（コンパスに表示する範囲）
export function riseSetAzimuth(times, lat, lng) {
  if (!times.sunrise || !times.sunset) return null;
  return {
    rise: sunPosition(times.sunrise, lat, lng).azimuth,
    set: sunPosition(times.sunset, lat, lng).azimuth,
  };
}

// 1時間ごとの高さと方位
export function hourlyTable(times, lat, lng) {
  if (!times.sunrise || !times.sunset) return [];
  const H = 3600000;
  const rows = [];
  const start = Math.ceil((times.sunrise.getTime() - 1) / H) * H;
  for (let t = start; t <= times.sunset.getTime(); t += H) {
    const d = new Date(t);
    rows.push({ date: d, ...sunPosition(d, lat, lng) });
  }
  return rows;
}

// 高さのグラフ（横＝時刻、縦＝太陽の高さ）。タップした時刻を onPick で返す
export function dayChartSVG(times, lat, lng, selected, fmtTime, onPick) {
  const W = 340, H = 170, L = 30, R = 10, T = 14, B = 26;
  const s = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'day-chart' });
  if (!times.sunrise || !times.sunset) return s;
  const start = times.sunrise.getTime() - 60 * 60000;
  const end = times.sunset.getTime() + 60 * 60000;
  const samples = [];
  for (let t = start; t <= end; t += 5 * 60000) samples.push([t, sunPosition(new Date(t), lat, lng).altitude]);
  const maxAlt = Math.max(...samples.map((x) => x[1]));
  const yMin = -10;
  const yMax = Math.max(30, Math.ceil((maxAlt + 5) / 10) * 10);
  const x = (t) => L + ((t - start) / (end - start)) * (W - L - R);
  const y = (a) => T + ((yMax - a) / (yMax - yMin)) * (H - T - B);
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', `この日の太陽の高さの変化。最も高いときで${Math.round(maxAlt)}度`);

  // ゴールデンアワーの帯（高さ0〜6度）
  s.append(svgEl('rect', { x: L, y: y(6), width: W - L - R, height: y(0) - y(6), class: 'dc-golden' }));
  // 目盛り
  for (let a = 0; a <= yMax; a += yMax > 40 ? 20 : 10) {
    s.append(svgEl('line', { x1: L, x2: W - R, y1: y(a), y2: y(a), class: a === 0 ? 'dc-horizon' : 'dc-grid' }));
    const tx = svgEl('text', { x: L - 5, y: y(a) + 3.5, 'text-anchor': 'end', class: 'dc-label' });
    tx.textContent = `${a}°`;
    s.append(tx);
  }
  const HOUR = 3600000;
  const step = (end - start) / HOUR > 12 ? 3 : 2;
  for (let t = Math.ceil(start / HOUR) * HOUR; t <= end; t += HOUR) {
    const hourJst = new Date(t + 9 * HOUR).getUTCHours();
    if (hourJst % step) continue;
    s.append(svgEl('line', { x1: x(t), x2: x(t), y1: T, y2: H - B, class: 'dc-grid' }));
    const tx = svgEl('text', { x: x(t), y: H - 8, 'text-anchor': 'middle', class: 'dc-label' });
    tx.textContent = `${hourJst}時`;
    s.append(tx);
  }
  // 曲線
  const d = samples.map(([t, a], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(a).toFixed(1)}`).join(' ');
  s.append(svgEl('path', { d: `${d} L${x(end)} ${y(yMin)} L${x(start)} ${y(yMin)} Z`, class: 'dc-area' }));
  s.append(svgEl('path', { d, class: 'dc-line', fill: 'none' }));
  // 選んだ時刻
  if (selected) {
    const st = selected.getTime();
    if (st >= start && st <= end) {
      const a = sunPosition(selected, lat, lng).altitude;
      s.append(svgEl('line', { x1: x(st), x2: x(st), y1: T, y2: H - B, class: 'dc-cursor' }));
      s.append(svgEl('circle', { cx: x(st), cy: y(a), r: 6, class: 'viz-sun ring' }));
    }
  }
  if (onPick) {
    s.classList.add('pickable');
    s.addEventListener('click', (e) => {
      const r = s.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const t = start + ((px - L) / (W - L - R)) * (end - start);
      onPick(new Date(Math.max(start, Math.min(end, t))));
    });
  }
  return s;
}
