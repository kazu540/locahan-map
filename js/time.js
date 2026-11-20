// 日本時間（Asia/Tokyo）での日付の表示と入力

const TZ = 'Asia/Tokyo';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const fmtParts = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

function parts(date) {
  const o = {};
  for (const p of fmtParts.formatToParts(date)) o[p.type] = p.value;
  return o;
}

// 例：2026年11月20日（金）15:42
export function formatFull(date) {
  const p = parts(date);
  return `${p.year}年${p.month}月${p.day}日（${p.weekday}）${p.hour}:${p.minute}`;
}

// 例：11月20日（金）15:42
export function formatShort(date) {
  const p = parts(date);
  return `${p.month}月${p.day}日（${p.weekday}）${p.hour}:${p.minute}`;
}

// 日時入力欄（datetime-local）用：日本時間の "2026-11-20T15:42"
export function toInputValue(date) {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

// 日時入力欄の値（日本時間）→ Date
export function fromInputValue(value) {
  if (!value) return null;
  const d = new Date(`${value}:00+09:00`);
  return isNaN(d.getTime()) ? null : d;
}

const fmtHM = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: false });
// 例：16:31
export function formatTime(date) {
  return date ? fmtHM.format(date) : '—';
}
