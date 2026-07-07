import { el } from "../router.js";
import { BuildInfo } from "../build-info.js";

/* Écran Options / réglages (accessible via la barre du bas). */
export class OptionsScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--solid screen--list screen--options">
        <header class="list-top"><h1>⚙️ Options</h1></header>
        <div class="opt-body">
          <div class="opt-card">
            <div class="opt-row"><span>Son</span>
              <button class="switch" id="opt-sound" role="switch"></button></div>
          </div>
          <div class="opt-card">
            <div class="opt-row"><span>Compte</span><span class="opt-val" id="opt-acc">—</span></div>
            <button class="btn-ghost" id="opt-profile">👤 Mon profil</button>
            <button class="btn-ghost" id="opt-logout">Se déconnecter</button>
          </div>
          <div class="opt-card">
            <div class="opt-row"><span>Suivi écran éteint</span>
              <button class="btn-ghost opt-mini" id="opt-batt">🔋 Régler</button></div>
            <p class="opt-hint">Pour un enregistrement GPS fiable écran éteint, autorise
              Runner Arena à ignorer l'optimisation de batterie.</p>
          </div>
          <div class="opt-card">
            <div class="opt-row"><span>Cinématique de démonstration</span>
              <button class="btn-ghost opt-mini" id="opt-cine">▶ Voir</button></div>
          </div>
          <div class="opt-about">Runner Arena · <span id="opt-ver"></span></div>
        </div>
      </div>`);
    root.querySelector("#opt-sound").addEventListener("click", () => this._toggleSound());
    root.querySelector("#opt-profile").addEventListener("click", () => this.ctx.router.go("profile"));
    root.querySelector("#opt-logout").addEventListener("click", () => this._logout());
    root.querySelector("#opt-cine").addEventListener("click", () => { window.location.href = window.location.pathname + "?replay=1"; });
    root.querySelector("#opt-batt").addEventListener("click", () => this._openBattery());
    this.el = root;
    return root;
  }
  enter() {
    this._syncSound();
    const p = this.ctx.profile;
    this.el.querySelector("#opt-acc").textContent =
      p ? (p.provider === "local" ? "Invité" : p.name || p.provider) : "Invité";
    this.el.querySelector("#opt-ver").textContent = BuildInfo.label;
  }
  _syncSound() {
    const muted = localStorage.getItem("arena.muted") === "1";
    const sw = this.el.querySelector("#opt-sound");
    sw.classList.toggle("on", !muted);
    sw.setAttribute("aria-checked", String(!muted));
  }
  _toggleSound() {
    const muted = localStorage.getItem("arena.muted") === "1";
    localStorage.setItem("arena.muted", muted ? "0" : "1");
    this._syncSound();
  }
  async _openBattery() {
    const ok = await this.ctx.location.openBatterySettings();
    if (!ok) alert("Disponible sur l'app mobile : Réglages → Batterie → Sans restriction.");
  }
  _logout() {
    try { this.ctx.auth && this.ctx.auth.signOut(); } catch (_) {}
    window.location.href = window.location.pathname; // recharge → intro
  }
}
