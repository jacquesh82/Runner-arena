/* ======================================================================
 * IntroScreen — page d'intro / title screen de RUNNER ARENA.
 *
 * Overlay HTML/CSS AU-DESSUS du jeu. Identité « cartographie gamifiée » :
 *   - FOND DE CARTE réel (MapLibre, même basemap que le jeu), assombri
 *   - grille hexagonale néon par-dessus
 *   - le coureur (Hexo) parcourt la carte et CONQUIERT les tuiles sur son
 *     passage : sillage de tuiles cyan qui s'illuminent puis se dissipent
 *   - Hexo mascotte SVG (idle + saut au tap) qui PARLE dans une bulle
 *
 * Composants (réutilisables côté Unity) :
 *   SceneParallax · MapField (capture au passage) · HexoController ·
 *   IntroUI (auth) · BuildInfo · AudioManager · bouton son · toast
 *
 * `show()` renvoie { profile, audio } une fois le joueur authentifié.
 * ==================================================================== */

import "../intro.css";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { AuthManager, AuthNotConfiguredError } from "./auth-service.js";
import { AudioManager } from "./audio-service.js";
import { BuildInfo } from "../build-info.js";

/* Couleurs d'équipe (miroir du jeu : PLAYER cyan, RIVAL rose). */
const CYAN = "#00e5ff";
const PINK = "#ff2d95";

/* Répliques de Hexo (rotation + au tap). */
const HEXO_LINES = [
  "Ces tuiles ? Bientôt à moi 😎",
  "Cours, je collectionne les trottoirs !",
  "Un café et je conquiers la ville ☕",
  "Le bitume tremble déjà…",
  "On va piquer le quartier du voisin ?",
  "Chausse tes baskets, on y va ! 🏃",
];

/* Fond de carte (copie autonome du style du jeu — l'intro est la couche de
 * présentation, volontairement découplée du reste). */
function introMapStyle() {
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
      { id: "bg", type: "background", paint: { "background-color": "#0a1020" } },
      { id: "base", type: "raster", source: "base" },
    ],
  };
}

/* Hexo — mascotte hexagonale expressive (placeholder SVG remplaçable par .glb). */
function hexoSvg() {
  return `
  <svg class="hexo-svg" viewBox="0 0 200 210" aria-label="Hexo">
    <defs>
      <radialGradient id="hexoBody" cx="42%" cy="32%" r="75%">
        <stop offset="0%"  stop-color="#8ef0ff"/>
        <stop offset="55%" stop-color="#3fd0ff"/>
        <stop offset="100%" stop-color="#1c8fd6"/>
      </radialGradient>
      <radialGradient id="hexoGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#8ef6ff" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#8ef6ff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse class="hexo-shadow" cx="100" cy="196" rx="52" ry="11"/>
    <ellipse cx="100" cy="105" rx="98" ry="98" fill="url(#hexoGlow)" opacity="0.7"/>
    <g class="hexo-feet">
      <ellipse cx="78" cy="176" rx="13" ry="9" fill="#1c8fd6"/>
      <ellipse cx="122" cy="176" rx="13" ry="9" fill="#1c8fd6"/>
    </g>
    <path class="hexo-body" d="M100 20 L166 58 L166 134 L100 172 L34 134 L34 58 Z"
          fill="url(#hexoBody)" stroke="#0fb6ee" stroke-width="3"
          stroke-linejoin="round"/>
    <path d="M100 30 L150 60 Q120 52 100 60 Q80 52 50 60 Z" fill="#ffffff" opacity="0.3"/>
    <ellipse cx="30" cy="104" rx="9" ry="12" fill="#28a6df"/>
    <ellipse cx="170" cy="104" rx="9" ry="12" fill="#28a6df"/>
    <g class="hexo-eyes">
      <ellipse class="eye" cx="80" cy="98" rx="14" ry="17" fill="#ffffff"/>
      <ellipse class="eye" cx="120" cy="98" rx="14" ry="17" fill="#ffffff"/>
      <circle cx="83" cy="101" r="7.5" fill="#12324a"/>
      <circle cx="117" cy="101" r="7.5" fill="#12324a"/>
      <circle cx="86" cy="97" r="2.6" fill="#fff"/>
      <circle cx="120" cy="97" r="2.6" fill="#fff"/>
    </g>
    <path d="M84 126 Q100 140 116 126" fill="none" stroke="#12324a"
          stroke-width="4" stroke-linecap="round"/>
    <circle cx="64" cy="120" r="7" fill="#ff6ba8" opacity="0.6"/>
    <circle cx="136" cy="120" r="7" fill="#ff6ba8" opacity="0.6"/>
  </svg>`;
}

function googleIcon() {
  return `
  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.7-9.8 6.7-17.4z"/>
    <path fill="#FBBC05" d="M10.4 28.3c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6.1C.9 15.9 0 19.8 0 23.5s.9 7.6 2.6 10.9l7.8-6.1z"/>
    <path fill="#34A853" d="M24 47c6.1 0 11.3-2 15-5.5l-7.3-5.7c-2 1.4-4.7 2.3-7.7 2.3-6.4 0-11.7-3.7-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 47 24 47z"/>
  </svg>`;
}

export class IntroScreen {
  constructor(config = {}) {
    this.auth = new AuthManager({ google: config.google, mindlog: config.mindlog });
    this.audio = new AudioManager();
    this.start = config.start || [48.8566, 2.3522]; // [lat, lng] — défaut Paris
    this.el = null;
    this.map = null;
    this._raf = 0;
    this._cleanups = [];
    this._resolve = null;
    this._lineIdx = 0;
  }

  show() {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._build();
      this._initMapBg();
      this._wireParallax();
      this._startMap();
      this._startParticles();
      this._wireAudio();
      this._wireHexoTalk();
      this._wireAuth();
      requestAnimationFrame(() => this.el.classList.add("ready"));
    });
  }

  /* ---------------- DOM ---------------- */
  _build() {
    const providers = this.auth.list();
    const authBtns = providers
      .map((p) => {
        if (p.id === "local") {
          return `<button class="auth-btn auth-local" data-provider="local">${p.label}</button>`;
        }
        const icon = p.id === "google" ? googleIcon() : `<span class="ml-badge">ID</span>`;
        return `<button class="auth-btn auth-${p.id}" data-provider="${p.id}">
                  ${icon}<span>${p.label}</span>
                </button>`;
      })
      .join("");

    const root = document.createElement("div");
    root.id = "intro";
    root.className = "intro";
    root.innerHTML = `
      <div class="intro-scene">
        <div class="intro-map-bg" id="introMapBg"></div>
        <div class="intro-map-tint"></div>
        <canvas class="ly ly-map intro-map"></canvas>
        <canvas class="intro-particles"></canvas>
        <div class="intro-vignette"></div>
        <div class="ly ly-hexo">
          <div class="hexo-wrap">
            <div class="hexo-bubble" id="hexoBubble"><span>${HEXO_LINES[0]}</span></div>
            <div class="hexo" id="hexo">${hexoSvg()}</div>
          </div>
        </div>
      </div>

      <button class="intro-sound" id="introSound" aria-label="Son"></button>

      <div class="intro-header">
        <div class="intro-logo logo3d">
          <span class="mark">◢◤</span><span class="w-run">RUNNER</span><span class="w-arena">ARENA</span>
        </div>
        <div class="intro-tagline">Cours pour conquérir le territoire</div>
      </div>

      <div class="intro-ui">
        ${authBtns}
        <p class="intro-legal">En continuant, vous acceptez les CGU / Confidentialité</p>
      </div>

      <div class="intro-build">${BuildInfo.label}</div>
      <div class="intro-attrib">© OpenStreetMap © CARTO</div>
      <div class="intro-toast" id="introToast"></div>
    `;
    document.body.appendChild(root);
    this.el = root;
    this.hexo = root.querySelector("#hexo");
    this.bubble = root.querySelector("#hexoBubble");
    this.soundBtn = root.querySelector("#introSound");
    this.toastEl = root.querySelector("#introToast");
    this._syncSoundIcon();
  }

  /* ---------------- Fond de carte (MapLibre, non interactif) ---------------- */
  _initMapBg() {
    try {
      this.map = new maplibregl.Map({
        container: this.el.querySelector("#introMapBg"),
        style: introMapStyle(),
        center: [this.start[1], this.start[0]],
        zoom: 15.4,
        pitch: 48,
        bearing: -18,
        interactive: false,
        attributionControl: false,
        dragRotate: false,
      });
    } catch (e) {
      // Pas de WebGL / carte indispo : on garde le fond sombre, sans casser l'intro.
      this.map = null;
    }
  }

  /* ---------------- SceneParallax ---------------- */
  _wireParallax() {
    const scene = this.el.querySelector(".intro-scene");
    this._px = 0;
    this._py = 0;
    this._cx = 0;
    this._cy = 0;
    this._auto = 0;

    const onOrient = (e) => {
      if (e.gamma == null) return;
      this._px = Math.max(-1, Math.min(1, e.gamma / 30));
      this._py = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 30));
    };
    const onPointer = (e) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      this._px = (e.clientX / w) * 2 - 1;
      this._py = (e.clientY / h) * 2 - 1;
    };
    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("pointermove", onPointer);
    this._cleanups.push(() => window.removeEventListener("deviceorientation", onOrient));
    this._cleanups.push(() => window.removeEventListener("pointermove", onPointer));

    const layers = [...scene.querySelectorAll(".ly")];
    const depthMap = { "ly-map": 14, "ly-hexo": 34 };

    const tick = () => {
      this._auto += 0.005;
      const tx = this._px + Math.sin(this._auto) * 0.25;
      const ty = this._py + Math.cos(this._auto * 0.8) * 0.15;
      this._cx += (tx - this._cx) * 0.06;
      this._cy += (ty - this._cy) * 0.06;
      for (const el of layers) {
        const d = depthMap[[...el.classList].find((c) => depthMap[c])] || 0;
        el.style.transform = `translate3d(${(-this._cx * d).toFixed(2)}px, ${(-this._cy * d * 0.6).toFixed(2)}px, 0)`;
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  /* ---------------- MapField : capture des tuiles au passage de Hexo ----------------
   * Grille hexagonale transparente par-dessus la carte. Le coureur trace un
   * chemin ; les tuiles qu'il traverse passent au cyan (pop) puis se dissipent
   * → sillage de conquête. Quelques tuiles rivales (rose) fixes pour le contraste. */
  _startMap() {
    const canvas = this.el.querySelector(".intro-map");
    const ctx = canvas.getContext("2d");
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const R = 30;
    const FADE = 2.6; // s avant qu'une tuile conquise ne se dissipe
    let W = 0;
    let H = 0;
    let hexes = [];
    let trail = [];

    const hexPoly = (cx, cy) => {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i);
        pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
      }
      return pts;
    };
    const traceHex = (cx, cy) => {
      const p = hexPoly(cx, cy);
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < 6; i++) ctx.lineTo(p[i][0], p[i][1]);
      ctx.closePath();
    };

    const build = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

      hexes = [];
      const hw = R * 1.5;
      const hh = Math.sqrt(3) * R;
      const pinkC = { x: W * 0.74, y: H * 0.28 }; // cluster rival (fixe)
      let col = 0;
      for (let x = -R; x < W + R; x += hw, col++) {
        const yoff = col % 2 ? hh / 2 : 0;
        for (let y = -R; y < H + R; y += hh) {
          const cx = x;
          const cy = y + yoff;
          const rival = Math.hypot(cx - pinkC.x, cy - pinkC.y) < R * 2.1;
          hexes.push({ cx, cy, owner: rival ? "pink" : null, capAt: -99, pop: 0, phase: Math.random() * 6.28 });
        }
      }

      trail = [];
      const segs = 100;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        trail.push({
          x: t * (W + 140) - 70,
          y: H * 0.52 + Math.sin(t * Math.PI * 3.4) * H * 0.18,
        });
      }
    };

    build();
    const onResize = () => build();
    window.addEventListener("resize", onResize);
    this._cleanups.push(() => window.removeEventListener("resize", onResize));

    let t = 0;
    let raf = 0;
    const draw = () => {
      t += 0.016;
      ctx.clearRect(0, 0, W, H);

      // position du coureur + conquête des tuiles proches
      const head = trail[Math.floor((t * 10) % trail.length)];
      for (const h of hexes) {
        if (h.owner === "pink") continue;
        if (Math.hypot(h.cx - head.x, h.cy - head.y) < R * 1.5) {
          if (h.owner !== "cyan") h.pop = 0.0001;
          h.owner = "cyan";
          h.capAt = t;
        }
      }

      // rendu grille + tuiles
      for (const h of hexes) {
        traceHex(h.cx, h.cy);
        if (h.owner === "pink") {
          const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + h.phase);
          ctx.fillStyle = PINK;
          ctx.globalAlpha = 0.16 + pulse * 0.12;
          ctx.fill();
          ctx.globalAlpha = 0.5 + pulse * 0.35;
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = PINK;
          ctx.stroke();
          ctx.globalAlpha = 1;
          continue;
        }
        if (h.owner === "cyan") {
          const age = t - h.capAt;
          const fade = Math.max(0, 1 - age / FADE);
          if (fade <= 0) {
            h.owner = null;
          } else {
            h.pop = Math.min(1, h.pop + 0.12);
            const grow = easeOutBack(h.pop);
            ctx.fillStyle = CYAN;
            ctx.globalAlpha = (0.18 + 0.22 * fade) * Math.min(grow, 1.2);
            ctx.fill();
            ctx.globalAlpha = (0.55 + 0.4 * fade);
            ctx.lineWidth = 1.8;
            ctx.strokeStyle = CYAN;
            ctx.shadowColor = CYAN;
            ctx.shadowBlur = 10 * fade;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
            continue;
          }
        }
        // tuile neutre
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(154,180,255,0.16)";
        ctx.stroke();
      }

      // tête lumineuse du coureur
      ctx.beginPath();
      ctx.arc(head.x, head.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(head.x, head.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = CYAN;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    this._cleanups.push(() => cancelAnimationFrame(raf));

    function easeOutBack(x) {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
  }

  /* ---------------- Particules flottantes ---------------- */
  _startParticles() {
    const canvas = this.el.querySelector(".intro-particles");
    const ctx = canvas.getContext("2d");
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    this._cleanups.push(() => window.removeEventListener("resize", resize));

    const N = 28;
    const parts = Array.from({ length: N }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 1 + Math.random() * 2.2,
      s: 0.02 + Math.random() * 0.05,
      a: 0.15 + Math.random() * 0.4,
    }));

    let raf = 0;
    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.y -= p.s / 100;
        if (p.y < -0.05) {
          p.y = 1.05;
          p.x = Math.random();
        }
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,220,255,${p.a})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    this._cleanups.push(() => cancelAnimationFrame(raf));
  }

  /* ---------------- HexoController ---------------- */
  _hexoJump() {
    this.hexo.classList.remove("jump");
    void this.hexo.offsetWidth;
    this.hexo.classList.add("jump");
    this.audio.sfx("tap");
    this._nextLine();
  }

  _wireHexoTalk() {
    // rotation automatique des répliques (≥ 25 s par phrase)
    const id = setInterval(() => this._nextLine(), 26000);
    this._cleanups.push(() => clearInterval(id));
  }

  _nextLine() {
    this._lineIdx = (this._lineIdx + 1) % HEXO_LINES.length;
    const span = this.bubble.querySelector("span");
    span.textContent = HEXO_LINES[this._lineIdx];
    this.bubble.classList.remove("pop");
    void this.bubble.offsetWidth;
    this.bubble.classList.add("pop");
  }

  /* ---------------- Audio ---------------- */
  _wireAudio() {
    const firstGesture = () => this.audio.unlock();
    this.el.addEventListener("pointerdown", firstGesture, { once: true });

    const onHexoTap = () => this._hexoJump();
    this.hexo.addEventListener("pointerdown", onHexoTap);
    this._cleanups.push(() => this.hexo.removeEventListener("pointerdown", onHexoTap));

    const onSound = () => {
      this.audio.unlock();
      this.audio.toggleMute();
      this._syncSoundIcon();
    };
    this.soundBtn.addEventListener("click", onSound);
    this._cleanups.push(() => this.soundBtn.removeEventListener("click", onSound));
  }

  _syncSoundIcon() {
    this.soundBtn.textContent = this.audio.isMuted ? "🔇" : "🔊";
    this.soundBtn.classList.toggle("muted", this.audio.isMuted);
  }

  /* ---------------- IntroUI : authentification ---------------- */
  _wireAuth() {
    this.auth.addEventListener("state", (e) => {
      this.el.classList.toggle("busy", e.detail.busy);
    });
    this.auth.addEventListener("error", (e) => {
      const err = e.detail.error;
      if (err instanceof AuthNotConfiguredError) {
        this._toast("Bientôt disponible — connexion locale pour l'instant 🙂");
      } else {
        this._toast("Connexion impossible, réessaie.");
      }
    });

    const onClick = async (ev) => {
      const btn = ev.target.closest(".auth-btn");
      if (!btn || this.el.classList.contains("busy")) return;
      this.audio.unlock();
      const providerId = btn.dataset.provider;
      btn.classList.add("loading");
      try {
        const profile = await this.auth.signIn(providerId);
        this.audio.sfx("success");
        await this._finish(profile);
      } catch {
        btn.classList.remove("loading");
      }
    };
    this.el.querySelector(".intro-ui").addEventListener("click", onClick);
  }

  _toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove("show"), 2600);
  }

  /* ---------------- Sortie ---------------- */
  async _finish(profile) {
    this.el.classList.add("leaving");
    this.audio.dispose();
    await new Promise((r) => setTimeout(r, 500));
    this._dispose();
    this._resolve({ profile, audio: this.audio });
  }

  _dispose() {
    cancelAnimationFrame(this._raf);
    this._cleanups.forEach((fn) => fn());
    this._cleanups = [];
    try {
      this.map?.remove();
    } catch {
      /* noop */
    }
    this.map = null;
    this.el?.remove();
    this.el = null;
  }
}
