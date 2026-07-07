import { el } from "../router.js";

export class ProfileScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--solid screen--list">
        <header class="list-top">
          <button class="close-btn" id="pf-back">←</button>
          <h1>👤 Profil</h1>
        </header>
        <section class="profile-hero">
          <div class="ph-stat"><span id="pf-level">1</span><label>niveau</label></div>
          <div class="ph-stat"><span id="pf-territory">0</span><label>territoire</label></div>
          <div class="ph-stat"><span id="pf-runs">0</span><label>courses</label></div>
          <div class="ph-stat"><span id="pf-km">0</span><label>km cumulés</label></div>
        </section>
        <h2 class="profile-sub">Historique</h2>
        <div class="list-body" id="pf-body"></div>
      </div>`);
    root.querySelector("#pf-back").addEventListener("click", () => this.ctx.router.go("home"));
    this.el = root;
    return root;
  }
  enter() {
    const p = this.ctx.store.profile();
    const totalKm = p.runs.reduce((s, r) => s + (r.km || 0), 0);
    this.el.querySelector("#pf-level").textContent = p.level;
    this.el.querySelector("#pf-territory").textContent = p.territory;
    this.el.querySelector("#pf-runs").textContent = p.runs.length;
    this.el.querySelector("#pf-km").textContent = totalKm.toFixed(1);

    const body = this.el.querySelector("#pf-body");
    if (!p.runs.length) { body.innerHTML = '<div class="empty">Aucune course. Va conquérir du terrain !</div>'; return; }
    body.innerHTML = p.runs.map((r) => {
      const d = new Date(r.date);
      const date = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      const mm = Math.floor((r.duration || 0) / 60);
      return `<div class="hist-row">
        <span class="hist-date">${date}</span>
        <span class="hist-net">+${r.net}<small>⬡</small></span>
        <span class="hist-meta">${(r.km || 0).toFixed(2)} km · ${mm} min</span>
      </div>`;
    }).join("");
  }
}
