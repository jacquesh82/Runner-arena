/* ======================================================================
 * REPLAY SERVICE — Cinématique de fin de course « Prise de territoire »
 * ----------------------------------------------------------------------
 * Rejoue un trajet GPX sur la VRAIE carte (MapLibre, fond sombre lisible)
 * en faisant surgir des hexagones 3D le long du parcours : conquête en
 * cascade, vols de zones à l'équipe rivale, halos additifs + particules,
 * caméra cinématique qui survole le tracé réel.
 *
 * Couche WebGL2 « custom » MapLibre : les hexagones sont placés en
 * coordonnées mercator (matrice fournie par la carte) et extrudés en
 * mètres → vrai relief incliné, calé au sol de la carte.
 * ====================================================================== */

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildGrid, mPerDegLng } from "../hexgrid.js";

const M_PER_DEG_LAT = 111320;
const CYAN = [0.16, 0.91, 1.0];
const MAG = [1.0, 0.18, 0.53];
const BOARD = [0.10, 0.13, 0.22];

const CFG = {
  hexSize: 46,        // rayon hexagone (m)
  corridor: 135,      // largeur du champ d'hexagones autour du trajet (m)
  rivalRadius: 175,   // rayon du bastion rival (m)
  T: 13.0,            // durée cinématique (s)
  cap0: 2.0, cap1: 10.6, // fenêtre de conquête
  heightOwned: 2.5, heightBoard: 1.5,   // quasi-plates, comme des tuiles
  alphaOwned: 0.52, alphaBoard: 0.26,   // translucides : la carte transparaît
};

const TTL_DAYS = 15;                    // durée de possession max avant remise en jeu
const PLAYERS = {
  me:    { id: "me",    name: "Toi", color: "#28e8ff" },
  rival: { id: "rival", name: "Nyx", color: "#ff2e86" },
};
const DAY = 86400000;

// Points d'intérêt du secteur (démo). Extensible à OSM/Overpass : remplacer
// cette liste par fetchPOIs(bbox). Capturer la tuile d'un POI débloque son badge.
const POIS = [
  { name: "Parc Montsouris",        lat: 48.8225, lng: 2.3378, emoji: "🏞️" },
  { name: "Cité Universitaire",     lat: 48.8213, lng: 2.3382, emoji: "🎓" },
  { name: "Réservoir de Montsouris", lat: 48.8262, lng: 2.3372, emoji: "💧" },
  { name: "Square de Montsouris",   lat: 48.8235, lng: 2.3405, emoji: "🌳" },
  { name: "Cité Florale",           lat: 48.8250, lng: 2.3430, emoji: "🌸" },
  { name: "Place Denfert-Rochereau", lat: 48.8339, lng: 2.3324, emoji: "🦁" },
  { name: "Prison de la Santé",     lat: 48.8347, lng: 2.3417, emoji: "🏛️" },
  { name: "Stade Charléty",         lat: 48.8192, lng: 2.3459, emoji: "🏟️" },
];

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };

/* --------------------------- GPX --------------------------- */
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const pts = [...doc.getElementsByTagName("trkpt")].map(p => ({
    lat: parseFloat(p.getAttribute("lat")),
    lng: parseFloat(p.getAttribute("lon")),
    ele: parseFloat(p.getElementsByTagName("ele")[0]?.textContent || "0"),
  })).filter(p => isFinite(p.lat) && isFinite(p.lng));
  const time = doc.querySelector("metadata > time, trk > time")?.textContent || null;
  pts.meta = { time };   // date de la course, si présente
  return pts;
}

/* ====================================================================== */
export class ReplayService {
  constructor(track, { container = "map", map = "light", mode = "passes" } = {}) {
    this.track = track;
    this.container = container;
    this.mapKind = map;
    // Mode de carte = critère d'arbitrage des zones disputées.
    const NORM = { speed: "blitz", passes: "endurance", blitz: "blitz", endurance: "endurance", handicap: "handicap" };
    this.mapMode = NORM[mode] || "endurance";
    this.tileRec = new Map();      // "q,r" -> enregistrement tuile (propriété, ID…)
    this.sel = null;               // tuile sélectionnée
    this.start = 0;
    this.gl = null;
    this.ready = false;
    this._kf = [];
  }

  async init() {
    // --- géométrie du trajet ---
    let mnLa=90,mxLa=-90,mnLn=180,mxLn=-180;
    for (const p of this.track){ if(p.lat<mnLa)mnLa=p.lat;if(p.lat>mxLa)mxLa=p.lat;if(p.lng<mnLn)mnLn=p.lng;if(p.lng>mxLn)mxLn=p.lng; }
    this.bounds = [[mnLn,mnLa],[mxLn,mxLa]];
    this.center = [(mnLn+mxLn)/2, (mnLa+mxLa)/2]; // [lng,lat]
    const clat = this.center[1];
    this.mLng = mPerDegLng(clat);

    // --- carte sombre lisible ---
    this.map = new maplibregl.Map({
      container: this.container,
      style: this._baseStyle(),
      center: this.center,
      zoom: 15,
      pitch: 42, bearing: -22,
      dragRotate: true, attributionControl: { compact: true },
      preserveDrawingBuffer: true,   // permet la capture PNG (partage)
    });

    this.map.on("error", (e) => console.warn("[replay] map:", e && (e.error?.message || e.error)));
    if (!this.map.loaded()) await new Promise((res) => { let d=false; const go=()=>{ if(!d){d=true;res();} }; this.map.once("load", go); setTimeout(go, 4000); });
    this.map.fitBounds(this.bounds, { padding: 70, pitch: 42, bearing: -22, animate: false });
    this._buildWorld();
    this._injectHud();
    this.map.addLayer(this._hexLayer());
    this.fitZoom = this.map.getZoom();

    // clic sur une tuile → fiche de propriété
    this.map.on("click", (e) => {
      const t = this.grid.tileAt(e.lngLat.lat, e.lngLat.lng);
      this._selectTile(t ? this.tileRec.get(t.q+","+t.r) : null);
    });
    this.map.getCanvas().style.cursor = "crosshair";

    this._initAudio();
    this.replay();
    return this;
  }

  _baseStyle() {
    const PACKS = {
      light:   { slug: "light_all",  bg: "#e9ecf1", paint: { "raster-saturation": -0.15 } },
      dark:    { slug: "dark_all",   bg: "#04060c", paint: { "raster-brightness-max": 0.9, "raster-contrast": 0.05 } },
      voyager: { slug: "rastertiles/voyager", bg: "#0a1020", paint: { "raster-saturation": -0.1 } },
    };
    const p = PACKS[this.mapKind] || PACKS.light;
    return {
      version: 8,
      sources: {
        base: {
          type: "raster",
          tiles: ["a", "b", "c"].map(s => `https://${s}.basemaps.cartocdn.com/${p.slug}/{z}/{x}/{y}.png`),
          tileSize: 256,
          attribution: "© OpenStreetMap © CARTO",
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": p.bg } },
        { id: "base", type: "raster", source: "base", paint: p.paint },
      ],
    };
  }

  /* ---- monde : grille + planning de capture ---- */
  _buildWorld() {
    const rnd = mulberry32(0x5eed42);
    // portée en anneaux pour couvrir toute la bbox + marge
    const extent = Math.max(
      (this.bounds[1][1]-this.bounds[0][1]) * M_PER_DEG_LAT,
      (this.bounds[1][0]-this.bounds[0][0]) * this.mLng
    );
    const range = Math.min(24, Math.ceil((extent/2 + 250) / (CFG.hexSize*1.4)));
    const grid = buildGrid([this.center[1], this.center[0]], CFG.hexSize, range);
    this.grid = grid;

    // échantillon du trajet (pour distances + planning)
    const sampled = this.track.filter((_, i) => i % 3 === 0);
    if (sampled[sampled.length-1] !== this.track[this.track.length-1]) sampled.push(this.track[this.track.length-1]);

    // bastion rival : à mi-parcours, décalé sur le côté
    const mid = this.track[Math.floor(this.track.length*0.62)];
    const before = this.track[Math.floor(this.track.length*0.60)];
    const bx = (mid.lng-before.lng)*this.mLng, by = (mid.lat-before.lat)*M_PER_DEG_LAT;
    const bl = Math.hypot(bx,by)||1;
    const rivalC = { // décalé perpendiculairement de ~120 m
      lng: mid.lng + (-by/bl*120)/this.mLng,
      lat: mid.lat + ( bx/bl*120)/M_PER_DEG_LAT,
    };
    this.rivalC = rivalC;

    // capture ordonnée le long du trajet — on RASTERISE le tracé :
    // échantillonnage fin entre chaque point GPX pour ne sauter aucune tuile
    const order = [];
    const seen = new Set();
    const passes = new Map();   // "q,r" -> nombre de fois où le tracé traverse la tuile
    let lastTile = null;
    const mark = (lat, lng) => {
      const t = grid.tileAt(lat, lng);
      if (!t) return;
      if (!seen.has(t)) { seen.add(t); order.push(t); }
      if (t !== lastTile) { const k = t.q+","+t.r; passes.set(k, (passes.get(k)||0)+1); lastTile = t; }
    };
    for (let i = 0; i < this.track.length - 1; i++) {
      const a = this.track[i], b = this.track[i+1];
      const dE = (b.lng-a.lng)*this.mLng, dN = (b.lat-a.lat)*M_PER_DEG_LAT;
      const steps = Math.max(1, Math.ceil(Math.hypot(dE,dN) / (CFG.hexSize*0.35)));
      for (let s = 0; s < steps; s++) { const f = s/steps; mark(a.lat+(b.lat-a.lat)*f, a.lng+(b.lng-a.lng)*f); }
    }
    const last = this.track[this.track.length-1]; mark(last.lat, last.lng);

    // --- identité serveur + dates de possession (démo) ---
    this.instanceId = "srv-" + Math.abs(Math.round(this.center[0]*1e4) ^ Math.round(this.center[1]*1e4)).toString(36);
    const runTime = this.track.meta?.time ? new Date(this.track.meta.time).getTime() : Date.parse("2026-07-03T22:00:00Z");
    this.runDate = runTime;
    const rivalDate = runTime - 4 * DAY;   // le rival tenait ces zones avant la course
    let uid = 0;

    const meta = [];       // tuiles à rendre
    const parts = [];      // particules (interleave 12 floats)
    const merc = maplibregl.MercatorCoordinate;
    const ref = merc.fromLngLat(this.center);
    this.uMeter = ref.meterInMercatorCoordinateUnits();

    const distToRoute = (t) => {
      let best = 1e9;
      for (const s of sampled) {
        const dx=(t.lng-s.lng)*this.mLng, dy=(t.lat-s.lat)*M_PER_DEG_LAT;
        const d=dx*dx+dy*dy; if(d<best)best=d;
      }
      return Math.sqrt(best);
    };
    const distRival = (t) => {
      const dx=(t.lng-rivalC.lng)*this.mLng, dy=(t.lat-rivalC.lat)*M_PER_DEG_LAT;
      return Math.hypot(dx,dy);
    };

    // marquer rival (bastion) et joueur (trajet)
    const capIndex = new Map();
    order.forEach((t,i)=>capIndex.set(t, i/Math.max(1,order.length-1)));

    // --- ENCERCLEMENT : les tuiles enfermées par la boucle du parcours sont conquises.
    // On inonde depuis le bord de la grille à travers les tuiles NON parcourues ; ce qui
    // reste inatteignable (ni parcours, ni extérieur) est l'intérieur de la boucle.
    const NB = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];
    const inGrid = (q,r) => Math.abs(q)<=range && Math.abs(r)<=range && Math.abs(-q-r)<=range;
    const routeSet = new Set(order.map(t => t.q+","+t.r));
    const exterior = new Set(), stack = [];
    for (const t of grid.tiles.values()) {
      const onBorder = Math.abs(t.q)===range || Math.abs(t.r)===range || Math.abs(-t.q-t.r)===range;
      const k = t.q+","+t.r;
      if (onBorder && !routeSet.has(k) && !exterior.has(k)) { exterior.add(k); stack.push(t); }
    }
    while (stack.length) {
      const t = stack.pop();
      for (const [dq,dr] of NB) {
        const nq=t.q+dq, nr=t.r+dr, nk=nq+","+nr;
        if (!inGrid(nq,nr) || routeSet.has(nk) || exterior.has(nk)) continue;
        exterior.add(nk); stack.push({ q:nq, r:nr });
      }
    }
    const interior = new Set();
    for (const t of grid.tiles.values()) { const k = t.q+","+t.r; if (!routeSet.has(k) && !exterior.has(k)) interior.add(k); }
    // profondeur depuis le périmètre → remplissage progressif vers le centre
    const interiorDepth = new Map(); let bfs = [];
    for (const k of interior) {
      const [iq,ir] = k.split(",").map(Number);
      if (NB.some(([dq,dr]) => routeSet.has((iq+dq)+","+(ir+dr)))) { interiorDepth.set(k,0); bfs.push(k); }
    }
    for (let i=0; i<bfs.length; i++) {
      const k = bfs[i], d = interiorDepth.get(k), [iq,ir] = k.split(",").map(Number);
      for (const [dq,dr] of NB) { const nk=(iq+dq)+","+(ir+dr); if (interior.has(nk) && !interiorDepth.has(nk)) { interiorDepth.set(nk,d+1); bfs.push(nk); } }
    }
    this._encircled = interior.size;

    for (const t of grid.tiles.values()) {
      const dR = distRival(t);
      const isRival = dR < CFG.rivalRadius;
      const onRoute = capIndex.has(t);
      const isInterior = interior.has(t.q+","+t.r) && !isRival;
      const near = onRoute || isRival || isInterior || distToRoute(t) < CFG.corridor;
      if (!near) continue;

      const seed = rnd();
      const key = t.q+","+t.r;
      const mc = merc.fromLngLat([t.lng, t.lat]);
      const myPasses = passes.get(key) || 0;
      const mySpeed = 3.0 + seed * 1.4;            // m/s (démo, faute de temps/point dans le GPX)
      const rec = {
        id: this.instanceId + ":" + (uid++).toString(36).padStart(3, "0"),
        key, q: t.q, r: t.r,
        cx: mc.x, cy: mc.y, seed,
        appear: 1e9, flip: 1e9,
        colBoard: BOARD, colA: BOARD, colB: BOARD,
        height: CFG.heightBoard, owned: 0,
        _lng: t.lng, _lat: t.lat,
        owner: null, acquiredAt: null, contenders: null, mode: this.mapMode,
      };

      if (onRoute && isRival) {          // ZONE DISPUTÉE : rival puis arrachée par le joueur
        rec.owned = 1; rec.colA = MAG; rec.colB = CYAN;
        rec.height = CFG.heightOwned;
        rec.appear = 0.1 + dR*0.004;
        rec.flip = Math.max(CFG.cap0 + (CFG.cap1-CFG.cap0)*capIndex.get(t), rec.appear+0.4);
        rec.stolen = true; rec.evt = rec.flip;
        rec.contenders = [
          { player: "me", passes: Math.max(1, myPasses), speed: mySpeed },
          { player: "rival", passes: 1, speed: 2.9 + seed * 0.5 },
        ];
        rec.owner = this._resolve(rec.contenders);
        rec.acquiredAt = runTime;
      } else if (onRoute) {              // conquête joueur
        rec.owned = 1; rec.colA = CYAN; rec.colB = CYAN;
        rec.height = CFG.heightOwned;
        rec.appear = CFG.cap0 + (CFG.cap1-CFG.cap0)*capIndex.get(t);
        rec.evt = rec.appear;
        rec.owner = "me"; rec.acquiredAt = runTime; rec.passes = Math.max(1, myPasses); rec.speed = mySpeed;
      } else if (isRival) {             // bastion rival
        rec.owned = 1; rec.colA = MAG; rec.colB = MAG;
        rec.height = CFG.heightOwned;
        rec.appear = 0.1 + dR*0.004;
        rec.evt = rec.appear;
        rec.owner = "rival"; rec.acquiredAt = rivalDate; rec.passes = 1; rec.speed = 3.0 + seed * 0.4;
      } else if (isInterior) {          // ENCERCLEMENT : intérieur de la boucle conquis
        rec.owned = 1; rec.colA = CYAN; rec.colB = CYAN;
        rec.height = CFG.heightOwned;
        const d = interiorDepth.get(t.q+","+t.r) || 0;
        rec.appear = Math.min(CFG.T - 0.4, CFG.cap1 - 0.2 + d * 0.1);  // remplissage vers le centre
        rec.evt = rec.appear; rec.interior = true;
        rec.owner = "me"; rec.acquiredAt = runTime; rec.passes = 0; rec.speed = 0;
      }
      // si la couleur finale d'une zone disputée revient au rival, on la laisse magenta
      if (rec.stolen && rec.owner === "rival") rec.colB = MAG;
      meta.push(rec);
      this.tileRec.set(key, rec);

      // particules à l'évènement
      if (rec.owned) {
        const team = rec.stolen ? CYAN : rec.colA;
        const n = rec.stolen ? 58 : (isRival ? 14 : 32);
        for (let i=0;i<n;i++){
          const a=rnd()*Math.PI*2, el=0.35+rnd()*0.9, sp=(16+rnd()*30);
          const up = (26+rnd()*30)*Math.sin(el+0.4);          // gerbe plus verticale
          parts.push(
            mc.x, mc.y, rec.height*0.6*this.uMeter,
            Math.cos(a)*Math.cos(el)*sp, Math.sin(a)*Math.cos(el)*sp, up,
            rec.evt, 0.7+rnd()*0.85, 8+rnd()*11,
            (rnd()<0.28?1:team[0]), (rnd()<0.28?1:team[1]), (rnd()<0.28?1:team[2])
          );
        }
      }
    }

    this.meta = meta;
    this.instData = this._packHex(meta);
    this.partData = new Float32Array(parts);
    this.partCount = parts.length/12;
    // rayon dessiné = rayon de la trame → pavage parfait (hexagones jointifs)
    this.uRadius = CFG.hexSize*this.uMeter;

    // stats pour HUD
    this._pFinal = meta.filter(m=>m.owned && (m.stolen || m.colA===CYAN)).length;
    this._rInit = meta.filter(m=>m.owned && m.colA===MAG).length;

    this.stats = this._computeStats(runTime);
    this._computeBadges();
  }

  // Collection : badges de lieux (POI capturés) + badge de quartier.
  _computeBadges() {
    this._poiByTile = new Map();
    this.badges = POIS.map((p) => {
      const t = this.grid.tileAt(p.lat, p.lng);
      const rec = t ? this.tileRec.get(t.q + "," + t.r) : null;
      const earned = !!(rec && rec.owned && rec.owner === "me");
      const b = { ...p, kind: "poi", earned, tileKey: rec ? rec.key : null };
      if (rec && earned) this._poiByTile.set(rec.key, b);
      return b;
    });
    // badge de quartier : ≥ 55 % du territoire affiché est à moi
    const owned = this.meta.filter((m) => m.owned).length;
    const mine = this.meta.filter((m) => m.owned && m.owner === "me").length;
    this.badges.push({ name: "Quartier Montsouris", emoji: "🏙️", kind: "district", earned: owned > 0 && mine / owned >= 0.55 });
    this._badgesToasted = new Set();
  }

  _toast(b) {
    const el = this.toastEl; if (!el) return;
    el.innerHTML = `<span class="em">${b.emoji}</span><span><small>Lieu découvert</small>${b.name}</span>`;
    el.classList.add("show");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // Bilan de course : données techniques (issues du GPX) + prise/perte de territoire.
  _computeStats(runTime) {
    // --- course (GPX) ---
    let dist = 0, gain = 0, loss = 0, eMin = Infinity, eMax = -Infinity;
    for (let i = 0; i < this.track.length; i++) {
      const p = this.track[i];
      if (p.ele < eMin) eMin = p.ele;
      if (p.ele > eMax) eMax = p.ele;
      if (i > 0) {
        dist += haversine(this.track[i-1], this.track[i]);
        const de = p.ele - this.track[i-1].ele;
        if (de > 0) gain += de; else loss -= de;
      }
    }
    const km = dist / 1000;
    // Pas d'horodatage par point dans ce GPX → durée/allure estimées (démo).
    const paceMin = 5.4;                     // min/km (hypothèse démo)
    const durationS = km * paceMin * 60;
    const speedKmh = 60 / paceMin;
    const kcal = Math.round(km * 68);

    // --- territoire (état final) ---
    let mine = 0, neuf = 0, vol = 0, rival = 0;
    for (const m of this.meta) {
      if (!m.owned) continue;
      if (m.stolen) { if (m.owner === "me") { mine++; vol++; } else rival++; }
      else if (m.owner === "me") { mine++; neuf++; }
      else if (m.owner === "rival") rival++;
    }
    const hexAreaKm2 = (3 * Math.sqrt(3) / 2) * (CFG.hexSize ** 2) / 1e6;
    const surfaceKm2 = mine * hexAreaKm2;
    const score = mine * 10 + vol * 15;

    return {
      km, durationS, paceMin, speedKmh, kcal,
      gain: Math.round(gain), loss: Math.round(loss),
      eMin: Math.round(eMin), eMax: Math.round(eMax),
      points: this.track.length,
      mine, neuf, vol, rival, surfaceKm2, score, runTime,
      estimated: !this.track.meta?.time || true,   // métriques temps estimées (démo)
    };
  }

  _packHex(meta) {
    const S=16, a=new Float32Array(meta.length*S);
    meta.forEach((m,i)=>{ const o=i*S;
      a[o]=m.cx; a[o+1]=m.cy; a[o+2]=m.appear; a[o+3]=m.flip;
      a[o+4]=m.colBoard[0];a[o+5]=m.colBoard[1];a[o+6]=m.colBoard[2];
      a[o+7]=m.colA[0];a[o+8]=m.colA[1];a[o+9]=m.colA[2];
      a[o+10]=m.colB[0];a[o+11]=m.colB[1];a[o+12]=m.colB[2];
      a[o+13]=m.height; a[o+14]=m.owned; a[o+15]=m.seed;
    });
    return a;
  }

  /* ---------------- couche WebGL custom ---------------- */
  _hexLayer() {
    const self = this;
    return {
      id: "hex3d", type: "custom", renderingMode: "3d",
      onAdd(map, gl) {
        if (!(gl instanceof WebGL2RenderingContext)) { console.error("[replay] WebGL2 requis"); return; }
        self.gl = gl;
        self._initGL(gl);
      },
      render(gl, matrix) {
        if (!self.gl) return;
        const m = Array.isArray(matrix) || matrix instanceof Float32Array
          ? matrix : (matrix?.defaultProjectionData?.mainMatrix || matrix?.mainMatrix);
        self._render(gl, m);
        self.map.triggerRepaint();     // auto-anime
      },
    };
  }

  _sh(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
  _prog(gl,vs,fs){const p=gl.createProgram();gl.attachShader(p,this._sh(gl,gl.VERTEX_SHADER,vs));
    gl.attachShader(p,this._sh(gl,gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}

  _initGL(gl) {
    const H="#version 300 es\nprecision highp float;\n";
    // --- hex prism (sol = x,y ; haut = z) ---
    const HV=H+`
    layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNormal;
    layout(location=2) in vec2 iCenter; layout(location=3) in float iAppear;
    layout(location=4) in float iFlip;  layout(location=5) in vec3 iColBoard;
    layout(location=6) in vec3 iColA;   layout(location=7) in vec3 iColB;
    layout(location=8) in float iHeight;layout(location=9) in float iOwned;
    layout(location=10) in float iSeed;
    uniform mat4 uMatrix; uniform float uTime,uMeter,uRadius,uBoardM;
    out vec3 vN,vCol; out float vOwned,vEmit,vTop; out vec2 vCenter;
    float back(float t){float c1=1.9,c3=c1+1.0;float x=t-1.0;return 1.0+c3*x*x*x+c1*x*x;}
    void main(){
      float ap=clamp((uTime-iAppear)/0.55,0.0,1.0);
      float prog= ap<1.0? clamp(back(ap),0.0,1.2):1.0;
      float hM=mix(uBoardM,iHeight,prog);
      vec2 g=aPos.xy*uRadius + iCenter;
      float z=aPos.z*hM*uMeter;
      vec3 grown=(uTime<iFlip)?iColA:iColB;
      float pulse=0.5+0.5*sin(uTime*2.1+iSeed*6.28);
      vCol=mix(iColBoard,grown,clamp(prog,0.0,1.0));
      float fA=(uTime>=iAppear&&iOwned>0.5)?exp(-(uTime-iAppear)/0.35):0.0;
      float fF=(uTime>=iFlip)?exp(-(uTime-iFlip)/0.30):0.0;
      vEmit=iOwned*(0.45+pulse*0.30)+max(fA*1.3,fF*2.5);
      vTop=step(0.6,aNormal.z); vOwned=iOwned; vN=aNormal; vCenter=iCenter;
      gl_Position=uMatrix*vec4(g,z,1.0);
    }`;
    const HF=H+`
    in vec3 vN,vCol; in float vOwned,vEmit,vTop; in vec2 vCenter;
    uniform float uAlphaOwned,uAlphaBoard,uHasSel,uSelEps; uniform vec2 uSel; out vec4 frag;
    void main(){
      vec3 N=normalize(vN); vec3 L=normalize(vec3(0.35,-0.25,0.9));
      float dif=max(dot(N,L),0.0); float rim=pow(1.0-abs(N.z),2.0);
      vec3 col=vCol*(0.30+0.55*dif);        // corps translucide
      col+=vCol*rim*(0.5+vOwned*1.1);        // arête lumineuse
      col+=vCol*vEmit*0.85;                   // émission
      col+=vec3(1.0)*vTop*0.10*vOwned;        // reflet du dessus
      float a=mix(uAlphaBoard,uAlphaOwned,vOwned);
      a=min(1.0, a + rim*0.25*vOwned);        // arêtes un peu plus denses
      if(uHasSel>0.5 && distance(vCenter,uSel)<uSelEps){ col+=vec3(0.45); a=min(1.0,a+0.32); } // tuile sélectionnée
      frag=vec4(col,a);
    }`;
    this.hexP=this._prog(gl,HV,HF);
    this.hU={};["uMatrix","uTime","uMeter","uRadius","uBoardM","uAlphaOwned","uAlphaBoard","uHasSel","uSelEps","uSel"].forEach(n=>this.hU[n]=gl.getUniformLocation(this.hexP,n));

    // --- FX de capture : onde de choc hexagonale (réutilise le VAO des hexagones) ---
    const FV=H+`
    layout(location=0) in vec3 aPos;
    layout(location=2) in vec2 iCenter; layout(location=3) in float iAppear;
    layout(location=4) in float iFlip;  layout(location=6) in vec3 iColA;
    layout(location=7) in vec3 iColB;   layout(location=9) in float iOwned;
    uniform mat4 uMatrix; uniform float uTime,uMeter,uRadius,uMode;
    out float vR,vA,vStolen,vTop; out vec3 vCol;
    void main(){
      // FX RÉSERVÉ AUX VOLS : contact entre 2 couleurs (une tuile déjà possédée qui bascule).
      // iFlip < 1e8 ⇒ la tuile change de camp ; les captures de zones neutres n'en déclenchent pas.
      float DUR = uMode>0.5 ? 0.55 : 0.8;
      float age = uTime - iFlip;
      if(iOwned<0.5 || iFlip>=1e8 || age<0.0 || age>DUR){ gl_Position=vec4(2.0,2.0,2.0,1.0); vA=0.0; return; }
      float k = age/DUR;
      vStolen = iFlip < 1e8 ? 1.0 : 0.0;
      vCol = uTime < iFlip ? iColA : iColB;
      vA = 1.0-k; vTop = aPos.z;
      if(uMode>0.5){                               // PILIER de lumière vertical
        vec2 g = aPos.xy*uRadius*(0.34 - k*0.12) + iCenter;
        float z = aPos.z * (150.0*uMeter) * (1.0 - k*0.25);
        gl_Position = uMatrix*vec4(g, z, 1.0);
        vR = aPos.z;
      } else {                                     // ANNEAU au sol qui s'étend
        vec2 g = aPos.xy*uRadius*(1.0 + k*2.1) + iCenter;
        gl_Position = uMatrix*vec4(g, 0.06*uMeter, 1.0);
        vR = length(aPos.xy);
      }
    }`;
    const FF=H+`
    in float vR,vA,vStolen,vTop; in vec3 vCol; uniform float uMode; out vec4 frag;
    void main(){
      if(uMode>0.5){                               // pilier : brillant en bas, s'estompe en haut
        float grad = 1.0 - vTop;
        float a = vA*vA*grad*0.85;
        vec3 c = mix(vCol, vec3(1.0), 0.35+vStolen*0.3) * (1.6+grad*1.5);
        frag = vec4(c, a);
      } else {                                     // anneau : pourtour lumineux
        float ring = smoothstep(0.45,1.0,vR);
        float a = vA*vA*(0.2 + ring*1.4);
        vec3 c = vCol*(1.6+ring*2.2) + vec3(1.0)*ring*(0.35+vStolen*0.5);
        frag = vec4(c, a);
      }
    }`;
    this.fxP=this._prog(gl,FV,FF);
    this.fU={};["uMatrix","uTime","uMeter","uRadius","uMode"].forEach(n=>this.fU[n]=gl.getUniformLocation(this.fxP,n));

    // --- particules (POINTS) ---
    const PV=H+`
    layout(location=0) in vec3 iOrigin; layout(location=1) in vec3 iVel;
    layout(location=2) in float iStart; layout(location=3) in float iLife;
    layout(location=4) in float iSize;  layout(location=5) in vec3 iColor;
    uniform mat4 uMatrix; uniform float uTime,uMeter;
    out vec3 vColor; out float vA;
    void main(){
      float tl=uTime-iStart;
      if(tl<0.0||tl>iLife){gl_Position=vec4(2.0,2.0,2.0,1.0);gl_PointSize=0.0;vA=0.0;return;}
      float k=tl/iLife; vA=1.0-k; vColor=iColor;
      vec3 disp=(iVel*tl+vec3(0.0,0.0,-16.0)*tl*tl)*uMeter;
      vec4 cp=uMatrix*vec4(iOrigin+disp,1.0);
      gl_Position=cp;
      gl_PointSize=clamp(iSize*(0.35+0.65*vA)/max(cp.w,1e-4)*0.5,1.0,26.0);
    }`;
    const PF=H+`
    in vec3 vColor; in float vA; out vec4 frag;
    void main(){ vec2 d=gl_PointCoord-0.5; float g=smoothstep(0.5,0.0,length(d));
      frag=vec4(vColor*g*vA*1.7, g*vA); }`;
    this.partP=this._prog(gl,PV,PF);
    this.pU={};["uMatrix","uTime","uMeter"].forEach(n=>this.pU[n]=gl.getUniformLocation(this.partP,n));

    // --- base hex mesh (pointy-top, pour paver la trame axiale de hexgrid.js) ---
    const pos=[],ang=i=>Math.PI/180*(60*i-30);
    const cx=i=>Math.cos(ang(i)),cy=i=>Math.sin(ang(i));
    const push=(x,y,z,nx,ny,nz)=>pos.push(x,y,z,nx,ny,nz);
    for(let i=0;i<6;i++){const j=(i+1)%6; push(0,0,1,0,0,1);push(cx(i),cy(i),1,0,0,1);push(cx(j),cy(j),1,0,0,1);}
    for(let i=0;i<6;i++){const j=(i+1)%6;const na=ang(i)+Math.PI/6;const nx=Math.cos(na),ny=Math.sin(na);
      const ax=cx(i),ay=cy(i),bx=cx(j),by=cy(j);
      push(ax,ay,0,nx,ny,0);push(ax,ay,1,nx,ny,0);push(bx,by,1,nx,ny,0);
      push(ax,ay,0,nx,ny,0);push(bx,by,1,nx,ny,0);push(bx,by,0,nx,ny,0);}
    this.hexVertCount=pos.length/6;

    const buf=(data)=>{const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return b;};
    const F=4;

    // hex VAO
    this.hexVAO=gl.createVertexArray();gl.bindVertexArray(this.hexVAO);
    buf(new Float32Array(pos));
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,6*F,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,6*F,3*F);
    this.instBuf = buf(this.instData);
    const hl=[[2,2],[3,1],[4,1],[5,3],[6,3],[7,3],[8,1],[9,1],[10,1]];
    let off=0;for(const[loc,sz]of hl){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,sz,gl.FLOAT,false,16*F,off*F);gl.vertexAttribDivisor(loc,1);off+=sz;}
    gl.bindVertexArray(null);

    // particle VAO
    this.partVAO=gl.createVertexArray();gl.bindVertexArray(this.partVAO);
    buf(this.partData);
    const pl=[[0,3],[1,3],[2,1],[3,1],[4,1],[5,3]];
    let po=0;for(const[loc,sz]of pl){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,sz,gl.FLOAT,false,12*F,po*F);po+=sz;}
    gl.bindVertexArray(null);

    this.ready=true;
  }

  _render(gl, matrix) {
    if (!this.ready || !matrix) return;
    const t = Math.min((performance.now()-this.start)/1000, CFG.T);
    this._camera(t);
    this._hud(t);
    this._hexoUpdate(t);

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);

    // --- hexagones translucides (passe unique, alpha over map) ---
    gl.useProgram(this.hexP); gl.bindVertexArray(this.hexVAO);
    gl.uniformMatrix4fv(this.hU.uMatrix,false,matrix);
    gl.uniform1f(this.hU.uTime,t); gl.uniform1f(this.hU.uMeter,this.uMeter);
    gl.uniform1f(this.hU.uRadius,this.uRadius); gl.uniform1f(this.hU.uBoardM,CFG.heightBoard);
    gl.uniform1f(this.hU.uAlphaOwned,CFG.alphaOwned); gl.uniform1f(this.hU.uAlphaBoard,CFG.alphaBoard);
    gl.uniform1f(this.hU.uHasSel,this.sel?1:0); gl.uniform1f(this.hU.uSelEps,this.uRadius*0.6);
    gl.uniform2f(this.hU.uSel,this.sel?this.sel.cx:0,this.sel?this.sel.cy:0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);
    gl.drawArraysInstanced(gl.TRIANGLES,0,this.hexVertCount,this.meta.length);

    // --- FX de conquête (uniquement sur les VOLS) : anneau au sol + pilier vertical ---
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE); gl.depthMask(false);
    gl.useProgram(this.fxP);
    gl.uniformMatrix4fv(this.fU.uMatrix,false,matrix);
    gl.uniform1f(this.fU.uTime,t); gl.uniform1f(this.fU.uMeter,this.uMeter); gl.uniform1f(this.fU.uRadius,this.uRadius);
    gl.uniform1f(this.fU.uMode,0.0); gl.drawArraysInstanced(gl.TRIANGLES,0,this.hexVertCount,this.meta.length); // anneau
    gl.uniform1f(this.fU.uMode,1.0); gl.drawArraysInstanced(gl.TRIANGLES,0,this.hexVertCount,this.meta.length); // pilier

    // --- particules (additif, pas d'écriture depth) ---
    gl.useProgram(this.partP); gl.bindVertexArray(this.partVAO);
    gl.uniformMatrix4fv(this.pU.uMatrix,false,matrix);
    gl.uniform1f(this.pU.uTime,t); gl.uniform1f(this.pU.uMeter,this.uMeter);
    gl.drawArrays(gl.POINTS,0,this.partCount);

    gl.bindVertexArray(null); gl.depthMask(true); gl.disable(gl.BLEND);
  }

  /* ---------------- caméra cinématique ---------------- */
  _pathAt(f){ f=clamp01(f); const i=f*(this.track.length-1);
    const a=this.track[Math.floor(i)], b=this.track[Math.min(this.track.length-1,Math.floor(i)+1)];
    const k=i-Math.floor(i); return [a.lng+(b.lng-a.lng)*k, a.lat+(b.lat-a.lat)*k]; }
  _bearingAt(f){ const a=this._pathAt(f), b=this._pathAt(Math.min(1,f+0.03));
    const e=(b[0]-a[0])*this.mLng, n=(b[1]-a[1])*M_PER_DEG_LAT; return Math.atan2(e,n)*180/Math.PI; }

  _camera(t) {
    for (const k of this._kf) {
      if (!k.done && t >= k.t) { k.done = true; k.fn(); }
    }
  }

  replay() {
    this.start = performance.now();
    this._pStat = this._rStat = -1;
    this.map.jumpTo({ ...this._boundsView(-22, 40, -0.15) });
    const ease = (o) => this.map.easeTo({ ...o, essential: true });
    this._kf = [
      { t: 0.05, fn: () => ease({ ...this._boundsView(8, 46, -0.35), duration: 2100 }) },
      { t: CFG.cap0, fn: () => { const f=(CFG.cap0)/CFG.cap1; ease({ center:this._pathAt(0.12), zoom:16.1, pitch:63, bearing:this._bearingAt(0.12)-18, duration:2600 }); } },
      { t: 5.2, fn: () => ease({ center:this._pathAt(0.45), zoom:16.0, pitch:64, bearing:this._bearingAt(0.45)+22, duration:2800 }) },
      { t: 8.0, fn: () => ease({ center:this._pathAt(0.78), zoom:16.2, pitch:60, bearing:this._bearingAt(0.78)-14, duration:2600 }) },
      { t: CFG.cap1, fn: () => ease({ ...this._boundsView(-40, 48, -0.55), duration:2400 }) },
    ];
    this._kf.forEach(k => k.done = false);
    if (this.hudEl) this._resetHud();
    // reset mascottes + bilan
    this._hxState = null; this._hxPrevT = 0; this._hxLastPop = 0; this._winMs = null;
    this._nyxState = null; this._recapShown = false; this._recapClosed = false;
    if (this.recapEl) this.recapEl.classList.remove("show");
    if (this.hexo) {
      this.hexo.bubble.classList.remove("show");
      this.hexo.root.querySelectorAll(".hexo-confetti").forEach(e => e.remove());
    }
    if (this.nyx) { this.nyx.inner.className = "nyx-inner guard"; this.nyx.bubble.classList.remove("show"); }
    if (this._badgesToasted) this._badgesToasted.clear();
    if (this.toastEl) this.toastEl.classList.remove("show");
    const stage = document.getElementById("stage"); if (stage) stage.classList.remove("shake");
  }

  _boundsView(bearing, pitch, zoomDelta=0) {
    const cam = this.map.cameraForBounds(this.bounds, { padding: 70, bearing, pitch });
    return { center: cam.center, zoom: cam.zoom + zoomDelta, bearing, pitch };
  }

  /* ---------------- Hexo, la mascotte ---------------- */
  _hexoUpdate(t) {
    const H = this.hexo;
    if (!H || !this.map) return;

    // état + position : idle → run (le long du tracé) → win → worry (tuile à risque)
    let f = 1, state;
    if (t < CFG.cap0) { f = 0; state = "idle"; }
    else if (t < CFG.cap1) { f = clamp01((t - CFG.cap0) / (CFG.cap1 - CFG.cap0)); state = "run"; }
    else {
      const since = this._winMs != null ? Date.now() - this._winMs : 0;
      if (since > 3000 && !this._recapShown) { this._recapShown = true; this._showRecap(); }
      state = this._recapClosed ? "worry" : "win";
    }

    const ll = state === "worry" ? [this._riskTile()._lng, this._riskTile()._lat] : this._pathAt(f);
    const pt = this.map.project(ll);
    H.root.style.transform = `translate(${pt.x}px,${pt.y}px)`;

    if (this._hxState !== state) {
      const prev = this._hxState;
      this._hxState = state;
      H.inner.className = "hexo-inner " + state;
      if (state === "run" && prev) this._hexoBubble("À l'assaut !", 1100);
      if (state === "win") {
        this._winMs = Date.now();
        this._hexoBubble("Territoire conquis !", 1800);
        this._hexoConfetti(); this._screenShake(); this._nyxDefeat(); this._sfxWin();
      }
      if (state === "worry") {
        const rt = this._riskTile();
        const remain = rt.acquiredAt + TTL_DAYS * DAY - Date.now();
        this._hexoBubble("Expire dans " + this._fmtRemaining(remain) + " — reviens courir !", 5200);
      }
    }

    // évènements de capture (phase run)
    const prevT = this._hxPrevT ?? t;
    if (state === "run") {
      let stole = false, took = 0;
      for (const m of this.meta) {
        if (!m.owned) continue;
        const evt = m.stolen ? m.flip : m.evt;
        if (m.stolen && m.flip > prevT && m.flip <= t) stole = true;
        else if (m.evt > prevT && m.evt <= t) took++;
        // découverte d'un lieu (POI) sur la tuile capturée
        if (evt > prevT && evt <= t && this._poiByTile?.has(m.key) && !this._badgesToasted.has(m.key)) {
          this._badgesToasted.add(m.key);
          this._toast(this._poiByTile.get(m.key));
        }
      }
      if (stole) {
        this._hexoBubble("Vol !", 750);
        H.inner.classList.add("steal");
        clearTimeout(this._hxStealT);
        this._hxStealT = setTimeout(() => H.inner.classList.remove("steal"), 450);
        this._nyxHit(); this._sfxSteal();
      } else if (took > 0 && (!this._hxLastPop || t - this._hxLastPop > 0.9)) {
        this._hexoBubble("+" + took, 600);
        this._hxLastPop = t; this._sfxCapture();
      }
    }
    this._hxPrevT = t;

    this._nyxUpdate();
  }

  _riskTile() {
    if (!this._risk) this._risk = this.meta.find(m => m.stolen) || this.meta.find(m => m.owner === "me") || this.meta.find(m => m.owned) || this.meta[0];
    return this._risk;
  }

  _screenShake() {
    const s = document.getElementById("stage") || this.map.getContainer();
    if (!s) return;
    s.classList.remove("shake"); void s.offsetWidth; s.classList.add("shake");
    setTimeout(() => s.classList.remove("shake"), 480);
  }

  /* ---- Nyx, le rival ---- */
  _nyxUpdate() {
    const N = this.nyx;
    if (!N || !this.map || !this.rivalC) return;
    const pt = this.map.project([this.rivalC.lng, this.rivalC.lat]);
    N.root.style.transform = `translate(${pt.x}px,${pt.y}px)`;
  }

  _nyxHit() {
    const N = this.nyx; if (!N || this._nyxState === "defeat") return;
    N.inner.className = "nyx-inner hit";
    this._nyxBubble(Math.random() < 0.5 ? "Hé !" : "Grr !", 600);
    clearTimeout(this._nyxT);
    this._nyxT = setTimeout(() => { if (this._nyxState !== "defeat") N.inner.className = "nyx-inner guard"; }, 520);
  }

  _nyxDefeat() {
    const N = this.nyx; if (!N) return;
    this._nyxState = "defeat";
    N.inner.className = "nyx-inner defeat";
    this._nyxBubble("Rhâ… mes tuiles !", 1700);
  }

  _nyxBubble(txt, ms) {
    const b = this.nyx?.bubble; if (!b) return;
    b.textContent = txt; b.classList.add("show");
    clearTimeout(this._nyxBubT);
    this._nyxBubT = setTimeout(() => b.classList.remove("show"), ms);
  }

  /* ---- Son (WebAudio synthétisé, aucun fichier externe) ---- */
  _initAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.actx = new AC();
      this.master = this.actx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.actx.destination);
    } catch (_) { this.actx = null; return; }
    // l'autoplay audio nécessite un geste : on relance le contexte au 1er clic/touche.
    const resume = () => { if (this.actx && this.actx.state === "suspended") this.actx.resume(); };
    window.addEventListener("pointerdown", resume, { passive: true });
    window.addEventListener("keydown", resume);
  }
  _tone(type, f0, f1, dur, vol, t0) {
    const a = this.actx, t = t0 ?? a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  _noise(dur, freq, q, vol, t0) {
    const a = this.actx, t = t0 ?? a.currentTime;
    const buf = a.createBuffer(1, Math.max(1, a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
    const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(bp).connect(g).connect(this.master); src.start(t);
  }
  _sfxSteal() {                 // VOL : impact grave + éclat de bruit + zap montant
    const a = this.actx; if (!a || a.state !== "running") return;
    const t = a.currentTime;
    this._noise(0.34, 1300, 0.7, 0.42, t);
    this._tone("sine", 190, 55, 0.3, 0.5, t);
    this._tone("sawtooth", 320, 1500, 0.16, 0.16, t);
  }
  _sfxCapture() {               // zone neutre : petit blip clair
    const a = this.actx; if (!a || a.state !== "running") return;
    this._tone("triangle", 680, 1020, 0.12, 0.12);
  }
  _sfxWin() {                   // victoire : arpège ascendant
    const a = this.actx; if (!a || a.state !== "running") return;
    const t0 = a.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this._tone("triangle", f, f, 0.42, 0.16, t0 + i * 0.11));
    this._noise(0.5, 5000, 0.5, 0.1, t0 + 0.02);
  }

  /* ---- Bilan de course (popup fin de cinématique) ---- */
  _showRecap() {
    const s = this.stats; if (!this.recapEl || !s) return;
    const mmss = (sec) => { const m = Math.floor(sec/60), ss = Math.round(sec%60); return m + " min " + String(ss).padStart(2,"0"); };
    const pace = (p) => { const m = Math.floor(p), ss = Math.round((p-m)*60); return m + ":" + String(ss).padStart(2,"0"); };
    const badges = this.badges || [];
    const earned = badges.filter((b) => b.earned).length;
    const badgesHtml = badges.map((b) => `<div class="rc-badge ${b.earned ? "earned" : ""}"><span class="be">${b.emoji}</span><span class="bn">${b.name}</span></div>`).join("");
    this.recapPanel.innerHTML = `
      <div class="rc-eyebrow">Runner Arena · Bilan de course</div>
      <h2>Course terminée</h2>
      <div class="rc-score"><span class="v">${s.score}</span><span class="l">points<br>de territoire</span></div>
      <div class="rc-sec">Données de course</div>
      <div class="rc-grid">
        <div class="rc-cell"><span class="k">Distance</span><span class="n">${s.km.toFixed(2)} <small>km</small></span></div>
        <div class="rc-cell"><span class="k">Durée</span><span class="n">${mmss(s.durationS)}</span></div>
        <div class="rc-cell"><span class="k">Allure</span><span class="n">${pace(s.paceMin)} <small>/km</small></span></div>
        <div class="rc-cell"><span class="k">Vitesse moy.</span><span class="n">${s.speedKmh.toFixed(1)} <small>km/h</small></span></div>
        <div class="rc-cell"><span class="k">Dénivelé +</span><span class="n">${s.gain} <small>m</small></span></div>
        <div class="rc-cell"><span class="k">Altitude</span><span class="n">${s.eMin}–${s.eMax} <small>m</small></span></div>
        <div class="rc-cell"><span class="k">Calories</span><span class="n">${s.kcal} <small>kcal</small></span></div>
        <div class="rc-cell"><span class="k">Points GPS</span><span class="n">${s.points}</span></div>
      </div>
      <div class="rc-sec">Territoire — prises & pertes</div>
      <div class="rc-terr">
        <div class="rc-row"><span class="k"><i style="background:#28e8ff"></i>Zones conquises</span><span class="v pos">+${s.mine}</span></div>
        <div class="rc-row sub"><span class="k">↳ nouvelles zones</span><span class="v">${s.neuf}</span></div>
        <div class="rc-row sub"><span class="k">↳ arrachées à Nyx</span><span class="v pos">${s.vol}</span></div>
        <div class="rc-row"><span class="k">Zones perdues</span><span class="v ${s.loss ? "neg" : ""}">0</span></div>
        <div class="rc-row"><span class="k"><i style="background:#ff2e86"></i>Bastion de Nyx restant</span><span class="v">${s.rival}</span></div>
        <div class="rc-row"><span class="k">Surface contrôlée</span><span class="v">${s.surfaceKm2.toFixed(2)} km²</span></div>
      </div>
      <div class="rc-sec">Collection · ${earned}/${badges.length} lieux découverts</div>
      <div class="rc-badges">${badgesHtml}</div>
      <div class="rc-note">⏳ Tes zones expirent dans <b>${this._fmtRemaining(s.runTime + TTL_DAYS*DAY - Date.now())}</b> — recours avant pour les garder.<br>Durée, allure et calories sont estimées (ce GPX n'a pas d'horodatage par point GPS).</div>
      <div class="rc-actions">
        <button id="rc-close">Carte</button>
        <button id="rc-replay">Revivre</button>
        <button class="primary" id="rc-share">📸 Partager</button>
      </div>`;
    this.recapEl.classList.add("show");
    this.recapPanel.querySelector("#rc-close").onclick = () => { this.recapEl.classList.remove("show"); this._recapClosed = true; };
    this.recapPanel.querySelector("#rc-replay").onclick = () => { this.recapEl.classList.remove("show"); this.replay(); };
    this.recapPanel.querySelector("#rc-share").onclick = () => this._sharePng();
  }

  // Partage : capture le canvas de la carte (map + hexagones) + bandeau score → PNG.
  async _sharePng() {
    try {
      const mapCanvas = this.map.getCanvas();
      const W = mapCanvas.width, H = mapCanvas.height;
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      ctx.drawImage(mapCanvas, 0, 0);
      const s = this.stats, bh = H * 0.14;
      const g = ctx.createLinearGradient(0, H - bh * 1.8, 0, H);
      g.addColorStop(0, "rgba(6,9,16,0)"); g.addColorStop(1, "rgba(6,9,16,0.92)");
      ctx.fillStyle = g; ctx.fillRect(0, H - bh * 1.8, W, bh * 1.8);
      ctx.fillStyle = "#8b97bd"; ctx.font = `700 ${Math.round(H * 0.026)}px Helvetica,Arial`;
      ctx.fillText("RUNNER ARENA · PRISE DE TERRITOIRE", W * 0.045, H - bh * 0.78);
      ctx.fillStyle = "#eafcff"; ctx.font = `800 ${Math.round(H * 0.07)}px Helvetica,Arial`;
      ctx.fillText(`${s.score} pts`, W * 0.045, H - bh * 0.18);
      ctx.fillStyle = "#aeb9d8"; ctx.font = `600 ${Math.round(H * 0.03)}px Helvetica,Arial`;
      ctx.textAlign = "right";
      ctx.fillText(`${s.mine} zones · ${s.km.toFixed(1)} km · ${s.vol} vols`, W * 0.955, H - bh * 0.4);
      ctx.textAlign = "left";
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      const file = new File([blob], "runner-arena.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Runner Arena", text: `J'ai conquis ${s.mine} zones (${s.score} pts) sur Runner Arena !` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "runner-arena.png"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) { console.warn("[share] échec :", e); }
  }

  _hexoBubble(txt, ms) {
    const b = this.hexo?.bubble; if (!b) return;
    b.textContent = txt; b.classList.add("show");
    clearTimeout(this._hxBubT);
    this._hxBubT = setTimeout(() => b.classList.remove("show"), ms);
  }

  _hexoConfetti() {
    const root = this.hexo?.root; if (!root) return;
    for (let i = 0; i < 22; i++) {
      const s = document.createElement("span");
      s.className = "hexo-confetti";
      const a = Math.random() * Math.PI - Math.PI / 2;
      s.style.setProperty("--dx", (Math.cos(a) * (45 + Math.random() * 55)).toFixed(0) + "px");
      s.style.setProperty("--dy", (-55 - Math.random() * 70).toFixed(0) + "px");
      s.style.background = Math.random() < 0.45 ? "#28e8ff" : (Math.random() < 0.5 ? "#ff2e86" : "#ffcf5c");
      root.appendChild(s);
      setTimeout(() => s.remove(), 1800);
    }
  }

  /* ---------------- propriété des tuiles ---------------- */
  // Arbitrage : quand plusieurs joueurs occupent la tuile, le mode de la map
  // départage — vitesse la plus haute OU nombre de passages le plus élevé.
  _resolve(contenders) {
    const c = contenders.slice();
    if (this.mapMode === "endurance") c.sort((a, b) => (b.passes - a.passes) || (b.speed - a.speed)); // le plus assidu
    else if (this.mapMode === "handicap") c.sort((a, b) => a.speed - b.speed);                        // avantage à l'outsider
    else c.sort((a, b) => b.speed - a.speed);                                                          // blitz : le plus rapide
    return c[0].player;
  }

  // Change le mode en direct : re-arbitre les zones disputées, met à jour couleurs, stats et HUD.
  setMode(mode) {
    if (mode === this.mapMode) return;
    this.mapMode = mode;
    for (const m of this.meta) {
      if (!m.contenders) continue;
      m.owner = this._resolve(m.contenders);
      m.colB = m.owner === "me" ? CYAN : MAG;   // couleur finale de la tuile volée
    }
    // ré-encode la couleur B (offset 10..12) et ré-upload l'instance buffer
    this.meta.forEach((m, i) => { const o = i * 16; this.instData[o+10] = m.colB[0]; this.instData[o+11] = m.colB[1]; this.instData[o+12] = m.colB[2]; });
    if (this.gl && this.instBuf) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instBuf);
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instData);
    }
    this.stats = this._computeStats(this.runDate);
    this._pStat = this._rStat = -1;               // force le rafraîchissement du HUD
    this._risk = null;
    if (this.sel) this._selectTile(this.sel);      // rafraîchit la fiche ouverte
    this.map.triggerRepaint();
  }

  _fmtRemaining(ms) {
    if (ms <= 0) return "expirée · remise en jeu";
    const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return `${d} j ${h} h`;
    if (h > 0) return `${h} h ${m} min`;
    return `${m} min`;
  }

  _selectTile(rec) {
    this.sel = rec || null;
    clearInterval(this._cdTimer);
    const el = this.infoEl;
    if (!el) return;
    if (!rec) { el.wrap.classList.remove("show"); return; }
    el.wrap.classList.add("show");
    el.id.textContent = rec.id;

    const render = () => {
      if (rec.owner) {
        const p = PLAYERS[rec.owner];
        el.owner.innerHTML = `<span class="rp-dotc" style="background:${p.color}"></span>${p.name}`;
        el.acq.textContent = new Date(rec.acquiredAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
        const remain = rec.acquiredAt + TTL_DAYS * DAY - Date.now();
        el.cd.textContent = this._fmtRemaining(remain);
        el.cd.classList.toggle("urgent", remain < 2 * DAY);
        // ligne d'arbitrage
        if (rec.contenders) {
          const mlabel = this.mapMode === "speed" ? "vitesse" : "passages";
          el.extra.style.display = "";
          el.extra.innerHTML = `Zone disputée · attribuée au <b>${mlabel}</b> :<br>` +
            rec.contenders.map(c => `${PLAYERS[c.player].name} — ${c.passes}× · ${c.speed.toFixed(1)} m/s`).join("<br>");
        } else {
          el.extra.style.display = "";
          el.extra.innerHTML = `${rec.passes || 1} passage(s) · ${(rec.speed || 0).toFixed(1)} m/s`;
        }
      } else {
        el.owner.innerHTML = `<span class="rp-dotc" style="background:#9aa6c8"></span>Neutre — libre`;
        el.acq.textContent = "—";
        el.cd.textContent = "disponible";
        el.cd.classList.remove("urgent");
        el.extra.style.display = "none";
      }
    };
    render();
    if (rec.owner) this._cdTimer = setInterval(render, 30000); // rafraîchit le compte à rebours
  }

  /* ---------------- HUD ---------------- */
  _injectHud() {
    const style = document.createElement("style");
    style.textContent = `
      body.replay #hud-top,body.replay #hud-bottom,body.replay #boot,body.replay #game,body.replay #flash{display:none!important}
      .rp{position:absolute;z-index:6;pointer-events:none;font-family:"Helvetica Neue",Arial,sans-serif;color:#cdd8f5}
      .rp-eyebrow{font-size:10px;letter-spacing:.4em;text-transform:uppercase;color:#7c88b0;font-weight:700}
      .rp-title{margin:.35em 0 0;font-weight:800;line-height:.9;font-size:clamp(24px,7vw,44px);letter-spacing:-.02em;text-transform:uppercase;
        background:linear-gradient(92deg,#28e8ff,#bfefff 55%,#ff2e86);-webkit-background-clip:text;background-clip:text;color:transparent}
      #rp-top{top:calc(env(safe-area-inset-top,0) + 16px);left:18px}
      #rp-score{top:calc(env(safe-area-inset-top,0) + 16px);right:18px;display:flex;gap:16px;text-align:right}
      .rp-team{display:flex;flex-direction:column;align-items:flex-end}
      .rp-team .n{font-size:clamp(26px,7vw,44px);font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
      .rp-team .l{font-size:9px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;color:#7c88b0}
      .rp-team.p .n{color:#28e8ff;text-shadow:0 0 20px rgba(40,232,255,.45)}
      .rp-team.r .n{color:#ff2e86;text-shadow:0 0 20px rgba(255,46,134,.45)}
      #rp-bottom{left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0) + 20px);width:min(520px,88vw);display:flex;flex-direction:column;gap:12px;pointer-events:auto}
      #rp-bar{height:3px;border-radius:3px;background:rgba(124,136,176,.25);position:relative;overflow:hidden}
      #rp-fill{position:absolute;inset:0 100% 0 0;background:linear-gradient(90deg,#28e8ff,#ff2e86);box-shadow:0 0 12px rgba(40,232,255,.5)}
      #rp-replay{align-self:center;pointer-events:auto;cursor:pointer;border:1px solid rgba(124,136,176,.3);background:rgba(10,13,26,.55);backdrop-filter:blur(8px);color:#cdd8f5;font-weight:700;font-size:11px;letter-spacing:.18em;text-transform:uppercase;padding:11px 22px;border-radius:100px;display:inline-flex;align-items:center;gap:8px}
      #rp-replay:hover{border-color:#28e8ff;color:#fff;box-shadow:0 0 22px rgba(40,232,255,.22)}
      #rp-status{margin-top:.8em;font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:700;display:flex;align-items:center;gap:.5em}
      #rp-status .dot{width:6px;height:6px;border-radius:50%;background:#28e8ff;box-shadow:0 0 9px #28e8ff}
      body.rp-light #rp-statustxt{color:#26304a}
      body.rp-light .rp-eyebrow,body.rp-light .rp-team .l{color:#5a668a}
      body.rp-light .rp{text-shadow:0 1px 10px rgba(255,255,255,.6)}
      body.rp-dark .rp{text-shadow:0 1px 12px rgba(0,0,0,.4)}
      /* sélecteur de mode de carte */
      #rp-modes{position:absolute;z-index:6;top:calc(env(safe-area-inset-top,0) + 78px);left:50%;transform:translateX(-50%);
        display:flex;gap:2px;padding:4px;border-radius:100px;pointer-events:auto;font-family:"Helvetica Neue",Arial,sans-serif;
        background:rgba(12,16,28,.6);backdrop-filter:blur(10px);border:1px solid rgba(124,136,176,.24);box-shadow:0 6px 20px rgba(0,0,0,.22)}
      body.rp-light #rp-modes{background:rgba(255,255,255,.72);border-color:rgba(20,30,60,.12)}
      #rp-modes button{cursor:pointer;border:0;background:transparent;color:#8b97bd;font-family:inherit;
        display:flex;flex-direction:column;align-items:center;gap:1px;padding:7px 16px;border-radius:100px;line-height:1.1;transition:.18s}
      body.rp-light #rp-modes button{color:#5a668a}
      #rp-modes button b{font-size:12px;font-weight:800;letter-spacing:.02em}
      #rp-modes button small{font-size:8px;letter-spacing:.14em;text-transform:uppercase;opacity:.75}
      #rp-modes button.on{background:linear-gradient(92deg,#28e8ff,#7ff0ff);color:#062028;box-shadow:0 2px 14px rgba(40,232,255,.35)}
      /* toast de découverte de lieu */
      #rp-toast{position:absolute;z-index:7;top:calc(env(safe-area-inset-top,0) + 132px);left:50%;transform:translate(-50%,-8px);
        background:rgba(12,16,28,.84);backdrop-filter:blur(10px);border:1px solid rgba(40,232,255,.45);border-radius:100px;
        padding:9px 18px;color:#eafcff;font-family:"Helvetica Neue",Arial,sans-serif;font-weight:700;font-size:13px;
        display:flex;align-items:center;gap:10px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;box-shadow:0 8px 26px rgba(0,0,0,.32)}
      #rp-toast.show{opacity:1;transform:translate(-50%,0)}
      #rp-toast .em{font-size:19px}
      #rp-toast small{display:block;font-size:8px;letter-spacing:.22em;text-transform:uppercase;color:#28e8ff;font-weight:700}
      body.rp-light #rp-toast{background:rgba(255,255,255,.92);color:#1a2036;border-color:rgba(40,180,220,.5)}
      /* collection dans le bilan */
      #rp-recap .rc-badges{display:grid;grid-template-columns:repeat(auto-fill,minmax(82px,1fr));gap:8px}
      #rp-recap .rc-badge{display:flex;flex-direction:column;align-items:center;gap:5px;padding:11px 6px;border-radius:12px;background:#121728;border:1px solid rgba(124,136,176,.14);text-align:center}
      #rp-recap .rc-badge.earned{border-color:rgba(40,232,255,.5);box-shadow:0 0 16px rgba(40,232,255,.14)}
      #rp-recap .rc-badge .be{font-size:24px;filter:grayscale(1);opacity:.35}
      #rp-recap .rc-badge.earned .be{filter:none;opacity:1}
      #rp-recap .rc-badge .bn{font-size:9px;line-height:1.25;color:#8b97bd}
      #rp-recap .rc-badge.earned .bn{color:#cdd8f5}
      /* fiche de tuile */
      #rp-info{position:absolute;z-index:7;left:18px;top:120px;width:min(280px,80vw);
        background:rgba(12,16,28,.82);backdrop-filter:blur(12px);border:1px solid rgba(124,136,176,.28);
        border-radius:16px;padding:16px 18px;color:#e6ecfb;font-family:"Helvetica Neue",Arial,sans-serif;
        box-shadow:0 12px 40px rgba(0,0,0,.35);opacity:0;transform:translateY(8px);pointer-events:none;
        transition:opacity .18s,transform .18s;text-shadow:none}
      #rp-info.show{opacity:1;transform:none;pointer-events:auto}
      #rp-info .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
      #rp-info .tag{font-size:9px;letter-spacing:.22em;text-transform:uppercase;font-weight:700;color:#8b97bd}
      #rp-info .x{cursor:pointer;color:#8b97bd;font-size:18px;line-height:1;border:0;background:none;padding:0 2px}
      #rp-info .x:hover{color:#fff}
      #rp-info .idv{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#7c88b0;margin-bottom:12px;word-break:break-all}
      #rp-info .row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid rgba(124,136,176,.14);font-size:13px}
      #rp-info .row .k{color:#8b97bd}
      #rp-info .row .v{font-weight:700;text-align:right}
      #rp-info .owner{display:inline-flex;align-items:center;gap:7px}
      #rp-info .rp-dotc{width:9px;height:9px;border-radius:50%;box-shadow:0 0 8px currentColor}
      #rp-info .cd.urgent{color:#ff7a7a}
      #rp-info .extra{margin-top:10px;font-size:11px;line-height:1.6;color:#aab4d4;border-top:1px solid rgba(124,136,176,.14);padding-top:10px}
      /* ---- Mascottes : Hexo & Nyx ---- */
      #hexo,#nyx{position:absolute;left:0;top:0;z-index:6;pointer-events:none;will-change:transform}
      .hexo-inner,.nyx-inner{position:absolute;margin-left:-26px;margin-top:-62px;width:52px;height:56px;transform-origin:50% 100%}
      .hexo-inner svg,.nyx-inner svg{width:52px;height:56px;display:block;overflow:visible}
      .hexo-inner svg{filter:drop-shadow(0 0 7px rgba(40,232,255,.8)) drop-shadow(0 3px 5px rgba(0,0,0,.35))}
      .nyx-inner svg{filter:drop-shadow(0 0 7px rgba(255,46,134,.8)) drop-shadow(0 3px 5px rgba(0,0,0,.35))}
      .hexo-inner.steal svg{filter:drop-shadow(0 0 13px rgba(255,46,134,.95)) drop-shadow(0 3px 5px rgba(0,0,0,.35))}
      .hexo-shadow,.nyx-shadow{position:absolute;left:50%;top:-8px;width:34px;height:9px;margin-left:-17px;border-radius:50%;background:rgba(0,0,0,.26);filter:blur(2px);z-index:-1}
      /* corps : sauts / états */
      .hexo-inner.idle{animation:hexo-idle 2.2s ease-in-out infinite}
      .hexo-inner.run{animation:hexo-hop .46s ease-in-out infinite}
      .hexo-inner.win{animation:hexo-win .64s ease-in-out infinite}
      .hexo-inner.worry{animation:hexo-worry 1.7s ease-in-out infinite}
      @keyframes hexo-idle{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-4px) scale(1.03,.98)}}
      @keyframes hexo-hop{0%{transform:translateY(0) scale(1.09,.9)}26%{transform:translateY(-17px) scale(.93,1.11)}56%{transform:translateY(0) scale(1.11,.87)}78%{transform:translateY(-3px) scale(.99,1.02)}100%{transform:translateY(0) scale(1,1)}}
      @keyframes hexo-win{0%,100%{transform:translateY(0) rotate(-7deg)}50%{transform:translateY(-24px) rotate(7deg)}}
      @keyframes hexo-worry{0%,100%{transform:translateY(0) rotate(-2.5deg)}50%{transform:translateY(-2px) rotate(2.5deg)}}
      .nyx-inner.guard{animation:hexo-idle 2.5s ease-in-out infinite}
      .nyx-inner.hit{animation:nyx-hit .5s ease-in-out}
      .nyx-inner.defeat{animation:nyx-defeat 1.3s linear infinite}
      @keyframes nyx-hit{0%{transform:translate(0,0) rotate(0)}20%{transform:translate(-6px,0) rotate(-12deg)}45%{transform:translate(6px,0) rotate(9deg)}70%{transform:translate(-3px,0) rotate(-5deg)}100%{transform:translate(0,0) rotate(0)}}
      @keyframes nyx-defeat{to{transform:rotate(360deg)}}
      /* visage animé : yeux + bouches */
      .hx-eye{transform-box:fill-box;transform-origin:center;animation:hx-blink 4.2s infinite}
      @keyframes hx-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
      .hx-pupils{transform-box:fill-box;transform-origin:center;animation:hx-look 5s ease-in-out infinite}
      @keyframes hx-look{0%,18%{transform:translate(0,0)}28%,44%{transform:translate(2.2px,0)}54%,70%{transform:translate(-2.2px,1px)}82%,100%{transform:translate(0,0)}}
      .hx-mouth{display:none}
      .hx-smile{display:block}
      .hx-happy{display:none}
      .hx-sweat{display:none}
      .win .hx-normalface{display:none}
      .win .hx-happy{display:block}
      .win .hx-smile{display:none}.win .hx-o{display:block}
      .steal .hx-smile{display:none}.steal .hx-gasp{display:block}
      .steal .hx-pupils{animation:none;transform:translateY(2px) scaleX(.8)}
      .worry .hx-smile{display:none}.worry .hx-wave{display:block}
      .worry .hx-pupils{animation:none;transform:translate(0,-1.5px)}
      .worry .hx-sweat{display:block;animation:hx-sweat 1.7s ease-in-out infinite}
      @keyframes hx-sweat{0%{transform:translateY(0);opacity:0}25%{opacity:1}100%{transform:translateY(7px);opacity:0}}
      /* bras (pose victoire) */
      .hexo-arm{position:absolute;top:15px;width:16px;height:5px;border-radius:4px;background:#eafcff;box-shadow:0 0 7px rgba(40,232,255,.9);opacity:0}
      .hexo-arm:after{content:"";position:absolute;width:9px;height:9px;border-radius:50%;background:#eafcff;top:-2px}
      .hexo-arm.l{left:-11px;transform-origin:100% 50%}.hexo-arm.l:after{left:-5px}
      .hexo-arm.r{right:-11px;transform-origin:0 50%}.hexo-arm.r:after{right:-5px}
      .hexo-inner.win .hexo-arm{opacity:1;animation:hexo-armw .64s ease-in-out infinite}
      .hexo-inner.win .hexo-arm.l{transform:rotate(58deg)}
      .hexo-inner.win .hexo-arm.r{transform:rotate(-58deg)}
      @keyframes hexo-armw{0%,100%{margin-top:0}50%{margin-top:-5px}}
      /* bulles */
      #hexo-bubble,#nyx-bubble{position:absolute;left:50%;top:-18px;transform:translate(-50%,-100%) scale(.5);
        background:#fff;color:#0a0c16;font-weight:800;font-size:11px;letter-spacing:.03em;padding:5px 10px;border-radius:11px;
        white-space:nowrap;opacity:0;transition:opacity .16s,transform .16s;box-shadow:0 5px 16px rgba(0,0,0,.32)}
      #hexo-bubble.show,#nyx-bubble.show{opacity:1;transform:translate(-50%,-100%) scale(1)}
      #hexo-bubble:after,#nyx-bubble:after{content:"";position:absolute;left:50%;bottom:-3px;width:9px;height:9px;background:#fff;transform:translateX(-50%) rotate(45deg)}
      /* confettis */
      .hexo-confetti{position:absolute;left:-3px;top:-58px;width:7px;height:7px;border-radius:2px;pointer-events:none;animation:hexo-conf 1.7s ease-out forwards}
      @keyframes hexo-conf{0%{transform:translate(0,0) scale(1) rotate(0);opacity:1}12%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(420deg);opacity:0}}
      /* screen shake */
      #stage.shake{animation:screenshake .45s ease-in-out}
      @keyframes screenshake{0%,100%{transform:translate(0,0)}20%{transform:translate(-6px,4px)}40%{transform:translate(6px,-5px)}60%{transform:translate(-4px,-3px)}80%{transform:translate(4px,5px)}}
      /* ---- bilan de course ---- */
      #rp-recap{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;padding:20px;
        background:rgba(6,9,16,.5);backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .3s}
      #rp-recap.show{opacity:1;pointer-events:auto}
      #rp-recap .panel{width:min(440px,94vw);max-height:92vh;overflow:auto;background:rgba(14,18,30,.95);border:1px solid rgba(124,136,176,.28);
        border-radius:22px;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,.5);transform:translateY(16px) scale(.98);transition:transform .3s;text-shadow:none;color:#e6ecfb}
      #rp-recap.show .panel{transform:none}
      #rp-recap .rc-eyebrow{font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#8b97bd;font-weight:700}
      #rp-recap h2{margin:.3em 0 0;font-size:26px;font-weight:800;letter-spacing:-.02em;text-transform:uppercase;
        background:linear-gradient(92deg,#28e8ff,#ff2e86);-webkit-background-clip:text;background-clip:text;color:transparent}
      #rp-recap .rc-score{display:flex;align-items:baseline;gap:12px;margin:16px 0 4px}
      #rp-recap .rc-score .v{font-size:54px;font-weight:800;line-height:.9;color:#28e8ff;font-variant-numeric:tabular-nums;text-shadow:0 0 26px rgba(40,232,255,.5)}
      #rp-recap .rc-score .l{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8b97bd;font-weight:700;line-height:1.3}
      #rp-recap .rc-sec{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#8b97bd;font-weight:700;margin:20px 0 9px}
      #rp-recap .rc-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(124,136,176,.14);border:1px solid rgba(124,136,176,.14);border-radius:12px;overflow:hidden}
      #rp-recap .rc-cell{background:#121728;padding:11px 13px;display:flex;flex-direction:column;gap:3px}
      #rp-recap .rc-cell .k{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#8b97bd}
      #rp-recap .rc-cell .n{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums}
      #rp-recap .rc-cell .n small{font-size:11px;color:#8b97bd;font-weight:600}
      #rp-recap .rc-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:8px 2px;border-bottom:1px solid rgba(124,136,176,.1)}
      #rp-recap .rc-row .k{color:#aeb9d8;display:inline-flex;align-items:center;gap:8px}
      #rp-recap .rc-row.sub .k{color:#7c88b0;padding-left:18px;font-size:12px}
      #rp-recap .rc-row .k i{width:9px;height:9px;border-radius:2px;display:inline-block}
      #rp-recap .rc-row .v{font-weight:800;font-variant-numeric:tabular-nums}
      #rp-recap .pos{color:#4be3a0}#rp-recap .neg{color:#ff7a7a}
      #rp-recap .rc-note{margin-top:14px;font-size:11px;color:#7c88b0;line-height:1.55}
      #rp-recap .rc-note b{color:#e6ecfb}
      #rp-recap .rc-actions{display:flex;gap:10px;margin-top:18px}
      #rp-recap button{flex:1;cursor:pointer;border-radius:100px;padding:12px;font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;border:1px solid rgba(124,136,176,.3);color:#cdd8f5;background:transparent}
      #rp-recap .primary{background:linear-gradient(92deg,#28e8ff,#7ff0ff);color:#062028;border:0}
    `;
    document.head.appendChild(style);
    document.body.classList.add("replay", this.mapKind === "light" ? "rp-light" : "rp-dark");
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="rp-top" class="rp">
        <div class="rp-eyebrow">Runner Arena · Course 5,0 km · Fin de course</div>
        <h1 class="rp-title">Prise de territoire</h1>
        <div id="rp-status"><span class="dot"></span><span id="rp-statustxt">Initialisation de l'arène</span></div>
      </div>
      <div id="rp-score" class="rp">
        <div class="rp-team p"><span class="n" id="rp-p">0</span><span class="l">Toi</span></div>
        <div class="rp-team r"><span class="n" id="rp-r">0</span><span class="l">Rival</span></div>
      </div>
      <div id="rp-modes">
        <button data-mode="blitz"><b>Blitz</b><small>Rapidité</small></button>
        <button data-mode="endurance"><b>Endurance</b><small>Passages</small></button>
        <button data-mode="handicap"><b>Handicap</b><small>Équilibré</small></button>
      </div>
      <div id="rp-bottom" class="rp">
        <div id="rp-bar"><div id="rp-fill"></div></div>
        <button id="rp-replay">▶ Revivre</button>
      </div>
      <div id="hexo">
        <div class="hexo-inner idle">
          <div class="hexo-shadow"></div>
          <div class="hexo-arm l"></div><div class="hexo-arm r"></div>
          <div id="hexo-bubble"></div>
          <svg viewBox="0 0 52 56" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="hxg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#9ff8ff"/><stop offset="1" stop-color="#13c9e7"/></linearGradient></defs>
            <path d="M26 2 L48 15 L48 41 L26 54 L4 41 L4 15 Z" fill="url(#hxg)" stroke="#eafcff" stroke-width="2.2" stroke-linejoin="round" opacity="0.93"/>
            <ellipse cx="15" cy="14" rx="4.5" ry="2.6" fill="#fff" opacity=".45"/>
            <g class="hx-normalface">
              <circle class="hx-eye" cx="19" cy="27" r="6" fill="#fff"/><circle class="hx-eye" cx="33" cy="27" r="6" fill="#fff"/>
              <g class="hx-pupils">
                <circle cx="20.5" cy="28" r="3" fill="#0b1a34"/><circle cx="34.5" cy="28" r="3" fill="#0b1a34"/>
                <circle cx="18.6" cy="25.6" r="1.4" fill="#fff"/><circle cx="32.6" cy="25.6" r="1.4" fill="#fff"/>
              </g>
            </g>
            <g class="hx-happy" fill="none" stroke="#0b1a34" stroke-width="2.6" stroke-linecap="round">
              <path d="M15 28 Q19 22.5 23 28"/><path d="M29 28 Q33 22.5 37 28"/>
            </g>
            <path class="hx-mouth hx-smile" d="M20 38 Q26 43 32 38" stroke="#0b1a34" stroke-width="2" fill="none" stroke-linecap="round"/>
            <ellipse class="hx-mouth hx-o" cx="26" cy="40" rx="4" ry="5" fill="#0b1a34"/>
            <path class="hx-mouth hx-gasp" d="M21 37 h10 a5 5 0 0 1 -10 0 z" fill="#0b1a34"/>
            <path class="hx-mouth hx-wave" d="M20 40 q3 -3.5 6 0 t6 0" stroke="#0b1a34" stroke-width="2" fill="none" stroke-linecap="round"/>
            <circle class="hx-sweat" cx="41" cy="19" r="2.6" fill="#7fd3ff"/>
          </svg>
        </div>
      </div>
      <div id="nyx">
        <div class="nyx-inner guard">
          <div class="nyx-shadow"></div>
          <div id="nyx-bubble"></div>
          <svg viewBox="0 0 52 56" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="nxg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#ff9ec8"/><stop offset="1" stop-color="#e01a63"/></linearGradient></defs>
            <path d="M26 2 L48 15 L48 41 L26 54 L4 41 L4 15 Z" fill="url(#nxg)" stroke="#ffe6f1" stroke-width="2.2" stroke-linejoin="round" opacity="0.93"/>
            <g class="hx-normalface">
              <circle class="hx-eye" cx="19" cy="28" r="5.5" fill="#fff"/><circle class="hx-eye" cx="33" cy="28" r="5.5" fill="#fff"/>
              <g class="hx-pupils">
                <circle cx="20" cy="29" r="2.7" fill="#3a0620"/><circle cx="34" cy="29" r="2.7" fill="#3a0620"/>
              </g>
            </g>
            <path d="M13 20 L24 24" stroke="#4a0a26" stroke-width="2.6" stroke-linecap="round"/>
            <path d="M39 20 L28 24" stroke="#4a0a26" stroke-width="2.6" stroke-linecap="round"/>
            <path d="M20 43 Q26 38 32 43" stroke="#4a0a26" stroke-width="2" fill="none" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
      <div id="rp-info">
        <div class="hd"><span class="tag">Tuile · ${this.instanceId || ""}</span><button class="x" id="rp-info-x">×</button></div>
        <div class="idv" id="rp-info-id"></div>
        <div class="row"><span class="k">Propriétaire</span><span class="v owner" id="rp-info-owner"></span></div>
        <div class="row"><span class="k">Acquise le</span><span class="v" id="rp-info-acq"></span></div>
        <div class="row"><span class="k">Expire dans</span><span class="v cd" id="rp-info-cd"></span></div>
        <div class="extra" id="rp-info-extra"></div>
      </div>
      <div id="rp-toast"></div>
      <div id="rp-recap"><div class="panel" id="rp-recap-panel"></div></div>`;
    document.body.appendChild(wrap);
    this.hudEl = {
      p: wrap.querySelector("#rp-p"), r: wrap.querySelector("#rp-r"),
      fill: wrap.querySelector("#rp-fill"), st: wrap.querySelector("#rp-statustxt"),
      dot: wrap.querySelector("#rp-status .dot"),
    };
    this.infoEl = {
      wrap: wrap.querySelector("#rp-info"), id: wrap.querySelector("#rp-info-id"),
      owner: wrap.querySelector("#rp-info-owner"), acq: wrap.querySelector("#rp-info-acq"),
      cd: wrap.querySelector("#rp-info-cd"), extra: wrap.querySelector("#rp-info-extra"),
    };
    this.hexo = {
      root: wrap.querySelector("#hexo"), inner: wrap.querySelector("#hexo .hexo-inner"),
      bubble: wrap.querySelector("#hexo-bubble"),
    };
    this.nyx = {
      root: wrap.querySelector("#nyx"), inner: wrap.querySelector("#nyx .nyx-inner"),
      bubble: wrap.querySelector("#nyx-bubble"),
    };
    this.recapEl = wrap.querySelector("#rp-recap");
    this.recapPanel = wrap.querySelector("#rp-recap-panel");
    this.toastEl = wrap.querySelector("#rp-toast");
    wrap.querySelector("#rp-info-x").addEventListener("click", () => this._selectTile(null));
    wrap.querySelector("#rp-replay").addEventListener("click", () => this.replay());

    const modeEls = wrap.querySelectorAll("#rp-modes button");
    const syncModes = () => modeEls.forEach(b => b.classList.toggle("on", b.dataset.mode === this.mapMode));
    modeEls.forEach(b => b.addEventListener("click", () => { this.setMode(b.dataset.mode); syncModes(); }));
    syncModes();
  }

  _resetHud(){ this._pStat=this._rStat=-1; if(this.hudEl){this.hudEl.p.textContent="0";this.hudEl.r.textContent="0";} }

  _hud(t) {
    if (!this.hudEl) return;
    let p=0,r=0,steal=false;
    for (const m of this.meta) {
      if (!m.owned) continue;
      const app = m.stolen ? Math.min(m.appear,0.15) : m.appear;
      if (t < app) continue;
      if (m.flip < 1e8 && t >= m.flip) { p++; if (t-m.flip < 0.5) steal=true; }
      else if (m.colA === CYAN) p++;
      else if (m.colA === MAG) r++;
    }
    if (p!==this._pStat){this.hudEl.p.textContent=p;this._pStat=p;}
    if (r!==this._rStat){this.hudEl.r.textContent=r;this._rStat=r;}
    this.hudEl.fill.style.right=(100-clamp01(t/CFG.T)*100).toFixed(1)+"%";
    const s = t<CFG.cap0 ? "Initialisation de l'arène" : steal ? "Territoire arraché au rival !" : t<CFG.cap1 ? "Conquête en cours" : "Territoire conquis";
    if (this.hudEl.st.textContent!==s){ this.hudEl.st.textContent=s; this.hudEl.dot.style.background = steal?"#ff2e86":"#28e8ff"; }
  }
}
