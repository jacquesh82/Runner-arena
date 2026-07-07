/* ======================================================================
 * SERVICE 2 — UI / Jeu
 * ----------------------------------------------------------------------
 * Carte réelle (MapLibre GL, inclinée en plateau) + calque de jeu WebGL
 * (PixiJS) : plateau hexagonal, capture des zones traversées, effets
 * "juicy" (particules, glow additif, pop élastique), HUD portrait.
 *
 * Se contente de CONSOMMER les positions émises par LocationService.
 * ====================================================================== */

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Application, Graphics } from "pixi.js";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { buildGrid, mPerDegLng } from "../hexgrid.js";

const CONFIG = {
  hexSize: 55, // rayon d'un hexagone en mètres
  range: 14, // rayon de la grille (anneaux)
  zoom: 16.5,
  pitch: 38, // inclinaison "plateau de jeu"
  captureRadius: 55, // m : distance sous laquelle une zone est prise
};

/* Charte Runner Arena (d'après le logo) */
const PLAYER = { color: 0xff7a1a, rgb: [255, 122, 26] }; // le runner = orange
const OWN = { color: 0x2fbf4a, rgb: [47, 191, 74] };     // ton territoire = vert
const RIVAL = { color: 0xff2d95, rgb: [255, 45, 149] };  // adversaire = magenta
const RING = 0xf2c500;                                    // onde = jaune piste

/* Fond de carte lisible (rues + labels) — remplaçable par du satellite */
function mapStyle() {
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
          "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap © CARTO",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0b1524" } },
      { id: "base", type: "raster", source: "base", paint: { "raster-brightness-max": 0.85, "raster-saturation": -0.1 } },
    ],
  };
}

/* --- easings "juicy" --- */
const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export class UiService {
  constructor(location, { start = [48.8566, 2.3522] } = {}) {
    this.location = location;
    this.startLatLng = start;
    this.grid = null;
    this.player = { lat: start[0], lng: start[1], heading: 0, has: false };
    this.follow = true;

    this.particles = [];
    this.rings = [];
    this.scorePops = [];
    this.zones = 0;
    this.t = 0;
  }

  async init() {
    /* --- Carte --- */
    this.map = new maplibregl.Map({
      container: "map",
      style: mapStyle(),
      center: [this.startLatLng[1], this.startLatLng[0]],
      zoom: CONFIG.zoom,
      pitch: CONFIG.pitch,
      bearing: 0,
      attributionControl: { compact: true },
      dragRotate: false,
      touchZoomRotate: true,
    });
    this.map.on("dragstart", () => (this.follow = false));

    /* --- Grille (empreinte fixe au sol) --- */
    this.grid = buildGrid(this.startLatLng, CONFIG.hexSize, CONFIG.range);
    this._precomputeCorners();
    this._seedRival(); // quelques zones adverses pour l'ambiance "arène"

    /* --- Calque WebGL Pixi --- */
    const stage = document.getElementById("stage");
    this.app = new Application();
    await this.app.init({
      canvas: document.getElementById("game"),
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      resizeTo: stage,
      powerPreference: "high-performance",
    });

    this.gGrid = new Graphics();
    this.gGlow = new Graphics(); this.gGlow.blendMode = "add";
    this.gFill = new Graphics();
    this.gFx = new Graphics(); this.gFx.blendMode = "add";
    this.app.stage.addChild(this.gGrid, this.gGlow, this.gFill, this.gFx);

    this.app.ticker.add((tk) => this._frame(tk.deltaMS / 1000));

    /* --- Abonnement au service Localisation --- */
    this.location.addEventListener("position", (e) => this._onPosition(e.detail));
    this.location.addEventListener("stats", (e) => this._onStats(e.detail));

    this._wireHud();
  }

  /* ---- Géométrie : coins de chaque hexagone en lat/lng (une seule fois) --- */
  _precomputeCorners() {
    const { size, mLng } = this.grid;
    for (const tile of this.grid.tiles.values()) {
      const cs = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 30);
        const dx = size * 0.94 * Math.cos(a);
        const dy = size * 0.94 * Math.sin(a);
        cs.push([tile.lat + dy / 111320, tile.lng + dx / mLng]);
      }
      tile._corners = cs;
    }
  }

  _seedRival() {
    const tiles = [...this.grid.tiles.values()];
    for (let i = 0; i < 10; i++) {
      const t = tiles[(Math.floor(tiles.length * 0.5) + i * 7) % tiles.length];
      t.owner = "rival"; t.capT = 1;
    }
  }

  /* ---- Projections écran ---- */
  _project(lat, lng) { return this.map.project([lng, lat]); }
  _pxPerMeter() {
    const c = this.map.getCenter();
    const p1 = this.map.project([c.lng, c.lat]);
    const p2 = this.map.project([c.lng + 0.001, c.lat]);
    return Math.hypot(p2.x - p1.x, p2.y - p1.y) / (0.001 * mPerDegLng(c.lat));
  }

  /* ---- Réception d'une position (depuis LocationService) ---- */
  _onPosition(p) {
    if (this.player.has) {
      this.player.heading = Math.atan2(p.lng - this.player.lng, p.lat - this.player.lat);
    }
    this.player.lat = p.lat; this.player.lng = p.lng; this.player.has = true;

    if (this.follow) this.map.easeTo({ center: [p.lng, p.lat], duration: 400 });

    // Capture de la zone courante
    const tile = this.grid.tileAt(p.lat, p.lng);
    if (tile && tile.owner !== "me") this._capture(tile);
  }

  _onStats(s) {
    document.getElementById("statDist").textContent = (s.distance / 1000).toFixed(2);
    const mm = Math.floor(s.duration / 60), ss = Math.floor(s.duration % 60);
    document.getElementById("statTime").textContent =
      String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
    document.getElementById("statPace").textContent =
      s.pace && isFinite(s.pace) ? s.pace.toFixed(1) : "--";
  }

  /* ---- Capture d'une zone : le moment "juicy" ---- */
  _capture(tile) {
    const stolen = tile.owner === "rival";
    tile.owner = "me";
    tile.capT = 0.0001;
    tile.flash = 1;
    this.zones++;
    document.getElementById("statZones").textContent = this.zones;

    // burst de particules
    const p = this._project(tile.lat, tile.lng);
    const n = stolen ? 46 : 30;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 220;
      this.particles.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0, max: 0.5 + Math.random() * 0.6,
        size: 1.6 + Math.random() * 3, rgb: PLAYER.rgb,
      });
    }
    this.rings.push({ lat: tile.lat, lng: tile.lng, life: 0, max: 0.55 });
    this.scorePops.push({ x: p.x, y: p.y, life: 0, max: 0.9, text: stolen ? "VOL !" : "+1" });

    this._banner(stolen ? "Zone volée à l'adversaire !" : "Zone conquise !");
    this._flash();
    Haptics.impact({ style: stolen ? ImpactStyle.Heavy : ImpactStyle.Light }).catch(() => {});
  }

  /* ---- Boucle de rendu ---- */
  _frame(dt) {
    this.t += dt;
    if (!this.map || !this.map.loaded()) return;

    const W = this.app.renderer.width / this.app.renderer.resolution;
    const H = this.app.renderer.height / this.app.renderer.resolution;
    const ppm = this._pxPerMeter();
    const margin = 120;

    this.gGrid.clear();
    this.gGlow.clear();
    this.gFill.clear();
    this.gFx.clear();

    // --- hexagones ---
    for (const tile of this.grid.tiles.values()) {
      const c = this._project(tile.lat, tile.lng);
      if (c.x < -margin || c.x > W + margin || c.y < -margin || c.y > H + margin) continue;

      const pts = [];
      for (const [la, ln] of tile._corners) {
        const pp = this.map.project([ln, la]);
        pts.push(pp.x, pp.y);
      }

      if (!tile.owner) {
        this.gGrid.poly(pts).stroke({ width: 1, color: 0x9ab4ff, alpha: 0.16 });
        continue;
      }

      const team = tile.owner === "me" ? OWN : RIVAL;
      const col = team.color;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2 + tile.phase * 6.28);

      // animation de capture (pop élastique)
      if (tile.capT > 0 && tile.capT < 1) tile.capT = Math.min(1, tile.capT + dt / 0.5);
      if (tile.flash > 0) tile.flash = Math.max(0, tile.flash - dt / 0.4);
      const grow = tile.capT > 0 && tile.capT < 1 ? easeOutBack(tile.capT) : 1;
      const sc = 0.15 + 0.85 * Math.min(grow, 1.25);
      const spts = scalePoly(pts, c.x, c.y, sc);

      // halo (glow additif)
      this.gGlow.poly(scalePoly(pts, c.x, c.y, sc * 1.12))
        .fill({ color: col, alpha: 0.12 + pulse * 0.06 });
      // remplissage
      this.gFill.poly(spts).fill({ color: col, alpha: 0.28 + pulse * 0.12 });
      // contour néon
      this.gFill.poly(spts).stroke({ width: 1.8, color: col, alpha: 0.7 + pulse * 0.3 });
      // éclat de capture
      if (tile.flash > 0) this.gFx.poly(spts).fill({ color: 0xffffff, alpha: tile.flash * 0.6 });
    }

    // --- ondes de capture ---
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      const k = r.life / r.max;
      if (k >= 1) { this.rings.splice(i, 1); continue; }
      const p = this._project(r.lat, r.lng);
      this.gFx.circle(p.x, p.y, CONFIG.hexSize * ppm * (0.4 + k * 1.7))
        .stroke({ width: 3 * (1 - k) + 0.5, color: RING, alpha: (1 - k) * 0.8 });
    }

    // --- particules ---
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pa = this.particles[i];
      pa.life += dt;
      if (pa.life >= pa.max) { this.particles.splice(i, 1); continue; }
      pa.vy += 240 * dt; // gravité
      pa.vx *= 0.96; pa.vy *= 0.98;
      pa.x += pa.vx * dt; pa.y += pa.vy * dt;
      const a = 1 - pa.life / pa.max;
      this.gFx.circle(pa.x, pa.y, pa.size * a + 0.4)
        .fill({ color: (pa.rgb[0] << 16) | (pa.rgb[1] << 8) | pa.rgb[2], alpha: a });
    }

    // --- joueur ---
    if (this.player.has) {
      const p = this._project(this.player.lat, this.player.lng);
      const pr = 6 + 2 * Math.sin(this.t * 4);
      this.gFx.circle(p.x, p.y, 16).fill({ color: PLAYER.color, alpha: 0.12 });
      this.gFx.circle(p.x, p.y, pr + 3).fill({ color: PLAYER.color, alpha: 0.25 });
      this.gFx.circle(p.x, p.y, 5).fill({ color: 0xffffff, alpha: 0.95 });
      // pointe de direction
      const hx = p.x + Math.sin(this.player.heading) * 14;
      const hy = p.y - Math.cos(this.player.heading) * 14;
      this.gFx.circle(hx, hy, 3).fill({ color: PLAYER.color, alpha: 0.9 });
    }

    // --- pop de score (DOM léger) ---
    this._updateScorePops(dt);
  }

  _updateScorePops(dt) {
    for (let i = this.scorePops.length - 1; i >= 0; i--) {
      const s = this.scorePops[i];
      s.life += dt;
      if (s.life >= s.max) {
        if (s.el) s.el.remove();
        this.scorePops.splice(i, 1);
        continue;
      }
      if (!s.el) {
        s.el = document.createElement("div");
        s.el.className = "score-pop";
        s.el.textContent = s.text;
        document.getElementById("stage").appendChild(s.el);
      }
      const k = easeOutCubic(Math.min(1, s.life / s.max));
      s.el.style.transform = `translate(${s.x}px, ${s.y - 40 * k}px) scale(${1 + 0.3 * (1 - k)})`;
      s.el.style.opacity = String(1 - k);
    }
  }

  /* ---- HUD ---- */
  _wireHud() {
    const btnRun = document.getElementById("btnRun");
    const label = btnRun.querySelector(".run-label");
    const btnGpx = document.getElementById("btnGpx");

    btnRun.addEventListener("click", async () => {
      if (this.location.state === "running") {
        this.location.stop();
        btnRun.classList.remove("running");
        label.textContent = "DÉMARRER";
        btnGpx.disabled = this.location.track.length === 0;
        this._banner("Course terminée — export GPX dispo");
      } else {
        document.getElementById("boot").classList.add("hidden");
        this.follow = true;
        await this.location.start();
        btnRun.classList.add("running");
        label.textContent = "STOP";
        this._banner(
          this.location.source === "simulateur"
            ? "GPS indisponible → mode simulation"
            : "C'est parti ! Cours pour conquérir"
        );
      }
    });

    btnGpx.addEventListener("click", async () => {
      if (this.location.track.length === 0) return;
      const res = await this.location.exportGpx();
      this._banner(res.native ? "GPX enregistré dans Documents" : "GPX téléchargé");
    });

    document.getElementById("btnRecenter").addEventListener("click", () => {
      this.follow = true;
      if (this.player.has) this.map.easeTo({ center: [this.player.lng, this.player.lat], duration: 500 });
    });
  }

  _banner(msg) {
    const el = document.getElementById("banner");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => el.classList.remove("show"), 1800);
  }

  _flash() {
    const el = document.getElementById("flash");
    el.classList.remove("on");
    void el.offsetWidth; // reflow → rejoue l'anim
    el.classList.add("on");
  }
}

/* met à l'échelle une liste de points [x,y,...] autour d'un centre */
function scalePoly(pts, cx, cy, s) {
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = cx + (pts[i] - cx) * s;
    out[i + 1] = cy + (pts[i + 1] - cy) * s;
  }
  return out;
}
