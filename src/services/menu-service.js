/* ======================================================================
 * GameHub — hub de gamification post-login (avant la partie).
 *
 * Style « Claymorphism 3D AAA » (clay dépth, gloss néon, spring squish) sur
 * la palette du jeu (cyan/rose sur navy). Overlay HTML/CSS, portrait, safe-areas.
 *
 * 3 onglets (bottom-nav) :
 *   - Jouer  : choix du MONDE (Marche / Running / Trail) + MODE
 *              (Vitesse / Distance / Performance / Handicap dynamique) → JOUER
 *   - Badges : collection (médailles débloquées / verrouillées)
 *   - Offres : tuiles commerciales sponsorisées → modale d'offre (achat / lien)
 *
 * `show()` renvoie { worldId, modeId, mode } où `mode` est le mode moteur du
 * jeu (blitz / endurance / handicap) consommé par UiService.
 *
 * NB gamification only : achats in-app et liens d'offres sont ici des STUBS
 * (toast) — le backend commercial et l'admin viendront plus tard.
 * ==================================================================== */

import "../menu.css";
import { BuildInfo } from "../build-info.js";

/* --- Icônes SVG (pas d'emoji comme icône structurelle) --- */
const ic = {
  walk: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="1.6"/><path d="M11 7l-2 4 3 2 1 5"/><path d="M9 11l-2 6"/><path d="M12 13l3-1 2 2"/></svg>`,
  run: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="4" r="1.6"/><path d="M13 8l-3 3 2 3-1 5"/><path d="M12 11l4 1 2-2"/><path d="M10 11l-4 2"/></svg>`,
  trail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19h18"/><path d="M6 19l5-9 3 5 2-3 3 7"/><circle cx="11" cy="7" r="1.4"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>`,
  road: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21 9 3M18 21 15 3"/><path d="M12 6v2M12 12v2M12 18v2"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>`,
  balance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5 7h14"/><path d="M5 7 2 13a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
  medal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M9 9 7 2M15 9l2-7M12 13l.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12 12 20 3 11V3h8z"/><circle cx="7.5" cy="7.5" r="1.4" fill="currentColor"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  gift: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M4 12v8h16v-8M12 8v12"/><path d="M12 8S9 3 7 5s2 3 5 3zM12 8s3-5 5-3-2 3-5 3z"/></svg>`,
};

const WORLDS = [
  { id: "marche", label: "Marche", desc: "Balade tranquille", icon: ic.walk },
  { id: "running", label: "Running", desc: "Rythme soutenu", icon: ic.run },
  { id: "trail", label: "Trail", desc: "Nature & dénivelé", icon: ic.trail },
];

const MODES = [
  { id: "vitesse", label: "Vitesse", desc: "Capture éclair", engine: "blitz", icon: ic.bolt },
  { id: "distance", label: "Distance", desc: "Tiens la durée", engine: "endurance", icon: ic.road },
  { id: "performance", label: "Performance", desc: "Bats ton record", engine: "endurance", icon: ic.chart },
  { id: "handicap", label: "Handicap dynamique", desc: "Rééquilibrage live", engine: "handicap", icon: ic.balance },
];

/* Tuiles commerciales rencontrées sur le terrain (démo). */
const OFFERS = [
  { id: "cafe", brand: "Café Néon", tag: "Boisson offerte", reward: "+50 tuiles bonus", price: "Gratuit", color: "#ff9e3d", init: "☕" },
  { id: "sport", brand: "RunGear", tag: "-20% baskets", reward: "Skin Hexo exclusif", price: "2,99 €", color: "#7c5cff", init: "👟" },
  { id: "gym", brand: "PulseGym", tag: "1 séance offerte", reward: "x2 score 24h", price: "Gratuit", color: "#00e5ff", init: "💪" },
];

/* Badges de collection (démo : quelques débloqués). */
const BADGES = [
  { id: "first", label: "Premier pas", icon: ic.walk, unlocked: true },
  { id: "sprint", label: "Sprinteur", icon: ic.bolt, unlocked: true },
  { id: "loop", label: "Encercleur", icon: ic.medal, unlocked: true },
  { id: "explorer", label: "Explorateur", icon: ic.trail, unlocked: false },
  { id: "marathon", label: "Marathon", icon: ic.road, unlocked: false },
  { id: "champion", label: "Champion", icon: ic.chart, unlocked: false },
];

export class GameHub {
  constructor(session = {}) {
    this.session = session;
    this.worldId = "running";
    this.modeId = "distance";
    this.tab = "play";
    this.el = null;
    this._resolve = null;
  }

  show() {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._build();
      this._wire();
      requestAnimationFrame(() => this.el.classList.add("ready"));
    });
  }

  _name() {
    return this.session?.profile?.name || "Invité";
  }

  /* ---------------- DOM ---------------- */
  _build() {
    const worldCards = WORLDS.map(
      (w) => `
      <button class="clay-card world-card ${w.id === this.worldId ? "on" : ""}" data-world="${w.id}">
        <span class="card-ic">${w.icon}</span>
        <span class="card-txt"><b>${w.label}</b><small>${w.desc}</small></span>
        <span class="card-check">${ic.play}</span>
      </button>`
    ).join("");

    const modeCards = MODES.map(
      (m) => `
      <button class="clay-chip mode-chip ${m.id === this.modeId ? "on" : ""}" data-mode="${m.id}">
        <span class="chip-ic">${m.icon}</span>
        <span class="chip-txt"><b>${m.label}</b><small>${m.desc}</small></span>
      </button>`
    ).join("");

    const badgeCells = BADGES.map(
      (b) => `
      <div class="badge-cell ${b.unlocked ? "unlocked" : "locked"}">
        <div class="badge-medal">${b.unlocked ? b.icon : ic.lock}</div>
        <span>${b.label}</span>
      </div>`
    ).join("");

    const offerRows = OFFERS.map(
      (o) => `
      <button class="clay-card offer-card" data-offer="${o.id}">
        <span class="offer-logo" style="--brand:${o.color}">${o.init}</span>
        <span class="card-txt"><b>${o.brand}</b><small>${o.tag}</small></span>
        <span class="offer-cta">${o.price}</span>
      </button>`
    ).join("");

    const root = document.createElement("div");
    root.id = "hub";
    root.className = "hub";
    root.innerHTML = `
      <div class="hub-bg"></div>

      <header class="hub-top">
        <div class="logo3d hub-logo"><span class="mark">◢◤</span><span class="w-run">RUNNER</span><span class="w-arena">ARENA</span></div>
        <div class="player-chip"><span class="pc-avatar">${this._name().charAt(0).toUpperCase()}</span>${this._name()}</div>
      </header>

      <main class="hub-scroll">
        <!-- Onglet JOUER -->
        <section class="pane pane-play on">
          <h2 class="sec-title">Choisis ton monde</h2>
          <div class="world-grid">${worldCards}</div>

          <h2 class="sec-title">Mode de jeu</h2>
          <div class="mode-grid">${modeCards}</div>

          <button class="clay-card offer-card teaser" data-offer="cafe">
            <span class="offer-logo" style="--brand:#ff9e3d">${ic.gift}</span>
            <span class="card-txt"><b>Offre à proximité</b><small>Une tuile sponsorisée t'attend</small></span>
            <span class="offer-cta">Voir</span>
          </button>
        </section>

        <!-- Onglet BADGES -->
        <section class="pane pane-badges">
          <h2 class="sec-title">Collection</h2>
          <div class="badge-progress"><span style="width:50%"></span></div>
          <p class="hub-note">3 / 6 badges débloqués — badge de quartier : <b>Le Marais</b></p>
          <div class="badge-grid">${badgeCells}</div>
        </section>

        <!-- Onglet OFFRES -->
        <section class="pane pane-offers">
          <h2 class="sec-title">Tuiles commerciales</h2>
          <p class="hub-note">Des partenaires posent des tuiles à conquérir. <span class="spons">Sponsorisé</span></p>
          <div class="offer-list">${offerRows}</div>
        </section>
      </main>

      <button class="play-cta" id="playCta"><span>${ic.play}</span>JOUER</button>

      <nav class="hub-nav">
        <button class="nav-btn on" data-tab="play">${ic.play}<span>Jouer</span></button>
        <button class="nav-btn" data-tab="badges">${ic.medal}<span>Badges</span></button>
        <button class="nav-btn" data-tab="offers">${ic.tag}<span>Offres</span></button>
      </nav>

      <div class="hub-build">${BuildInfo.label}</div>
      <div class="hub-toast" id="hubToast"></div>

      <!-- Modale d'offre commerciale -->
      <div class="offer-modal" id="offerModal" aria-hidden="true">
        <div class="offer-scrim" data-close="1"></div>
        <div class="offer-sheet" role="dialog" aria-modal="true">
          <button class="sheet-close" data-close="1" aria-label="Fermer">✕</button>
          <span class="spons sheet-spons">Sponsorisé</span>
          <div class="sheet-logo" id="mLogo">☕</div>
          <h3 id="mBrand">Café Néon</h3>
          <p class="sheet-tag" id="mTag">Boisson offerte</p>
          <div class="sheet-reward"><span>${ic.gift}</span><b id="mReward">+50 tuiles bonus</b></div>
          <button class="clay-btn primary" id="mBuy">Débloquer — <span id="mPrice">Gratuit</span></button>
          <button class="clay-btn ghost" id="mLink">Voir l'offre du partenaire</button>
          <p class="sheet-legal">Achat intégré de démonstration — aucun paiement réel.</p>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.el = root;
    this.toastEl = root.querySelector("#hubToast");
    this.modal = root.querySelector("#offerModal");
  }

  /* ---------------- Interactions ---------------- */
  _wire() {
    // sélection monde
    this.el.querySelectorAll("[data-world]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.worldId = btn.dataset.world;
        this.el.querySelectorAll("[data-world]").forEach((b) => b.classList.toggle("on", b === btn));
      })
    );
    // sélection mode
    this.el.querySelectorAll("[data-mode]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this.modeId = btn.dataset.mode;
        this.el.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b === btn));
      })
    );
    // onglets
    this.el.querySelectorAll("[data-tab]").forEach((btn) =>
      btn.addEventListener("click", () => this._switchTab(btn.dataset.tab))
    );
    // offres → modale
    this.el.querySelectorAll("[data-offer]").forEach((btn) =>
      btn.addEventListener("click", () => this._openOffer(btn.dataset.offer))
    );
    // fermeture modale
    this.modal.querySelectorAll("[data-close]").forEach((n) =>
      n.addEventListener("click", () => this._closeOffer())
    );
    this.el.querySelector("#mBuy").addEventListener("click", () => {
      this._toast("Achat intégré à brancher (backend commercial à venir).");
      this._closeOffer();
    });
    this.el.querySelector("#mLink").addEventListener("click", () => {
      this._toast("Lien partenaire à brancher.");
    });
    // JOUER
    this.el.querySelector("#playCta").addEventListener("click", () => this._play());
  }

  _switchTab(tab) {
    if (tab === this.tab) return;
    this.tab = tab;
    this.el.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    const map = { play: ".pane-play", badges: ".pane-badges", offers: ".pane-offers" };
    this.el.querySelectorAll(".pane").forEach((p) => p.classList.remove("on"));
    this.el.querySelector(map[tab]).classList.add("on");
    // le CTA JOUER n'a de sens que sur l'onglet Jouer
    this.el.querySelector("#playCta").classList.toggle("hidden", tab !== "play");
  }

  _openOffer(id) {
    const o = OFFERS.find((x) => x.id === id) || OFFERS[0];
    this.el.querySelector("#mLogo").textContent = o.init;
    this.el.querySelector("#mBrand").textContent = o.brand;
    this.el.querySelector("#mTag").textContent = o.tag;
    this.el.querySelector("#mReward").textContent = o.reward;
    this.el.querySelector("#mPrice").textContent = o.price;
    this.modal.querySelector(".sheet-logo").style.setProperty("--brand", o.color);
    this.modal.classList.add("open");
    this.modal.setAttribute("aria-hidden", "false");
  }
  _closeOffer() {
    this.modal.classList.remove("open");
    this.modal.setAttribute("aria-hidden", "true");
  }

  _toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove("show"), 2800);
  }

  _play() {
    const mode = MODES.find((m) => m.id === this.modeId) || MODES[1];
    this.el.classList.add("leaving");
    setTimeout(() => {
      this.el?.remove();
      this.el = null;
      this._resolve({ worldId: this.worldId, modeId: this.modeId, mode: mode.engine });
    }, 380);
  }
}
