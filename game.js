/* ======================================================================
 * Runner Arena — maquette de gamification territoriale sur carte réelle.
 * 2D (canvas au-dessus d'une carte Leaflet) + effets "3D" : particules,
 * halos néon, pulsations, ondes de capture, runners autonomes.
 * ====================================================================== */

const CONFIG = {
  center: [48.8566, 2.3522], // Paris — change-moi (ex: [45.7640, 4.8357] Lyon)
  zoom: 15,
  hexSize: 75,               // rayon d'un hexagone en mètres
  range: 15,                 // rayon de la grille (en anneaux)
};

const TEAMS = {
  cyan: { name: "AZUR",   color: "#00e5ff", rgb: [0, 229, 255] },
  pink: { name: "NOVA",   color: "#ff2d95", rgb: [255, 45, 149] },
  lime: { name: "FLUX",   color: "#b6ff2e", rgb: [182, 255, 46] },
};
const TEAM_IDS = Object.keys(TEAMS);
let myTeam = "cyan";

/* ---------------------------------------------------------------- Carte */
const map = L.map("map", {
  center: CONFIG.center,
  zoom: CONFIG.zoom,
  zoomControl: false,
  attributionControl: true,
  minZoom: 13,
  maxZoom: 17,
  zoomSnap: 0.25,
  wheelPxPerZoomLevel: 120,
});

L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    subdomains: "abcd",
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://openstreetmap.org">OSM</a> · &copy; <a href="https://carto.com">CARTO</a>',
  }
).addTo(map);

/* ---------------------------------------------------------------- Grille */
const grid = HexGrid.build(CONFIG.center, CONFIG.hexSize, CONFIG.range);

/* ---------------------------------------------------------------- Canvas */
const canvas = document.getElementById("fx");
const ctx = canvas.getContext("2d");
let DPR = Math.min(window.devicePixelRatio || 1, 2);

function resize() {
  const r = map.getContainer().getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = r.width * DPR;
  canvas.height = r.height * DPR;
  canvas.style.width = r.width + "px";
  canvas.style.height = r.height + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

/* Échelle pixels/mètre à l'instant t (Mercator, ~constant à l'échelle ville) */
function pixelsPerMeter() {
  const c = map.getCenter();
  const p1 = map.latLngToContainerPoint(c);
  const p2 = map.latLngToContainerPoint([c.lat, c.lng + 0.0015]);
  const meters = 0.0015 * grid.mLng;
  return Math.hypot(p2.x - p1.x, p2.y - p1.y) / meters;
}

/* ---------------------------------------------------------------- État FX */
const particles = [];
const rings = [];        // ondes de capture
const runners = [];
let simOn = false;
let hoverTile = null;
let lastT = performance.now();

/* ---------------------------------------------------------------- Utils */
function spawnBurst(tile, team, n = 34) {
  const rgb = TEAMS[team].rgb;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (0.4 + Math.random() * 1.6) * CONFIG.hexSize; // m/s
    particles.push({
      x: tile.mx, y: tile.my,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0, max: 0.5 + Math.random() * 0.7,
      size: 1.5 + Math.random() * 2.5,
      rgb,
    });
  }
  rings.push({ x: tile.mx, y: tile.my, life: 0, max: 0.6, rgb });
}

function captureTile(tile, team, silent) {
  if (!tile || tile.owner === team) return false;
  tile.owner = team;
  tile.capT = 0.0001;
  if (!silent) spawnBurst(tile, team);
  return true;
}

/* ---------------------------------------------------------------- Runners */
function makeRunner(team) {
  const a = Math.random() * Math.PI * 2;
  const rad = Math.random() * grid.bounds.maxX * 0.7;
  const speed = 42 + Math.random() * 22; // m/s (rythme "arcade")
  return {
    team,
    x: Math.cos(a) * rad, y: Math.sin(a) * rad,
    dir: Math.random() * Math.PI * 2,
    speed,
    turn: 0,
    trail: [],
    cd: 0,
  };
}

function seedRunners() {
  runners.length = 0;
  const perTeam = +document.getElementById("runnerSlider").value;
  TEAM_IDS.forEach((t) => {
    for (let i = 0; i < perTeam; i++) runners.push(makeRunner(t));
  });
}

function updateRunners(dt) {
  const b = grid.bounds;
  for (const rn of runners) {
    // errance douce + rebond sur les bords
    rn.turn += (Math.random() - 0.5) * 3 * dt;
    rn.turn *= 0.9;
    rn.dir += rn.turn * dt;
    rn.x += Math.cos(rn.dir) * rn.speed * dt;
    rn.y += Math.sin(rn.dir) * rn.speed * dt;

    if (rn.x < b.minX || rn.x > b.maxX) { rn.dir = Math.PI - rn.dir; rn.x = Math.max(b.minX, Math.min(b.maxX, rn.x)); }
    if (rn.y < b.minY || rn.y > b.maxY) { rn.dir = -rn.dir; rn.y = Math.max(b.minY, Math.min(b.maxY, rn.y)); }

    // traînée
    rn.trail.push({ x: rn.x, y: rn.y, life: 0 });
    if (rn.trail.length > 26) rn.trail.shift();
    for (const p of rn.trail) p.life += dt;

    // capture de l'hex courant
    rn.cd -= dt;
    if (rn.cd <= 0) {
      const h = HexGrid.metersToHex(rn.x, rn.y, CONFIG.hexSize);
      const tile = grid.tiles.get(grid.key(h.q, h.r));
      if (tile && tile.owner !== rn.team) {
        captureTile(tile, rn.team);
        rn.cd = 0.12;
      }
    }
    // fines particules de sillage
    if (Math.random() < 0.5) {
      particles.push({
        x: rn.x, y: rn.y,
        vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8,
        life: 0, max: 0.4 + Math.random() * 0.4, size: 1 + Math.random() * 1.5,
        rgb: TEAMS[rn.team].rgb,
      });
    }
  }
}

/* ---------------------------------------------------------------- Dessin */
function hexPath(cx, cy, rpx) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - 30); // pointy-top
    const x = cx + rpx * Math.cos(ang);
    const y = cy + rpx * Math.sin(ang);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function draw(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  const t = now / 1000;

  if (simOn) updateRunners(dt);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const ppm = pixelsPerMeter();
  const rpx = CONFIG.hexSize * ppm;
  const W = canvas.width / DPR, H = canvas.height / DPR;
  const margin = rpx * 1.4;

  ctx.lineJoin = "round";

  // 1) tuiles neutres (grille discrète) + tuiles possédées (glow)
  const owned = [];
  for (const tile of grid.tiles.values()) {
    const p = map.latLngToContainerPoint([tile.lat, tile.lng]);
    if (p.x < -margin || p.x > W + margin || p.y < -margin || p.y > H + margin) continue;
    tile._px = p.x; tile._py = p.y;

    if (tile.owner) {
      owned.push(tile);
    } else {
      hexPath(p.x, p.y, rpx * 0.94);
      ctx.strokeStyle = "rgba(120,150,220,0.10)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // 2) tuiles possédées avec pulsation + halo
  ctx.shadowBlur = 18;
  for (const tile of owned) {
    if (tile.capT > 0 && tile.capT < 1) tile.capT = Math.min(1, tile.capT + dt / 0.55);
    const [r, g, b] = TEAMS[tile.owner].rgb;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2 + tile.phase * 6.28);
    const baseA = 0.16 + pulse * 0.12;
    const pop = tile.capT > 0 ? 1 + (1 - tile.capT) * 0.35 : 1; // léger "pop" à la capture

    ctx.shadowColor = `rgba(${r},${g},${b},0.9)`;

    // remplissage
    hexPath(tile._px, tile._py, rpx * 0.94 * pop);
    ctx.fillStyle = `rgba(${r},${g},${b},${baseA})`;
    ctx.fill();

    // contour néon
    hexPath(tile._px, tile._py, rpx * 0.94 * pop);
    ctx.strokeStyle = `rgba(${r},${g},${b},${0.55 + pulse * 0.35})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // point central lumineux
    ctx.beginPath();
    ctx.arc(tile._px, tile._py, 2 + pulse * 1.5, 0, 6.28);
    ctx.fillStyle = `rgba(${r},${g},${b},${0.6 + pulse * 0.4})`;
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // 3) survol
  if (hoverTile) {
    const p = map.latLngToContainerPoint([hoverTile.lat, hoverTile.lng]);
    const c = TEAMS[myTeam].rgb;
    hexPath(p.x, p.y, rpx * 0.94);
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.9)`;
    ctx.lineWidth = 2.2;
    ctx.shadowBlur = 16;
    ctx.shadowColor = TEAMS[myTeam].color;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // 4) ondes de capture
  for (let i = rings.length - 1; i >= 0; i--) {
    const ri = rings[i];
    ri.life += dt;
    const k = ri.life / ri.max;
    if (k >= 1) { rings.splice(i, 1); continue; }
    const p = map.latLngToContainerPoint(grid.origin);
    // position réelle de l'onde
    const cx = mToPx(ri.x, ri.y).x, cy = mToPx(ri.x, ri.y).y;
    ctx.beginPath();
    ctx.arc(cx, cy, rpx * (0.3 + k * 1.6), 0, 6.28);
    ctx.strokeStyle = `rgba(${ri.rgb[0]},${ri.rgb[1]},${ri.rgb[2]},${(1 - k) * 0.8})`;
    ctx.lineWidth = 2.5 * (1 - k) + 0.5;
    ctx.stroke();
  }

  // 5) runners + traînées
  for (const rn of runners) {
    const c = TEAMS[rn.team].rgb;
    // traînée
    ctx.beginPath();
    for (let i = 0; i < rn.trail.length; i++) {
      const tp = mToPx(rn.trail[i].x, rn.trail[i].y);
      i ? ctx.lineTo(tp.x, tp.y) : ctx.moveTo(tp.x, tp.y);
    }
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.28)`;
    ctx.lineWidth = 2;
    ctx.stroke();
    // tête
    const hp = mToPx(rn.x, rn.y);
    ctx.shadowBlur = 14;
    ctx.shadowColor = TEAMS[rn.team].color;
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 4.5, 0, 6.28);
    ctx.fillStyle = TEAMS[rn.team].color;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // 6) particules
  for (let i = particles.length - 1; i >= 0; i--) {
    const pa = particles[i];
    pa.life += dt;
    if (pa.life >= pa.max) { particles.splice(i, 1); continue; }
    pa.x += pa.vx * dt; pa.y += pa.vy * dt;
    pa.vx *= 0.93; pa.vy *= 0.93;
    const a = 1 - pa.life / pa.max;
    const sp = mToPx(pa.x, pa.y);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, pa.size * a + 0.4, 0, 6.28);
    ctx.fillStyle = `rgba(${pa.rgb[0]},${pa.rgb[1]},${pa.rgb[2]},${a})`;
    ctx.fill();
  }

  updateScoreboard();
  requestAnimationFrame(draw);
}

/* mètres (relatif origine) -> pixels écran */
function mToPx(mx, my) {
  const lat = grid.origin[0] + my / 111320;
  const lng = grid.origin[1] + mx / grid.mLng;
  return map.latLngToContainerPoint([lat, lng]);
}

/* ---------------------------------------------------------------- HUD */
function updateScoreboard() {
  const counts = { cyan: 0, pink: 0, lime: 0 };
  let total = 0;
  for (const tile of grid.tiles.values()) {
    total++;
    if (tile.owner) counts[tile.owner]++;
  }
  for (const id of TEAM_IDS) {
    const el = document.getElementById("sc-" + id);
    if (!el) continue;
    const pct = total ? (counts[id] / total) * 100 : 0;
    el.querySelector(".score-val").textContent = counts[id];
    el.querySelector(".score-bar > i").style.width = pct + "%";
  }
}

function buildScoreboard() {
  const sb = document.getElementById("scoreboard");
  sb.innerHTML = TEAM_IDS.map((id) => {
    const t = TEAMS[id];
    return `<div class="score-card" id="sc-${id}">
      <div class="score-head"><span class="score-dot" style="background:${t.color};box-shadow:0 0 8px ${t.color}"></span>${t.name}</div>
      <div class="score-val">0</div>
      <div class="score-bar"><i style="background:${t.color};box-shadow:0 0 8px ${t.color}"></i></div>
    </div>`;
  }).join("");
}

function buildTeamPicker() {
  const tp = document.getElementById("teamPicker");
  tp.innerHTML = TEAM_IDS.map((id) => {
    const t = TEAMS[id];
    return `<div class="team-chip ${id === myTeam ? "active" : ""}" data-team="${id}" style="color:${t.color}">
      <div class="swatch" style="background:${t.color}"></div>${t.name}</div>`;
  }).join("");
  tp.querySelectorAll(".team-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      myTeam = chip.dataset.team;
      tp.querySelectorAll(".team-chip").forEach((c) => c.classList.toggle("active", c === chip));
    });
  });
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

/* ---------------------------------------------------------------- Events */
map.on("click", (e) => {
  const tile = grid.tileAtLatLng(e.latlng.lat, e.latlng.lng);
  if (tile && captureTile(tile, myTeam)) {
    toast(`Zone conquise par ${TEAMS[myTeam].name} !`);
  }
});

map.on("mousemove", (e) => {
  hoverTile = grid.tileAtLatLng(e.latlng.lat, e.latlng.lng);
});
map.on("mouseout", () => { hoverTile = null; });
map.on("resize", resize);

document.getElementById("btnSim").addEventListener("click", (ev) => {
  simOn = !simOn;
  if (simOn && runners.length === 0) seedRunners();
  ev.target.classList.toggle("on", simOn);
  ev.target.textContent = simOn ? "⏸ Stopper les runners" : "▶ Lancer les runners";
  toast(simOn ? "Runners lâchés dans l'arène" : "Simulation en pause");
});

document.getElementById("btnReset").addEventListener("click", () => {
  for (const tile of grid.tiles.values()) { tile.owner = null; tile.capT = 0; }
  particles.length = 0; rings.length = 0; runners.length = 0;
  simOn = false;
  const b = document.getElementById("btnSim");
  b.classList.remove("on");
  b.textContent = "▶ Lancer les runners";
  toast("Arène réinitialisée");
});

const slider = document.getElementById("runnerSlider");
slider.addEventListener("input", () => {
  document.getElementById("runnerCount").textContent = slider.value;
  if (simOn) seedRunners();
});

/* ---------------------------------------------------------------- Go */
buildScoreboard();
buildTeamPicker();
requestAnimationFrame(draw);
