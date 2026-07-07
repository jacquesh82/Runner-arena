import { el } from "../router.js";
import { BADGE_BY_ID, RARITY } from "../data/badges.js";

export class SummaryScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--solid screen--summary">
        <div class="summary-head">
          <div class="summary-net"><span id="s-net">0</span><small>zones nettes gagnées</small></div>
        </div>

        <div class="summary-grid">
          <div class="sg"><span id="s-zones">0</span><label>conquises</label></div>
          <div class="sg"><span id="s-won">0</span><label>en combat</label></div>
          <div class="sg"><span id="s-lost">0</span><label>perdues</label></div>
          <div class="sg"><span id="s-km">0.00</span><label>km</label></div>
          <div class="sg"><span id="s-time">00:00</span><label>durée</label></div>
          <div class="sg"><span id="s-pace">--</span><label>min/km</label></div>
        </div>

        <div class="summary-xp">
          <span>+<b id="s-xp">0</b> XP</span>
          <span class="summary-total">Territoire total : <b id="s-total">0</b></span>
        </div>

        <div class="summary-badges" id="s-badges"></div>

        <div class="summary-actions">
          <button class="btn-ghost" id="s-gpx">⬇ GPX</button>
          <button class="btn-ghost" id="s-share">↗ Partager</button>
        </div>
        <button class="btn-primary" id="s-home">Retour au QG</button>
      </div>`);
    root.querySelector("#s-gpx").addEventListener("click", () => this._gpx());
    root.querySelector("#s-share").addEventListener("click", () => this._share());
    root.querySelector("#s-home").addEventListener("click", () => this._home());
    this.el = root;
    return root;
  }

  async enter(data) {
    this.data = data;
    const km = (data.distance || 0) / 1000;

    const q = (id) => this.el.querySelector(id);
    q("#s-net").textContent = data.net ?? 0;
    q("#s-zones").textContent = data.zones ?? 0;
    q("#s-won").textContent = data.won ?? 0;
    q("#s-lost").textContent = data.lost ?? 0;
    q("#s-km").textContent = km.toFixed(2);
    const mm = Math.floor((data.duration || 0) / 60), ss = Math.floor((data.duration || 0) % 60);
    q("#s-time").textContent = String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
    q("#s-pace").textContent = data.pace && isFinite(data.pace) ? data.pace.toFixed(1) : "--";
    q("#s-badges").innerHTML = "";

    // Soumission au backend : XP, badges, territoire (source de vérité)
    const res = await this.ctx.backend.submitRun({
      zones: data.zones || 0, km, duration: data.duration || 0, pace: data.pace || null,
      won: data.won || 0, lost: data.lost || 0, net: data.net || 0, merveilles: data.merveilles || [],
    });
    q("#s-xp").textContent = res.xpGained;
    q("#s-total").textContent = res.territory;
    this._renderBadges(res.badgesEarned || []);
  }

  _renderBadges(ids) {
    if (!ids.length) return;
    const box = this.el.querySelector("#s-badges");
    box.innerHTML = `<div class="sb-title">🎉 Nouveau${ids.length > 1 ? "x" : ""} badge${ids.length > 1 ? "s" : ""} !</div>
      <div class="sb-row">${ids.map((id) => {
        const b = BADGE_BY_ID[id]; if (!b) return "";
        return `<div class="sb-badge" style="--rc:${RARITY[b.rarity].color}"><span>${b.icon}</span><small>${b.name}</small></div>`;
      }).join("")}</div>`;
  }

  async _gpx() {
    const res = await this.ctx.location.exportGpx();
    this._toast(res.native ? "GPX enregistré dans Documents" : "GPX téléchargé");
  }
  async _share() {
    const d = this.data, km = ((d.distance || 0) / 1000).toFixed(2);
    const text = `J'ai conquis ${d.net} zones sur Runner Arena en courant ${km} km ! 🏃⬡`;
    try {
      if (navigator.share) await navigator.share({ title: "Runner Arena", text });
      else { await navigator.clipboard?.writeText(text); this._toast("Copié dans le presse-papier"); }
    } catch (_) {}
  }
  _home() {
    this.ctx.engine.setCenter(this.ctx.START); // réinitialise le plateau pour la prochaine course
    this.ctx.router.go("home");
  }
  _toast(msg) {
    const t = el(`<div class="mini-toast">${msg}</div>`);
    this.el.appendChild(t);
    setTimeout(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 1600);
  }
}
