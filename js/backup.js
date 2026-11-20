// バックアップの書き出し・読み込み（写真込み）
import { getAllSpots, putSpot, getPhoto, putPhoto, getMeta, setMeta } from './db.js';
import { makeZip, readZip } from './zip.js';

const FORMAT = 1;

function stamp(d) {
  const j = new Date(d.getTime() + 9 * 3600000).toISOString();
  return `${j.slice(0, 10)}_${j.slice(11, 13)}${j.slice(14, 16)}`;
}

export async function exportBackup(defaultTags) {
  const spots = await getAllSpots();
  const tags = await getMeta('tags', defaultTags);
  const files = [];
  const photos = [];
  for (const s of spots) {
    for (const pid of s.photoIds || []) {
      const ph = await getPhoto(pid);
      if (!ph) continue;
      const entry = { id: ph.id, spotId: ph.spotId, width: ph.width, height: ph.height, createdAt: ph.createdAt, file: `photos/${ph.id}.jpg` };
      files.push({ name: entry.file, data: new Uint8Array(await ph.blob.arrayBuffer()) });
      if (ph.thumb) {
        entry.thumbFile = `thumbs/${ph.id}.jpg`;
        files.push({ name: entry.thumbFile, data: new Uint8Array(await ph.thumb.arrayBuffer()) });
      }
      photos.push(entry);
    }
  }
  const now = new Date();
  const data = { app: 'locahan', format: FORMAT, exportedAt: now.toISOString(), tags, spots, photos };
  files.unshift({ name: 'data.json', data: new TextEncoder().encode(JSON.stringify(data)) });
  const blob = makeZip(files);
  return { blob, filename: `locahan-backup_${stamp(now)}.zip`, spots: spots.length, photos: photos.length };
}

export async function importBackup(file) {
  const entries = await readZip(file);
  const raw = entries.get('data.json');
  if (!raw) throw new Error('このアプリのバックアップファイルではないようです');
  const data = JSON.parse(new TextDecoder().decode(raw));
  if (data.app !== 'locahan' || !Array.isArray(data.spots)) throw new Error('このアプリのバックアップファイルではないようです');

  const existing = new Set((await getAllSpots()).map((s) => s.id));
  let added = 0;
  let updated = 0;
  let photoCount = 0;
  for (const ph of data.photos || []) {
    const bytes = entries.get(ph.file);
    if (!bytes) continue;
    const thumbBytes = ph.thumbFile ? entries.get(ph.thumbFile) : null;
    await putPhoto({
      id: ph.id, spotId: ph.spotId, width: ph.width, height: ph.height, createdAt: ph.createdAt,
      blob: new Blob([bytes], { type: 'image/jpeg' }),
      thumb: thumbBytes ? new Blob([thumbBytes], { type: 'image/jpeg' }) : new Blob([bytes], { type: 'image/jpeg' }),
    });
    photoCount++;
  }
  for (const s of data.spots) {
    if (!s || !s.id || typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
    delete s.thumbUrl;
    if (existing.has(s.id)) updated++; else added++;
    await putSpot(s);
  }
  // タグは今あるものに足す（消さない）
  const current = await getMeta('tags', []);
  const merged = [...current];
  for (const t of [...(data.tags || []), ...data.spots.flatMap((s) => s.tags || [])]) {
    if (typeof t === 'string' && t && !merged.includes(t)) merged.push(t);
  }
  await setMeta('tags', merged);
  return { added, updated, photos: photoCount, exportedAt: data.exportedAt };
}
