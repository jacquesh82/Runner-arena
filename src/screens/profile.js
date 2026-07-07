import { el } from "../router.js";
import { buildGpx, saveGpx } from "../gpx.js";

export class ProfileScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--solid screen--list">
        <header class="list-top">
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
    this.el = root;
    return root;
  }
  enter() {
    const p = this.ctx.store.profile();
    const runs = p.runs.filter((r) => !r._bonus);
    const totalKm = runs.reduce((s, r) => s + (r.km || 0), 0);
    this.el.querySelector("#pf-level").textContent = p.level;
    this.el.querySelector("#pf-territory").textContent = p.territory;
    this.el.querySelector("#pf-runs").textContent = runs.length;
    this.el.querySelector("#pf-km").textContent = totalKm.toFixed(1);

    const body = this.el.querySelector("#pf-body");
    if (!runs.length) { body.innerHTML = '<div class="empty">Aucune course. Va conquérir du terrain !</div>'; return; }
    body.innerHTML = runs.map((r, i) => {
      const d = new Date(r.date);
      const date = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      const mm = Math.floor((r.duration || 0) / 60);
      const nPts = r.points || (r.track ? r.track.length : 0);
      const gps = nPts ? ` · ${nPts} pts GPS` : "";
      const btn = r.track && r.track.length
        ? `<button class="hist-gpx" data-gpx="${i}" title="Télécharger le GPX">⬇ GPX</button>`
        : "";
      return `<div class="hist-row">
        <span class="hist-date">${date}</span>
        <span class="hist-net">+${r.net}<small>⬡</small></span>
        <span class="hist-meta">${(r.km || 0).toFixed(2)} km · ${mm} min${gps}</span>
        ${btn}
      </div>`;
    }).join("");

    body.querySelectorAll(".hist-gpx").forEach((b) => {
      b.addEventListener("click", () => {
        const r = runs[+b.dataset.gpx];
        if (!r || !r.track) return;
        const d = new Date(r.date), pad = (n) => String(n).padStart(2, "0");
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
        saveGpx(buildGpx(r.track, "Runner Arena — course"), `runner-arena-${stamp}.gpx`);
      });
    });
  }
}
