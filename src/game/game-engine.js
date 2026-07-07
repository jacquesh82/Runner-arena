/* ======================================================================
 * MOTEUR DE JEU — carte MapLibre (plateau incliné) + rendu WebGL PixiJS.
 * Piloté par le routeur d'écrans. Consomme les positions du LocationService.
 * Ne touche pas au HUD (les écrans s'en chargent) ; émet des événements.
 *
 *   init()               prépare carte + calque Pixi (une fois)
 *   setCenter(latLng)    (re)construit le plateau autour d'un point
 *   beginRun()/endRun()  active/désactive la capture ; endRun renvoie le bilan
 *   playCombat(onStep)   animation de combat de fin de course (async)
 *   recenter()           recentre la carte sur le joueur
 *
 * Événements : "capture" {zones, stolen}
 * ====================================================================== */

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Application, Graphics } from "pixi.js";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { buildGrid, mPerDegLng, hexKey } from "../hexgrid.js";

const CONFIG = { hexSize: 55, range: 14, zoom: 16.5, pitch: 38 };

/* Couleurs échantillonnées dans le logo Runner Arena */
const PLAYER = { color: 0xec7a1c, rgb: [236, 122, 28] };
const OWN = { color: 0x34ad69, fill: 0x237749, rgb: [52, 173, 105] };
const RIVAL = { color: 0xff5bb0, fill: 0xff2d95, rgb: [255, 45, 149] };
const RING = 0xf2c400;

const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GameEngine extends EventTarget {
  constructor(location, { start = [48.8566, 2.3522] } = {}) {
    super();
    this.location = location;
    this.startLatLng = start;
    this.grid = null;
    this.player = { lat: start[0], lng: start[1], heading: 0, has: false };
    this.follow = true;
    this.capturing = false;

    this.particles = [];
    this.rings = [];
    this.scorePops = [];
    this.zones = 0;
    this.t = 0;
  }

  async init() {
    this.map = new maplibregl.Map({
      container: "map",
      style: mapStyle(),
      center: [this.startLatLng[1], this.startLatLng[0]],
      zoom: CONFIG.zoom, pitch: CONFIG.pitch, bearing: 0,
      attributionControl: { compact: true }, dragRotate: false,
    });
    this.map.on("dragstart", () => (this.follow = false));

    this.buildBoard(this.startLatLng);

    const stage = document.getElementById("stage");
    this.app = new Application();
    await this.app.init({
      canvas: document.getElementById("game"),
      backgroundAlpha: 0, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true, resizeTo: stage, powerPreference: "high-performance",
    });
    this.gGrid = new Graphics();
    this.gGlow = new Graphics(); this.gGlow.blendMode = "add";
    this.gFill = new Graphics();
    this.gFx = new Graphics(); this.gFx.blendMode = "add";
    this.app.stage.addChild(this.gGrid, this.gGlow, this.gFill, this.gFx);
    this.app.ticker.add((tk) => this._frame(tk.deltaMS / 1000));

    this.location.addEventListener("position", (e) => this._onPosition(e.detail));
  }

  /* ---- Plateau ------------------------------------------------------- */
  buildBoard(center) {
    this.grid = buildGrid(center, CONFIG.hexSize, CONFIG.range);
    for (const tile of this.grid.tiles.values()) {
      const cs = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 30);
        cs.push([tile.lat + (CONFIG.hexSize * 0.94 * Math.sin(a)) / 111320, tile.lng + (CONFIG.hexSize * 0.94 * Math.cos(a)) / this.grid.mLng]);
      }
      tile._corners = cs;
    }
    this._seedRival();
    this.zones = 0;
    this.player = { lat: center[0], lng: center[1], heading: 0, has: false };
  }

  setCenter(latLng) {
    this.buildBoard(latLng);
    if (this.map) this.map.jumpTo({ center: [latLng[1], latLng[0]] });
  }

  _seedRival() {
    const tiles = [...this.grid.tiles.values()];
    for (let i = 0; i < 14; i++) {
      const t = tiles[(Math.floor(tiles.length * 0.5) + i * 7) % tiles.length];
      t.owner = "rival"; t.capT = 1;
    }
  }

  /* ---- Course -------------------------------------------------------- */
  beginRun() { this.capturing = true; this.follow = true; }
  endRun() { this.capturing = false; return { zones: this.zones }; }
  recenter() { this.follow = true; if (this.player.has) this.map.easeTo({ center: [this.player.lng, this.player.lat], duration: 500 }); }

  _onPosition(p) {
    if (this.player.has) this.player.heading = Math.atan2(p.lng - this.player.lng, p.lat - this.player.lat);
    this.player.lat = p.lat; this.player.lng = p.lng; this.player.has = true;
    if (this.follow && this.map) this.map.easeTo({ center: [p.lng, p.lat], duration: 400 });
    if (!this.capturing || this.location.state !== "running") return;
    const tile = this.grid.tileAt(p.lat, p.lng);
    if (tile && tile.owner !== "me") this._capture(tile);
  }

  _capture(tile, silent) {
    const stolen = tile.owner === "rival";
    tile.owner = "me"; tile.capT = 0.0001; tile.flash = 1;
    this.zones++;
    const p = this._project(tile.lat, tile.lng);
    this._burst(p.x, p.y, PLAYER.rgb, stolen ? 46 : 30);
    this.rings.push({ lat: tile.lat, lng: tile.lng, life: 0, max: 0.55 });
    if (!silent) this.scorePops.push({ x: p.x, y: p.y, life: 0, max: 0.9, text: stolen ? "VOL !" : "+1" });
    Haptics.impact({ style: stolen ? ImpactStyle.Heavy : ImpactStyle.Light }).catch(() => {});
    this._flash();
    this.dispatchEvent(new CustomEvent("capture", { detail: { zones: this.zones, stolen } }));
  }

  _burst(x, y, rgb, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = 60 + Math.random() * 220;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0, max: 0.5 + Math.random() * 0.6, size: 1.6 + Math.random() * 3, rgb });
    }
  }

  /* ---- Combat de territoire (fin de course) -------------------------- */
  async playCombat(onStep) {
    this.capturing = false;
    const tiles = this.grid.tiles;
    const mine = [...tiles.values()].filter((t) => t.owner === "me");
    const mineKeys = new Set(mine.map((t) => hexKey(t.q, t.r)));

    // Zones adverses au contact de mon territoire -> conquises
    const won = [];
    for (const t of tiles.values()) {
      if (t.owner !== "rival") continue;
      if (HEX_DIRS.some(([dq, dr]) => mineKeys.has(hexKey(t.q + dq, t.r + dr)))) won.push(t);
    }
    // Une partie de mon territoire exposé -> perdue (drame)
    const lost = mine
      .filter((t) => HEX_DIRS.some(([dq, dr]) => { const n = tiles.get(hexKey(t.q + dq, t.r + dr)); return n && n.owner === "rival" && !won.includes(n); }))
      .slice(0, 2);

    let w = 0, l = 0;
    for (const t of won) {
      await sleep(180);
      this._clashCapture(t, PLAYER.rgb); w++;
      onStep && onStep({ won: w, lost: l });
    }
    for (const t of lost) {
      await sleep(220);
      t.owner = "rival"; t.capT = 0.0001; t.flash = 1;
      const p = this._project(t.lat, t.lng);
      this._burst(p.x, p.y, RIVAL.rgb, 40);
      this._shake(); Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
      l++; onStep && onStep({ won: w, lost: l });
    }
    const runZones = this.zones;
    return { won: w, lost: l, net: runZones + w - l, total: [...tiles.values()].filter((t) => t.owner === "me").length };
  }

  _clashCapture(tile, rgb) {
    tile.owner = "me"; tile.capT = 0.0001; tile.flash = 1;
    const p = this._project(tile.lat, tile.lng);
    this._burst(p.x, p.y, rgb, 48);
    this.rings.push({ lat: tile.lat, lng: tile.lng, life: 0, max: 0.6 });
    this._shake();
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
  }

  _shake() {
    const s = document.getElementById("stage");
    s.classList.remove("shake"); void s.offsetWidth; s.classList.add("shake");
  }

  /* ---- Projections --------------------------------------------------- */
  _project(lat, lng) { return this.map.project([lng, lat]); }
  _mToPx(mx, my) {
    const lat = this.grid.origin[0] + my / 111320, lng = this.grid.origin[1] + mx / this.grid.mLng;
    return this.map.project([lng, lat]);
  }
  _pxPerMeter() {
    const c = this.map.getCenter();
    const p1 = this.map.project([c.lng, c.lat]), p2 = this.map.project([c.lng + 0.001, c.lat]);
    return Math.hypot(p2.x - p1.x, p2.y - p1.y) / (0.001 * mPerDegLng(c.lat));
  }

  /* ---- Rendu --------------------------------------------------------- */
  _frame(dt) {
    this.t += dt;
    if (!this.map || !this.map.loaded()) return;
    const W = this.app.renderer.width / this.app.renderer.resolution;
    const H = this.app.renderer.height / this.app.renderer.resolution;
    const ppm = this._pxPerMeter();
    const margin = 120;

    this.gGrid.clear(); this.gGlow.clear(); this.gFill.clear(); this.gFx.clear();

    for (const tile of this.grid.tiles.values()) {
      const c = this._project(tile.lat, tile.lng);
      if (c.x < -margin || c.x > W + margin || c.y < -margin || c.y > H + margin) continue;
      const pts = [];
      for (const [la, ln] of tile._corners) { const pp = this.map.project([ln, la]); pts.push(pp.x, pp.y); }

      if (!tile.owner) { this.gGrid.poly(pts).stroke({ width: 1, color: 0x9ab4ff, alpha: 0.16 }); continue; }

      const team = tile.owner === "me" ? OWN : RIVAL;
      const lineCol = team.color, fillCol = team.fill || team.color;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2 + tile.phase * 6.28);
      if (tile.capT > 0 && tile.capT < 1) tile.capT = Math.min(1, tile.capT + dt / 0.5);
      if (tile.flash > 0) tile.flash = Math.max(0, tile.flash - dt / 0.4);
      const grow = tile.capT > 0 && tile.capT < 1 ? easeOutBack(tile.capT) : 1;
      const sc = 0.15 + 0.85 * Math.min(grow, 1.25);
      const spts = scalePoly(pts, c.x, c.y, sc);
      this.gGlow.poly(scalePoly(pts, c.x, c.y, sc * 1.12)).fill({ color: lineCol, alpha: 0.12 + pulse * 0.06 });
      this.gFill.poly(spts).fill({ color: fillCol, alpha: 0.32 + pulse * 0.12 });
      this.gFill.poly(spts).stroke({ width: 1.8, color: lineCol, alpha: 0.7 + pulse * 0.3 });
      if (tile.flash > 0) this.gFx.poly(spts).fill({ color: 0xffffff, alpha: tile.flash * 0.6 });
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.life += dt; const k = r.life / r.max;
      if (k >= 1) { this.rings.splice(i, 1); continue; }
      const p = this._project(r.lat, r.lng);
      this.gFx.circle(p.x, p.y, CONFIG.hexSize * ppm * (0.4 + k * 1.7)).stroke({ width: 3 * (1 - k) + 0.5, color: RING, alpha: (1 - k) * 0.8 });
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pa = this.particles[i]; pa.life += dt;
      if (pa.life >= pa.max) { this.particles.splice(i, 1); continue; }
      pa.vy += 240 * dt; pa.vx *= 0.96; pa.vy *= 0.98; pa.x += pa.vx * dt; pa.y += pa.vy * dt;
      const a = 1 - pa.life / pa.max;
      this.gFx.circle(pa.x, pa.y, pa.size * a + 0.4).fill({ color: (pa.rgb[0] << 16) | (pa.rgb[1] << 8) | pa.rgb[2], alpha: a });
    }

    if (this.player.has) {
      const p = this._project(this.player.lat, this.player.lng);
      const pr = 6 + 2 * Math.sin(this.t * 4);
      this.gFx.circle(p.x, p.y, 16).fill({ color: PLAYER.color, alpha: 0.12 });
      this.gFx.circle(p.x, p.y, pr + 3).fill({ color: PLAYER.color, alpha: 0.25 });
      this.gFx.circle(p.x, p.y, 5).fill({ color: 0xffffff, alpha: 0.95 });
      const hx = p.x + Math.sin(this.player.heading) * 14, hy = p.y - Math.cos(this.player.heading) * 14;
      this.gFx.circle(hx, hy, 3).fill({ color: PLAYER.color, alpha: 0.9 });
    }

    this._updateScorePops(dt);
  }

  _updateScorePops(dt) {
    for (let i = this.scorePops.length - 1; i >= 0; i--) {
      const s = this.scorePops[i]; s.life += dt;
      if (s.life >= s.max) { if (s.el) s.el.remove(); this.scorePops.splice(i, 1); continue; }
      if (!s.el) { s.el = document.createElement("div"); s.el.className = "score-pop"; s.el.textContent = s.text; document.getElementById("stage").appendChild(s.el); }
      const k = easeOutCubic(Math.min(1, s.life / s.max));
      s.el.style.transform = `translate(${s.x}px, ${s.y - 40 * k}px) scale(${1 + 0.3 * (1 - k)})`;
      s.el.style.opacity = String(1 - k);
    }
  }

  _flash() { const el = document.getElementById("flash"); el.classList.remove("on"); void el.offsetWidth; el.classList.add("on"); }
}

function mapStyle() {
  return {
    version: 8,
    sources: { base: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap © CARTO" } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0c1a2b" } },
      { id: "base", type: "raster", source: "base", paint: { "raster-brightness-max": 0.85, "raster-saturation": -0.1 } },
    ],
  };
}

function scalePoly(pts, cx, cy, s) {
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) { out[i] = cx + (pts[i] - cx) * s; out[i + 1] = cy + (pts[i + 1] - cy) * s; }
  return out;
}
