// 光の情報パネル（記録画面・詳細画面で共通）
import {
  sunPosition, dayTimes, dirName, altitudeWord, lightType, riseSetAzimuth,
  compassSVG, altitudeSVG, timelineEl,
} from './light.js';
import { formatTime } from './time.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderLightPanel(container, { date, lat, lng, heading = null }) {
  container.textContent = '';
  if (lat == null || lng == null) {
    container.append(el('p', 'help', '場所が決まると、太陽の位置を計算して表示します。'));
    return;
  }
  const pos = sunPosition(date, lat, lng);
  const times = dayTimes(date, lat, lng);

  const grid = el('div', 'bento');

  const c1 = el('div', 'card viz-card');
  c1.append(el('span', 'viz-label', '太陽の方位'), compassSVG(pos.azimuth, pos.altitude, heading, riseSetAzimuth(times, lat, lng)),
    el('span', 'viz-value num', `${Math.round(pos.azimuth)}° ${dirName(pos.azimuth)}`));

  const c2 = el('div', 'card viz-card');
  const word = altitudeWord(pos.altitude);
  const v2 = el('span', `viz-value${word === 'ゴールデンアワー' ? ' golden' : ''}`, word);
  c2.append(el('span', 'viz-label', '太陽の高さ'), altitudeSVG(pos.altitude), v2);

  const c3 = el('div', 'card tl-card wide');
  c3.append(el('span', 'viz-label', 'この日の時間帯'), timelineEl(times, date, formatTime));
  const row = el('div', 'tl-times num');
  const cell = (label, value, cls) => {
    const d = el('div', `tl-cell ${cls || ''}`);
    d.append(el('span', 'tl-cell-label', label), el('span', 'tl-cell-value', value));
    return d;
  };
  row.append(
    cell('日の出', formatTime(times.sunrise)),
    cell('夕方のゴールデンアワー', `${formatTime(times.goldenEveningStart)}–${formatTime(times.sunset)}`, 'golden'),
    cell('日没', formatTime(times.sunset), 'end'),
  );
  c3.append(row);
  c3.append(el('p', 'tl-note num',
    `朝のゴールデンアワー ${formatTime(times.sunrise)}–${formatTime(times.goldenMorningEnd)}　` +
    `ブルーアワー 朝 ${formatTime(times.blueMorningStart)}– ／ 夕 ${formatTime(times.blueEveningStart)}–${formatTime(times.blueEveningEnd)}`));
  const legend = el('div', 'tl-legend');
  legend.innerHTML = '<span><i class="lg golden"></i>ゴールデンアワー</span><span><i class="lg day"></i>日中</span><span><i class="lg blue"></i>ブルーアワー</span><span><i class="lg now"></i>この時刻</span>';
  c3.append(legend);

  grid.append(c1, c2, c3);

  const lt = lightType(heading, pos.azimuth, pos.altitude);
  if (lt) {
    const c4 = el('div', 'card lt-card wide');
    const text = el('div', 'lt-text');
    text.append(el('span', 'lt-title num', `向き ${Math.round(heading)}° ${dirName(heading)}`), el('span', 'lt-sub', lt.text));
    c4.append(el('span', 'lt-badge', lt.label), text);
    grid.append(c4);
  }
  container.append(grid);
}
