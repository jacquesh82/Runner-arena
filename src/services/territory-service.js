/* ======================================================================
 * TERRITORY SERVICE — moteur de conquête de territoire (logique pure)
 * ----------------------------------------------------------------------
 * Consomme des positions (émises par LocationService) et applique les
 * règles du jeu, SANS rien dessiner :
 *   • Traversée   — entrer sur une tuile la revendique.
 *   • Encerclement — refermer une boucle capture toute la surface intérieure.
 *   • Vol          — capturer une tuile déjà tenue par un adversaire.
 *
 * Il mute uniquement le MODÈLE des tuiles (owner / acquiredAt / passes) et
 * émet des évènements ("capture", "enclose", "stats") que la couche de
 * rendu (UiService) met en scène (particules, bannières, haptique…).
 *
 *   LocationService ──position──▶ TerritoryService ──events──▶ UiService
 * ====================================================================== */

const TTL_DAYS = 15;
const DAY = 86400000;
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]; // voisins axiaux

export class TerritoryService extends EventTarget {
  constructor(grid, { me = "me", mode = "endurance" } = {}) {
    super();
    this.grid = grid;
    this.me = me;
    this.mode = mode;
    this.reset();
  }

  reset() {
    this.zones = 0;      // tuiles que je possède (cumul de la session)
    this.stolen = 0;     // dont volées à un adversaire
    this.enclosed = 0;   // dont capturées par encerclement
    this._trail = [];    // circuit courant : clés de tuiles, en ordre
    this._idx = new Map(); // clé -> index dans _trail (détection de boucle)
    this._last = null;
  }

  setMode(mode) { this.mode = mode; }
  _key(t) { return t.q + "," + t.r; }
  _now() { return Date.now(); }

  /* Appelé à chaque nouvelle position GPS. */
  visit(lat, lng) {
    const tile = this.grid.tileAt(lat, lng);
    if (!tile || tile === this._last) return;
    this._last = tile;
    const k = this._key(tile);

    tile.passes = (tile.passes || 0) + 1;

    // 1) capture par traversée
    if (tile.owner !== this.me) this._claim(tile);

    // 2) encerclement : cette tuile referme-t-elle une boucle du circuit ?
    if (this._idx.has(k)) {
      const loop = this._trail.slice(this._idx.get(k)); // segment fermé
      if (loop.length >= 6) this._enclose(loop);
      this._trail = [k]; this._idx = new Map([[k, 0]]);  // repart d'un circuit neuf
    } else {
      this._idx.set(k, this._trail.length);
      this._trail.push(k);
      if (this._trail.length > 600) { this._trail = [k]; this._idx = new Map([[k, 0]]); } // garde-fou mémoire
    }

    this._emitStats();
  }

  /* Revendique une tuile (traversée ou intérieur d'encerclement). */
  _claim(tile, kind = "trail") {
    const stolen = !!tile.owner && tile.owner !== this.me;
    tile.owner = this.me;
    tile.acquiredAt = this._now();
    tile.expiresAt = tile.acquiredAt + TTL_DAYS * DAY;
    this.zones++;
    if (stolen) this.stolen++;
    if (kind !== "silent") {
      this.dispatchEvent(new CustomEvent("capture", { detail: { tile, kind: stolen ? "steal" : kind } }));
    }
    return stolen;
  }

  /* Capture toutes les tuiles enfermées par la boucle (flood-fill local). */
  _enclose(loopKeys) {
    const loop = new Set(loopKeys);
    let mnQ = Infinity, mxQ = -Infinity, mnR = Infinity, mxR = -Infinity;
    for (const key of loopKeys) {
      const [q, r] = key.split(",").map(Number);
      if (q < mnQ) mnQ = q; if (q > mxQ) mxQ = q; if (r < mnR) mnR = r; if (r > mxR) mxR = r;
    }
    mnQ--; mxQ++; mnR--; mxR++;
    const inBox = (q, r) => q >= mnQ && q <= mxQ && r >= mnR && r <= mxR;

    // inonde depuis le bord de la bbox à travers les cases non-boucle → "extérieur"
    const ext = new Set(), stack = [];
    for (let q = mnQ; q <= mxQ; q++) for (let r = mnR; r <= mxR; r++) {
      if (q === mnQ || q === mxQ || r === mnR || r === mxR) {
        const k = q + "," + r;
        if (!loop.has(k) && !ext.has(k)) { ext.add(k); stack.push([q, r]); }
      }
    }
    while (stack.length) {
      const [q, r] = stack.pop();
      for (const [dq, dr] of NB) {
        const nq = q + dq, nr = r + dr, nk = nq + "," + nr;
        if (!inBox(nq, nr) || loop.has(nk) || ext.has(nk)) continue;
        ext.add(nk); stack.push([nq, nr]);
      }
    }

    // intérieur = cases de la bbox ni boucle ni extérieur → conquises
    const captured = [];
    for (let q = mnQ; q <= mxQ; q++) for (let r = mnR; r <= mxR; r++) {
      const k = q + "," + r;
      if (loop.has(k) || ext.has(k)) continue;
      const tile = this.grid.tiles.get(k);
      if (!tile || tile.owner === this.me) continue;
      this._claim(tile, "silent");   // pas d'évènement individuel : un seul "enclose"
      captured.push(tile);
    }

    if (captured.length) {
      this.enclosed += captured.length;
      this.dispatchEvent(new CustomEvent("enclose", { detail: { tiles: captured } }));
    }
  }

  _emitStats() {
    this.dispatchEvent(new CustomEvent("stats", {
      detail: { zones: this.zones, stolen: this.stolen, enclosed: this.enclosed },
    }));
  }
}
