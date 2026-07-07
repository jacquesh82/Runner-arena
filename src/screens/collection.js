import { el } from "../router.js";
import { RARITY } from "../data/badges.js";

/* Collection : badges débloqués/verrouillés + merveilles revendiquées. */
export class CollectionScreen {
  constructor(ctx) { this.ctx = ctx; }
  mount() {
    const root = el(`
      <div class="screen--solid screen--list">
        <header class="list-top">
          <button class="close-btn" id="co-back">←</button>
          <h1>🎖 Collection</h1>
        </header>
        <div class="co-tabs">
          <button class="co-tab active" data-tab="badges">Badges <span id="co-bc"></span></button>
          <button class="co-tab" data-tab="merveilles">Merveilles <span id="co-mc"></span></button>
        </div>
        <div class="list-body" id="co-body"></div>
      </div>`);
    root.querySelector("#co-back").addEventListener("click", () => this.ctx.router.go("home"));
    root.querySelectorAll(".co-tab").forEach((t) => t.addEventListener("click", () => this._tab(t.dataset.tab)));
    this.el = root;
    return root;
  }

  async enter() {
    this.badges = await this.ctx.backend.getBadges();
    this.merveilles = await this.ctx.backend.getMerveilles();
    const earned = new Set(this.badges.earned);
    this.el.querySelector("#co-bc").textContent = `${earned.size}/${this.badges.catalogue.length}`;
    const claimed = this.merveilles.filter((m) => m.claimed).length;
    this.el.querySelector("#co-mc").textContent = `${claimed}/${this.merveilles.length}`;
    this._tab(this.tab || "badges");
  }

  _tab(name) {
    this.tab = name;
    this.el.querySelectorAll(".co-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    const body = this.el.querySelector("#co-body");
    if (name === "badges") {
      const earned = new Set(this.badges.earned);
      body.className = "list-body co-grid";
      body.innerHTML = this.badges.catalogue.map((b) => {
        const has = earned.has(b.id);
        const rc = RARITY[b.rarity];
        return `<div class="badge ${has ? "badge--on" : "badge--off"}" style="--rc:${rc.color}">
          <div class="badge-ic">${has ? b.icon : "🔒"}</div>
          <div class="badge-nm">${b.name}</div>
          <div class="badge-rr">${rc.label}</div>
          <div class="badge-ds">${b.desc}</div>
        </div>`;
      }).join("");
    } else {
      body.className = "list-body";
      body.innerHTML = this.merveilles.map((m) => `
        <div class="mv-row ${m.claimed ? "mv-row--on" : ""}">
          <span class="mv-ic">${m.icon}</span>
          <div class="mv-info"><span class="mv-nm">${m.name}</span><span class="mv-ty">${m.type} · tier ${m.tier}</span></div>
          <span class="mv-st">${m.claimed ? "✓ contrôlée" : "à conquérir"}</span>
        </div>`).join("");
    }
  }
}
