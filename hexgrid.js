/*
 * hexgrid.js — Grille hexagonale "pointy-top" en coordonnées axiales (q, r).
 * Réf. maths : https://www.redblobgames.com/grids/hexagons/
 *
 * On travaille en mètres autour d'une origine géographique, ce qui permet
 * d'ancrer chaque hexagone sur des coordonnées lat/lng réelles.
 */
const HexGrid = (function () {
  const SQRT3 = Math.sqrt(3);

  /* --- Conversion mètres <-> lat/lng (approx. plan tangent, ok à l'échelle ville) --- */
  const M_PER_DEG_LAT = 111320;
  function mPerDegLng(lat) { return 111320 * Math.cos((lat * Math.PI) / 180); }

  /* --- Axial hex -> centre en mètres (pointy-top) --- */
  function hexToMeters(q, r, size) {
    return {
      x: size * SQRT3 * (q + r / 2),
      y: size * 1.5 * r,
    };
  }

  /* --- Mètres -> hex axial (arrondi cube) --- */
  function metersToHex(x, y, size) {
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

  function key(q, r) { return q + "," + r; }

  /*
   * Construit la grille : une carte de tuiles indexées par "q,r".
   * origin : [lat, lng]  ·  size : rayon hex en mètres  ·  range : rayon en anneaux
   */
  function build(origin, size, range) {
    const tiles = new Map();
    const mLng = mPerDegLng(origin[0]);

    for (let q = -range; q <= range; q++) {
      for (let r = -range; r <= range; r++) {
        // Contrainte hexagonale pour une zone ~circulaire
        if (Math.abs(-q - r) > range) continue;
        const m = hexToMeters(q, r, size);
        const lat = origin[0] + m.y / M_PER_DEG_LAT;
        const lng = origin[1] + m.x / mLng;
        tiles.set(key(q, r), {
          q, r,
          mx: m.x, my: m.y,
          lat, lng,
          owner: null,
          capT: 0,          // progression de l'anim de capture (0..1)
          phase: Math.abs((q * 73856093) ^ (r * 19349663)) % 1000 / 1000, // déphasage pulsation
        });
      }
    }
    return {
      tiles,
      origin,
      size,
      range,
      mLng,
      key,
      metersToHex,
      // lat/lng -> tuile (ou null)
      tileAtLatLng(lat, lng) {
        const x = (lng - origin[1]) * mLng;
        const y = (lat - origin[0]) * M_PER_DEG_LAT;
        const h = metersToHex(x, y, size);
        return tiles.get(key(h.q, h.r)) || null;
      },
      // bornes en mètres (pour contraindre les runners)
      bounds: (function () {
        const ext = range * size * SQRT3;
        return { minX: -ext, maxX: ext, minY: -ext, maxY: ext };
      })(),
    };
  }

  return { build, hexToMeters, metersToHex };
})();
