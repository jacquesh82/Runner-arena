/* Géométrie hexagonale + rasterisation + encerclement — logique pure, réutilisée
 * côté serveur (miroir de src/hexgrid.js / territory-service.js). Aucune dépendance. */

const SQRT3 = Math.sqrt(3);
export const M_PER_DEG_LAT = 111320;
export const mPerDegLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
export const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
export const key = (q, r) => q + "," + r;

export function hexToMeters(q, r, size) {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}
function roundHex(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return { q: rx, r: rz };
}
export function metersToHex(x, y, size) {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return roundHex(q, r);
}

/* Tuile (q,r) contenant un point lat/lng, relativement à l'origine de l'instance. */
export function tileAt(lat, lng, origin, size) {
  const x = (lng - origin[1]) * mPerDegLng(origin[0]);
  const y = (lat - origin[0]) * M_PER_DEG_LAT;
  return metersToHex(x, y, size);
}
/* Centre lat/lng d'une clé "q,r". */
export function centerLatLng(k, origin, size) {
  const [q, r] = k.split(",").map(Number);
  const m = hexToMeters(q, r, size);
  return { lat: origin[0] + m.y / M_PER_DEG_LAT, lng: origin[1] + m.x / mPerDegLng(origin[0]) };
}

export function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/* Rasterise un tracé → tuiles ordonnées (uniques) + comptage de passages. */
export function rasterize(track, origin, size) {
  const order = [], seen = new Set(), passes = new Map();
  let last = null;
  const mark = (lat, lng) => {
    const t = tileAt(lat, lng, origin, size), k = key(t.q, t.r);
    if (!seen.has(k)) { seen.add(k); order.push(k); }
    if (k !== last) { passes.set(k, (passes.get(k) || 0) + 1); last = k; }
  };
  const mLng = mPerDegLng(origin[0]);
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    const dE = (b.lng - a.lng) * mLng, dN = (b.lat - a.lat) * M_PER_DEG_LAT;
    const steps = Math.max(1, Math.ceil(Math.hypot(dE, dN) / (size * 0.35)));
    for (let s = 0; s < steps; s++) { const f = s / steps; mark(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f); }
  }
  if (track.length) { const p = track[track.length - 1]; mark(p.lat, p.lng); }
  return { order, passes };
}

/* Tuiles enfermées par le tracé (course entière) : flood-fill depuis le bord de
 * la bbox à travers les cases hors-tracé ; l'intérieur = ce qui reste inatteignable.
 * Un tracé ouvert n'enferme rien ; un tracé qui referme une boucle enferme l'intérieur. */
export function enclosed(order) {
  if (order.length < 6) return new Set();
  const route = new Set(order);
  let mnQ = Infinity, mxQ = -Infinity, mnR = Infinity, mxR = -Infinity;
  for (const k of order) { const [q, r] = k.split(",").map(Number); if (q < mnQ) mnQ = q; if (q > mxQ) mxQ = q; if (r < mnR) mnR = r; if (r > mxR) mxR = r; }
  mnQ--; mxQ++; mnR--; mxR++;
  const inBox = (q, r) => q >= mnQ && q <= mxQ && r >= mnR && r <= mxR;

  const ext = new Set(), st = [];
  for (let q = mnQ; q <= mxQ; q++) for (let r = mnR; r <= mxR; r++) {
    if (q === mnQ || q === mxQ || r === mnR || r === mxR) { const k = key(q, r); if (!route.has(k) && !ext.has(k)) { ext.add(k); st.push([q, r]); } }
  }
  while (st.length) {
    const [q, r] = st.pop();
    for (const [dq, dr] of NB) { const nq = q + dq, nr = r + dr, nk = key(nq, nr); if (!inBox(nq, nr) || route.has(nk) || ext.has(nk)) continue; ext.add(nk); st.push([nq, nr]); }
  }

  const interior = new Set();
  for (let q = mnQ; q <= mxQ; q++) for (let r = mnR; r <= mxR; r++) { const k = key(q, r); if (!route.has(k) && !ext.has(k)) interior.add(k); }
  return interior;
}

/* Stats d'un tracé (distance, dénivelé, durée/vitesse si horodaté). */
export function trackStats(track) {
  let dist = 0, gain = 0, eMin = Infinity, eMax = -Infinity;
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    if (p.ele != null) { if (p.ele < eMin) eMin = p.ele; if (p.ele > eMax) eMax = p.ele; }
    if (i > 0) { dist += haversine(track[i - 1], track[i]); const de = (p.ele ?? 0) - (track[i - 1].ele ?? 0); if (de > 0) gain += de; }
  }
  const t0 = track[0]?.t, t1 = track[track.length - 1]?.t;
  const duration = (t0 != null && t1 != null) ? (t1 - t0) / 1000 : null;
  const speed = duration && duration > 0 ? dist / duration : null; // m/s
  return { distance: dist, gain: Math.round(gain), duration, speed, eMin, eMax };
}
