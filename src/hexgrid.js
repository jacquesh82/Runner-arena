/*
 * hexgrid.js — Grille hexagonale "pointy-top" en coordonnées axiales (q, r).
 * Réf. maths : https://www.redblobgames.com/grids/hexagons/
 *
 * On travaille en mètres autour d'une origine géographique : chaque hexagone
 * possède une empreinte fixe sur le sol (lat/lng), indépendante du zoom.
 */
const SQRT3 = Math.sqrt(3);
const M_PER_DEG_LAT = 111320;
export function mPerDegLng(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

export function hexToMeters(q, r, size) {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}

export function metersToHex(x, y, size) {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return roundHex(q, r);
}

function roundHex(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export const hexKey = (q, r) => q + "," + r;

/*
 * Construit la grille : Map de tuiles indexées par "q,r".
 * origin : [lat, lng]  ·  size : rayon hex en mètres  ·  range : rayon en anneaux
 */
export function buildGrid(origin, size, range) {
  const tiles = new Map();
  const mLng = mPerDegLng(origin[0]);

  for (let q = -range; q <= range; q++) {
    for (let r = -range; r <= range; r++) {
      if (Math.abs(-q - r) > range) continue;
      const m = hexToMeters(q, r, size);
      const lat = origin[0] + m.y / M_PER_DEG_LAT;
      const lng = origin[1] + m.x / mLng;
      tiles.set(hexKey(q, r), {
        q, r, lat, lng,
        owner: null,
        // état d'animation (rendu Pixi)
        capT: 0,           // progression de la capture 0..1
        flash: 0,          // éclat blanc à la capture
        phase: (Math.abs((q * 73856093) ^ (r * 19349663)) % 1000) / 1000,
      });
    }
  }

  return {
    tiles,
    origin,
    size,
    range,
    mLng,
    tileAt(lat, lng) {
      const x = (lng - origin[1]) * mLng;
      const y = (lat - origin[0]) * M_PER_DEG_LAT;
      const h = metersToHex(x, y, size);
      return tiles.get(hexKey(h.q, h.r)) || null;
    },
  };
}
