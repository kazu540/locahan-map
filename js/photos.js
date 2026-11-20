// 写真を保存用に小さくする部分
// ・長い辺を 2048px（詳細表示用）と 480px（一覧用の小さい版）にそろえる
// ・JPEG に変換して容量を減らす
// ・iPhoneの写真の向き（縦・横）はブラウザが自動で直してくれます

const FULL_MAX = 2048;
const THUMB_MAX = 480;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('写真を読み込めませんでした')); };
    img.src = url;
  });
}

function drawResized(img, max, quality) {
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // メモリを早めに手放す（iPhoneで写真を続けて扱うときの対策）
      canvas.width = canvas.height = 0;
      if (blob) resolve({ blob, width: w, height: h });
      else reject(new Error('写真を変換できませんでした'));
    }, 'image/jpeg', quality);
  });
}

export async function processPhoto(file) {
  const img = await loadImage(file);
  const full = await drawResized(img, FULL_MAX, 0.82);
  const thumb = await drawResized(img, THUMB_MAX, 0.75);
  return { blob: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
}
