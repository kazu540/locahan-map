// iPhoneのコンパス（向き）を読む部分
// iPhoneでは、最初に「動作と方向へのアクセス」の許可が必要です（ボタンを押したときにだけ聞けます）。

let listeners = [];

export function stopCompass() {
  for (const [type, fn] of listeners) window.removeEventListener(type, fn, true);
  listeners = [];
}

// onHeading(度, 精度) を何度も呼びます。使えないときは onError(理由) を呼びます。
// 理由：'denied'（許可されなかった）/ 'unsupported'（コンパスがない）
export async function startCompass(onHeading, onError) {
  stopCompass();
  if (typeof window.DeviceOrientationEvent === 'undefined') {
    onError('unsupported');
    return;
  }
  // iPhone（iOS 13以降）は許可が必要
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { onError('denied'); return; }
    } catch (e) {
      onError('denied');
      return;
    }
  }

  let got = false;
  // 揺れを抑えるため、直近の値をなめらかにする（角度の平均）
  let sx = null;
  let sy = null;
  const emit = (deg, acc) => {
    got = true;
    const r = (deg * Math.PI) / 180;
    if (sx === null) { sx = Math.cos(r); sy = Math.sin(r); } else {
      sx = sx * 0.7 + Math.cos(r) * 0.3;
      sy = sy * 0.7 + Math.sin(r) * 0.3;
    }
    const h = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
    onHeading(h, acc);
  };

  const onIOS = (e) => {
    if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
      emit(e.webkitCompassHeading, typeof e.webkitCompassAccuracy === 'number' ? e.webkitCompassAccuracy : null);
    } else if (e.absolute && typeof e.alpha === 'number') {
      emit((360 - e.alpha) % 360, null);
    }
  };
  const onAbs = (e) => {
    if (typeof e.alpha === 'number') emit((360 - e.alpha) % 360, null);
  };
  window.addEventListener('deviceorientation', onIOS, true);
  listeners.push(['deviceorientation', onIOS]);
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', onAbs, true);
    listeners.push(['deviceorientationabsolute', onAbs]);
  }

  setTimeout(() => {
    if (!got && listeners.length) {
      stopCompass();
      onError('unsupported');
    }
  }, 3000);
}
